"""Business logic for matching music scenes and genres."""
from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Tuple

from .cache import TTLCache
from .models import (
    MusicConfig,
    RecommendationResult,
    SceneConfig,
    SearchResult,
)
from .ai_client import NeuralTaggerClient, NeuralTaggerError, ScenePrediction
# Optional YouTube Data API client: code must run even if module/file is missing
try:  # pragma: no cover - defensive import for partial deployments
    from .youtube_client import (
        YouTubeDataClient,  # type: ignore
        build_client_from_env,  # type: ignore
        YouTubeApiError,  # type: ignore
    )
except Exception:  # noqa: BLE001 - broad for robustness in runtime
    YouTubeDataClient = None  # type: ignore

    def build_client_from_env():  # type: ignore
        return None

    class YouTubeApiError(Exception):  # type: ignore
        pass


class MusicServiceError(Exception):
    """Base error for the music service."""


class GenreNotFoundError(MusicServiceError):
    """Raised when requested genre does not exist."""


class SceneNotFoundError(MusicServiceError):
    """Raised when scene does not exist inside selected genre."""


class RecommendationUnavailableError(MusicServiceError):
    """Raised when neural recommendations cannot be produced."""


class MusicService:
    """Entry point for search logic."""

    def __init__(
        self,
        config: MusicConfig,
        *,
        ai_client: NeuralTaggerClient | None = None,
        youtube_client: YouTubeDataClient | None = None,
    ) -> None:
        self._config = config
        self._cache = TTLCache[Tuple[str, str], SearchResult](config.hysteresis.cache_ttl_sec)
        # Cache for recommendation results to reduce external AI calls
        self._rec_cache = TTLCache[Tuple[str, Tuple[str, ...]], RecommendationResult](
            config.hysteresis.cache_ttl_sec
        )
        self._ai_client = ai_client
        # YouTube Data API client is optional and only used when available
        self._yt = youtube_client or build_client_from_env()

    def _get_scene_config(self, genre: str, scene: str) -> SceneConfig:
        try:
            return self._config.get_scene(genre, scene)
        except KeyError as exc:
            message = exc.args[0] if exc.args else str(exc)
            if message.startswith("Unknown genre"):
                raise GenreNotFoundError(message) from exc
            raise SceneNotFoundError(message) from exc

    def search(self, genre: str, scene: str) -> SearchResult:
        cache_key = (genre.lower(), scene.lower())
        cached = self._cache.get(cache_key)
        if cached:
            return cached

        scene_config = self._get_scene_config(genre, scene)

        playlists = [provider.build_search(scene_config.query) for provider in scene_config.providers]

        result = SearchResult(
            genre=cache_key[0],
            scene=cache_key[1],
            query=scene_config.query,
            playlists=playlists,
            hysteresis=self._config.hysteresis,
            youtube_playlist_id=scene_config.youtube_playlist_id,
            youtube_video_ids=scene_config.youtube_video_ids,
        )
        # If no manual list provided, try enriching with embeddable YouTube results
        # NOTE: Only 1 API call to save quota (each call = 100 units, limit 10,000/day)
        if not result.youtube_video_ids and self._yt is not None:
            try:
                # Single query attempt - no fallbacks to save quota
                cleaned = self._sanitize_query_for_youtube(result.query)
                ids = self._yt.search_embeddable_video_ids(cleaned or result.query, max_results=10)
                if ids:
                    result.youtube_video_ids = ids
            except YouTubeApiError:
                # Non-fatal: keep result without manual list
                pass
        self._cache.set(cache_key, result)
        return result

    def available_genres(self) -> Tuple[str, ...]:
        return tuple(sorted(self._config.genres.keys()))

    def available_scenes(self, genre: str | None = None) -> Tuple[str, ...] | Dict[str, Tuple[str, ...]]:
        """Return a tuple of scenes for a genre or a mapping for all genres.

        When ``genre`` is provided the method validates that the genre exists and
        returns the sorted tuple of scene identifiers for it.  Without the
        argument a dictionary with scene tuples for every known genre is
        returned.  The method is primarily used by the web UI to pre-populate
        selector widgets without hitting the API for each option.
        """

        if genre is not None:
            genre_key = genre.lower()
            try:
                genre_config = self._config.genres[genre_key]
            except KeyError as exc:
                raise GenreNotFoundError(f"Unknown genre: {genre}") from exc
            return tuple(sorted(genre_config.scenes.keys()))

        return {
            genre_name: tuple(sorted(genre.scenes.keys()))
            for genre_name, genre in self._config.genres.items()
        }

    def describe_scenes(self) -> Dict[str, List[Dict[str, Any]]]:
        """Return structured scene metadata for each genre.

        The description is a lightweight snapshot of configuration data.  It is
        intentionally serialisable to JSON so the UI can embed it directly in
        the rendered template.
        """

        library: Dict[str, List[Dict[str, Any]]] = {}
        for genre, genre_config in self._config.genres.items():
            entries: List[Dict[str, Any]] = []
            for scene_key, scene_config in genre_config.scenes.items():
                providers = [provider.model_dump() for provider in scene_config.providers]
                entries.append(
                    {
                        "id": scene_key,
                        "name": scene_key.replace("_", " ").title(),
                        "query": scene_config.query,
                        "volume": scene_config.volume,
                        "crossfade": scene_config.crossfade,
                        "cooldown_sec": scene_config.cooldown_sec,
                        "providers": providers,
                        "youtube_playlist_id": scene_config.youtube_playlist_id,
                        "youtube_video_ids": scene_config.youtube_video_ids,
                    }
                )
            library[genre] = sorted(entries, key=lambda item: item["name"])
        return library

    def hysteresis_settings(self) -> Dict[str, Any]:
        """Return a JSON-serialisable view of hysteresis configuration."""

        return self._config.hysteresis.model_dump()

    def recommend(
        self, genre: str, tags: Iterable[str], raw_text: str | None = None
    ) -> RecommendationResult:
        # If raw_text is provided, use AI to extract tags/scene from speech
        if raw_text and raw_text.strip() and self._ai_client:
            # Let the AI determine scene from raw speech text
            normalized_tags = ["speech_input"]  # Marker tag for cache key
            cache_key_rec: Tuple[str, Tuple[str, ...]] = (
                genre.lower(),
                (f"raw:{hash(raw_text.strip())}",),
            )
            cached = self._rec_cache.get(cache_key_rec)
            if cached:
                return cached
            # Use raw text as the prompt for scene recommendation
            prediction, canonical_scene = self._call_ai_with_text(genre, raw_text.strip())
        else:
            # Normalise + sort tags to improve cache hit rate
            normalized_tags = [str(t).strip().lower() for t in tags if str(t).strip()]
            normalized_tags.sort()
            if not normalized_tags:
                raise RecommendationUnavailableError(
                    "Нужен хотя бы один тег или raw_text для рекомендации"
                )
            if not self._ai_client:
                raise RecommendationUnavailableError("Сервис рекомендаций не настроен")

            # Check cache before hitting the external AI
            cache_key_rec = (genre.lower(), tuple(normalized_tags))
            cached = self._rec_cache.get(cache_key_rec)
            if cached:
                return cached

            prediction, canonical_scene = self._call_ai(genre, normalized_tags)

        if canonical_scene:
            base_result = self.search(genre, canonical_scene)
            scene_slug = base_result.scene
            query = base_result.query
            playlists = base_result.playlists
        else:
            fallback = self._config.get_dynamic_defaults(genre)
            if fallback is None:
                raise RecommendationUnavailableError(
                    "Нейросеть вернула неизвестную сцену, а fallback не настроен"
                )
            scene_slug = self._normalize_token(prediction.scene)
            if not scene_slug:
                raise RecommendationUnavailableError(
                    "Не удалось интерпретировать сцену из рекомендаций"
                )
            playlists = [
                provider.build_search(prediction.scene)
                for provider in fallback.providers
            ]
            base_result = SearchResult(
                genre=genre.lower(),
                scene=scene_slug,
                query=prediction.scene,
                playlists=playlists,
                hysteresis=self._config.hysteresis,
            )
            query = prediction.scene
            # Enrich dynamic result using YouTube Data API when available
            # NOTE: Only 1 API call to save quota (each call = 100 units, limit 10,000/day)
            if self._yt is not None:
                try:
                    # Single query attempt - no fallbacks to save quota
                    cleaned = self._sanitize_query_for_youtube(query)
                    ids = self._yt.search_embeddable_video_ids(cleaned or query, max_results=10)
                    if ids:
                        base_result.youtube_video_ids = ids
                except YouTubeApiError:
                    pass
        # Build extended recommendation result based on base_result (either canonical or dynamic)
        result = RecommendationResult(
            genre=base_result.genre,
            scene=scene_slug,
            query=query,
            playlists=playlists,
            hysteresis=base_result.hysteresis,
            youtube_playlist_id=base_result.youtube_playlist_id,
            youtube_video_ids=base_result.youtube_video_ids,
            tags=normalized_tags,
            confidence=prediction.confidence,
            reason=prediction.reason,
        )

        # Store in cache and return
        self._rec_cache.set(cache_key_rec, result)
        return result

    @staticmethod
    def _sanitize_query_for_youtube(value: str) -> str:
        """Remove unsupported/exclusion operators and collapse whitespace.

        YouTube Data API search does not support minus-operators.  This helper
        strips tokens that start with '-' and extra punctuation so that fallback
        requests have a higher chance of returning embeddable results.
        """
        if not value:
            return ""
        tokens = [t.strip() for t in value.replace("\n", " ").split(" ")]
        cleaned = [t for t in tokens if t and not t.startswith("-") and t != "-"]
        return " ".join(cleaned)

    def _call_ai(
        self, genre: str, tags: Iterable[str]
    ) -> Tuple[ScenePrediction, str | None]:
        try:
            prediction = self._ai_client.recommend_scene(genre, tags)  # type: ignore[union-attr]
        except NeuralTaggerError as exc:
            raise RecommendationUnavailableError(str(exc)) from exc

        canonical_scene = self._canonical_scene_slug(genre, prediction.scene)
        return prediction, canonical_scene

    def _call_ai_with_text(
        self, genre: str, raw_text: str
    ) -> Tuple[ScenePrediction, str | None]:
        """Call AI with raw speech text instead of tags.
        
        This allows the AI to interpret natural language from player
        conversations and generate a UNIQUE search query for each phrase.
        We intentionally return None for canonical_scene to ensure the
        AI-generated query is used directly (via fallback path) rather
        than being replaced by a generic config query.
        """
        try:
            prediction = self._ai_client.recommend_scene_from_text(genre, raw_text)  # type: ignore[union-attr]
        except NeuralTaggerError as exc:
            raise RecommendationUnavailableError(str(exc)) from exc

        # IMPORTANT: Return None for canonical_scene to force using AI query directly
        # This ensures "дракон нападает" and "гномы нападают" get different queries
        return prediction, None

    def _canonical_scene_slug(self, genre: str, scene_name: str) -> str | None:
        genre_key = genre.lower()
        try:
            genre_config = self._config.genres[genre_key]
        except KeyError as exc:
            raise GenreNotFoundError(f"Unknown genre: {genre}") from exc

        normalized_scene = self._normalize_token(scene_name)
        if not normalized_scene:
            return None

        scenes = genre_config.scenes

        for scene_id in scenes.keys():
            if self._normalize_token(scene_id) == normalized_scene:
                return scene_id

        prediction_tokens = self._tokenize(scene_name)

        for scene_id in scenes.keys():
            normalized_id = self._normalize_token(scene_id)
            if normalized_id and normalized_id in prediction_tokens:
                return scene_id

        return None

    @staticmethod
    def _normalize_token(value: str) -> str:
        tokens = MusicService._tokenize(value)
        return "_".join(tokens)

    @staticmethod
    def _tokenize(value: str) -> List[str]:
        normalized_value = value.lower().replace("_", " ")
        return [
            part
            for part in re.split(r"[^\w]+", normalized_value, flags=re.UNICODE)
            if part
        ]
