import pytest

from app.config import load_config
from app.music_service import (
    GenreNotFoundError,
    MusicService,
    RecommendationUnavailableError,
    SceneNotFoundError,
)
from app.ai_client import ScenePrediction


@pytest.fixture()
def service(monkeypatch: pytest.MonkeyPatch) -> MusicService:
    config_path = "config/default.yaml"
    monkeypatch.setenv("MUSIC_CONFIG_PATH", config_path)
    return MusicService(load_config())


@pytest.fixture()
def service_with_ai(monkeypatch: pytest.MonkeyPatch) -> MusicService:
    config_path = "config/default.yaml"
    monkeypatch.setenv("MUSIC_CONFIG_PATH", config_path)

    class StubAI:
        def recommend_scene(self, genre: str, tags):
            assert genre in {"fantasy", "cyberpunk"}
            assert tags
            return ScenePrediction(scene="battle", confidence=0.85, reason="stub")

    return MusicService(load_config(), ai_client=StubAI())


def test_search_returns_playlists(service: MusicService) -> None:
    result = service.search("fantasy", "battle")
    assert result.genre == "fantasy"
    assert result.scene == "battle"
    assert result.playlists
    first = result.playlists[0]
    assert first.provider
    assert str(first.url).startswith("https://")


def test_search_uses_cache(service: MusicService) -> None:
    first = service.search("cyberpunk", "tavern")
    second = service.search("cyberpunk", "tavern")
    assert first is second


def test_unknown_genre(service: MusicService) -> None:
    with pytest.raises(GenreNotFoundError):
        service.search("western", "battle")


def test_unknown_scene(service: MusicService) -> None:
    with pytest.raises(SceneNotFoundError):
        service.search("fantasy", "romance")


def test_recommend_uses_ai(service_with_ai: MusicService) -> None:
    result = service_with_ai.recommend("fantasy", ["battle", "dragons"])
    assert result.scene == "battle"
    assert result.confidence == 0.85
    assert result.tags == ["battle", "dragons"]


def test_recommend_normalizes_scene_slug(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MUSIC_CONFIG_PATH", "config/default.yaml")

    class StubAI:
        def recommend_scene(self, genre: str, tags):
            assert genre == "pirate"
            assert tags
            return ScenePrediction(scene="tavern brawl", confidence=0.5, reason="stub")

    service = MusicService(load_config(), ai_client=StubAI())

    result = service.recommend("pirate", ["fight"])
    assert result.scene == "tavern_brawl"
    assert result.confidence == 0.5


def test_recommend_without_ai(service: MusicService) -> None:
    with pytest.raises(RecommendationUnavailableError):
        service.recommend("fantasy", ["battle"])


def test_recommend_unknown_scene_uses_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MUSIC_CONFIG_PATH", "config/default.yaml")

    class StubAI:
        def recommend_scene(self, genre: str, tags):
            assert genre == "fantasy"
            assert tags
            return ScenePrediction(scene="Mysterious Bazaar", confidence=0.42, reason="stub")

    service = MusicService(load_config(), ai_client=StubAI())

    result = service.recommend("fantasy", ["market"])
    assert result.scene == "mysterious_bazaar"
    assert result.query == "Mysterious Bazaar"
    assert result.confidence == 0.42
    assert result.playlists
    assert "Mysterious+Bazaar" in str(result.playlists[0].url)


def test_recommend_without_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MUSIC_CONFIG_PATH", "config/default.yaml")

    config = load_config().model_copy(deep=True)
    config.genres["horror"].dynamic_defaults = None

    class WrongAI:
        def recommend_scene(self, genre: str, tags):
            assert genre == "horror"
            return ScenePrediction(scene="unknown nightmare", confidence=0.3)

    service = MusicService(config, ai_client=WrongAI())

    with pytest.raises(RecommendationUnavailableError):
        service.recommend("horror", ["nightmare"])


def test_recommend_unknown_cyrillic_scene_uses_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("MUSIC_CONFIG_PATH", "config/default.yaml")

    class StubAI:
        def recommend_scene(self, genre: str, tags):
            assert genre == "fantasy"
            assert tags
            return ScenePrediction(
                scene="Драконья Пещера", confidence=0.33, reason="stub"
            )

    service = MusicService(load_config(), ai_client=StubAI())

    result = service.recommend("fantasy", ["dragon"])
    assert result.scene == "драконья_пещера"
    assert result.query == "Драконья Пещера"
    assert result.playlists
