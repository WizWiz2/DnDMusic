"""Business logic for matching music scenes and genres."""
from __future__ import annotations

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
                scenes = self._config.genres[genre_key]
            except KeyError as exc:
                raise GenreNotFoundError(f"Unknown genre: {genre}") from exc
            return tuple(sorted(scenes.keys()))

        return {
            genre_name: tuple(sorted(scenes.keys()))
            for genre_name, scenes in self._config.genres.items()
        }

    def describe_scenes(self) -> Dict[str, List[Dict[str, Any]]]:
        """Return structured scene metadata for each genre.

        The description is a lightweight snapshot of configuration data.  It is
        intentionally serialisable to JSON so the UI can embed it directly in
        the rendered template.
        """

        library: Dict[str, List[Dict[str, Any]]] = {}
        for genre, scenes in self._config.genres.items():
            entries: List[Dict[str, Any]] = []
            for scene_key, scene_config in scenes.items():
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
                    }
                )
            library[genre] = sorted(entries, key=lambda item: item["name"])
        return library

    def hysteresis_settings(self) -> Dict[str, Any]:
        """Return a JSON-serialisable view of hysteresis configuration."""

        return self._config.hysteresis.model_dump()

    def recommend(self, genre: str, tags: Iterable[str]) -> RecommendationResult:
        if not tags:
            raise RecommendationUnavailableError("Нужен хотя бы один тег для рекомендации")
        if not self._ai_client:
            raise RecommendationUnavailableError("Сервис рекомендаций не настроен")

        prediction = self._call_ai(genre, tags)
        base_result = self.search(genre, prediction.scene)
        return RecommendationResult(
            genre=base_result.genre,
            scene=base_result.scene,
            query=base_result.query,
            playlists=base_result.playlists,
            hysteresis=base_result.hysteresis,
            tags=list(tags),
            confidence=prediction.confidence,
            reason=prediction.reason,
        )

    def _call_ai(self, genre: str, tags: Iterable[str]) -> ScenePrediction:
        try:
            prediction = self._ai_client.recommend_scene(genre, tags)  # type: ignore[union-attr]
        except NeuralTaggerError as exc:
            raise RecommendationUnavailableError(str(exc)) from exc

        # проверяем, что выбранная сцена действительно существует
        try:
            self._get_scene_config(genre, prediction.scene)
        except SceneNotFoundError as exc:
            raise RecommendationUnavailableError(
                f"Нейросеть вернула неизвестную сцену '{prediction.scene}'"
            ) from exc
        return prediction
