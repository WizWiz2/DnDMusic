"""Domain and API models for the music service."""
from __future__ import annotations

from typing import Dict, List, Optional

from urllib.parse import quote_plus

from pydantic import BaseModel, Field, HttpUrl, field_validator


class PlaylistProviderConfig(BaseModel):
    """Описание провайдера плейлистов и способ построения ссылки поиска."""

    name: str = Field(..., description="Человекочитаемое имя провайдера")
    url_template: str = Field(
        ..., description="URL-шаблон со вставкой {query} для поисковой строки"
    )
    description: Optional[str] = Field(
        None, description="Опциональное описание для отображения фронтендом"
    )

    @field_validator("url_template")
    @classmethod
    def _check_template(cls, value: str) -> str:
        if "{query}" not in value:
            raise ValueError("url_template must contain '{query}' placeholder")
        return value

    def build_search(self, query: str) -> "PlaylistSearch":
        encoded = quote_plus(query)
        url = self.url_template.format(query=encoded)
        return PlaylistSearch(provider=self.name, url=url, description=self.description)


class PlaylistSearch(BaseModel):
    """Готовая ссылка на поиск плейлиста у внешнего провайдера."""

    provider: str = Field(..., description="Название провайдера (например, YouTube)")
    url: HttpUrl = Field(..., description="Сформированный URL поиска")
    description: Optional[str] = Field(None, description="Описание для UI")


class SceneConfig(BaseModel):
    """Настройки сцены внутри жанра."""

    query: str = Field(..., description="Поисковый запрос для внешних API")
    volume: Optional[int] = Field(None, ge=0, le=100, description="Рекомендуемая громкость")
    crossfade: Optional[int] = Field(None, ge=0, le=30, description="Время кроссфейда в секундах")
    cooldown_sec: Optional[int] = Field(
        None, ge=0, description="Рекомендуемое значение антидребезга"
    )
    providers: List[PlaylistProviderConfig] = Field(
        default_factory=list, description="Список провайдеров плейлистов"
    )


class DynamicSceneConfig(BaseModel):
    """Настройки по умолчанию для динамических сцен внутри жанра."""

    volume: Optional[int] = Field(None, ge=0, le=100, description="Рекомендуемая громкость")
    crossfade: Optional[int] = Field(None, ge=0, le=30, description="Время кроссфейда в секундах")
    cooldown_sec: Optional[int] = Field(
        None, ge=0, description="Рекомендуемое значение антидребезга"
    )
    providers: List[PlaylistProviderConfig] = Field(
        default_factory=list, description="Список провайдеров плейлистов"
    )


class GenreConfig(BaseModel):
    """Конфигурация жанра, включающая сцены и fallback для динамических запросов."""

    scenes: Dict[str, SceneConfig] = Field(
        default_factory=dict, description="Явно описанные сцены жанра"
    )
    dynamic_defaults: Optional[DynamicSceneConfig] = Field(
        None,
        description="Настройки по умолчанию для сцен, отсутствующих в явной конфигурации",
    )


class HysteresisConfig(BaseModel):
    """Параметры антидребезга, возвращаемые фронтенду."""

    min_confidence: float = Field(..., ge=0.0, le=1.0)
    window_sec: int = Field(..., ge=1)
    cooldown_sec: int = Field(..., ge=0)
    cache_ttl_sec: int = Field(600, ge=0, description="Время жизни кэша в секундах")


class MusicConfig(BaseModel):
    """Вся конфигурация проекта."""

    genres: Dict[str, GenreConfig]
    hysteresis: HysteresisConfig

    def get_scene(self, genre: str, scene: str) -> SceneConfig:
        genre_config = self._get_genre_config(genre)
        scene_key = scene.lower()
        if scene_key not in genre_config.scenes:
            raise KeyError(f"Unknown scene '{scene}' for genre '{genre}'")
        return genre_config.scenes[scene_key]

    def get_dynamic_defaults(self, genre: str) -> Optional[DynamicSceneConfig]:
        genre_config = self._get_genre_config(genre)
        return genre_config.dynamic_defaults

    def _get_genre_config(self, genre: str) -> GenreConfig:
        genre_key = genre.lower()
        if genre_key not in self.genres:
            raise KeyError(f"Unknown genre: {genre}")
        return self.genres[genre_key]


class SearchResult(BaseModel):
    """Результат поискового запроса."""

    genre: str
    scene: str
    query: str
    playlists: List[PlaylistSearch]
    hysteresis: HysteresisConfig


class RecommendationRequest(BaseModel):
    """Запрос на рекомендацию сцены по тегам."""

    genre: str = Field(..., description="Жанр кампании")
    tags: List[str] = Field(..., min_length=1, description="Набор тегов от детектора событий")


class RecommendationResult(SearchResult):
    """Расширенный результат, дополненный данными от нейросети."""

    tags: List[str] = Field(..., description="Теги, на основе которых принималось решение")
    confidence: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="Уверенность нейросетевого сервиса",
    )
    reason: Optional[str] = Field(
        None, description="Текстовое объяснение от модели, если доступно"
    )


class HealthStatus(BaseModel):
    """Состояние сервиса для эндпоинта здоровья."""

    status: str = "ok"
    genres: List[str] = Field(default_factory=list)
