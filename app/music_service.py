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
        self, config: MusicConfig, *, ai_client: NeuralTaggerClient | None = None
    ) -> None:
        self._config = config
        self._cache = TTLCache[Tuple[str, str], SearchResult](config.hysteresis.cache_ttl_sec)
        self._ai_client = ai_client

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

    def recommend(self, genre: str, tags: Iterable[str]) -> RecommendationResult:
        normalized_tags = list(tags)
        if not normalized_tags:
            raise RecommendationUnavailableError(
                "Нужен хотя бы один тег для рекомендации"
            )
        if not self._ai_client:
            raise RecommendationUnavailableError("Сервис рекомендаций не настроен")

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

        return RecommendationResult(
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

    def _call_ai(
        self, genre: str, tags: Iterable[str]
    ) -> Tuple[ScenePrediction, str | None]:
        try:
            prediction = self._ai_client.recommend_scene(genre, tags)  # type: ignore[union-attr]
        except NeuralTaggerError as exc:
            raise RecommendationUnavailableError(str(exc)) from exc

        canonical_scene = self._canonical_scene_slug(genre, prediction.scene)
        return prediction, canonical_scene

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
