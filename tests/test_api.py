import json
import re

from fastapi.testclient import TestClient

from app.api import app, get_ai_client, get_config, get_service, get_service_cached
from app.music_service import MusicService
from app.config import load_config
from app.ai_client import ScenePrediction


def _reset_caches() -> None:
    get_service_cached.cache_clear()
    get_config.cache_clear()
    get_ai_client.cache_clear()


def test_health_endpoint(monkeypatch) -> None:
    monkeypatch.setenv("MUSIC_CONFIG_PATH", "config/default.yaml")
    _reset_caches()
    client = TestClient(app)
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "fantasy" in data["genres"]


def test_search_endpoint(monkeypatch) -> None:
    monkeypatch.setenv("MUSIC_CONFIG_PATH", "config/default.yaml")
    _reset_caches()
    client = TestClient(app)
    response = client.get("/api/search", params={"genre": "horror", "scene": "tension"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["genre"] == "horror"
    assert payload["scene"] == "tension"
    assert len(payload["playlists"]) >= 1


def test_search_unknown_scene(monkeypatch) -> None:
    monkeypatch.setenv("MUSIC_CONFIG_PATH", "config/default.yaml")
    _reset_caches()
    client = TestClient(app)
    response = client.get("/api/search", params={"genre": "horror", "scene": "party"})
    assert response.status_code == 404


def test_recommend_endpoint(monkeypatch) -> None:
    monkeypatch.setenv("MUSIC_CONFIG_PATH", "config/default.yaml")
    _reset_caches()

    class StubAI:
        def recommend_scene(self, genre: str, tags):
            assert genre == "fantasy"
            assert tags == ["battle", "dragons"]
            return ScenePrediction(scene="battle", confidence=0.91, reason="stub")

    service = MusicService(load_config(), ai_client=StubAI())

    client = TestClient(app)
    app.dependency_overrides[get_service] = lambda: service

    response = client.post(
        "/api/recommend",
        json={"genre": "fantasy", "tags": ["battle", "dragons"]},
    )

    try:
        assert response.status_code == 200
        payload = response.json()
        assert payload["scene"] == "battle"
        assert payload["confidence"] == 0.91
        assert payload["tags"] == ["battle", "dragons"]
        assert payload["reason"] == "stub"
    finally:
        app.dependency_overrides.clear()


def test_ui_page(monkeypatch) -> None:
    monkeypatch.setenv("MUSIC_CONFIG_PATH", "config/default.yaml")
    _reset_caches()
    client = TestClient(app)
    response = client.get("/")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")
    body = response.text
    assert "RPG Auto-DJ" in body

    script_match = re.search(
        r"<script id=\"initial-data\" type=\"application/json\">(.*?)</script>",
        body,
        re.S,
    )
    assert script_match is not None, "initialData payload is not embedded in the page"

    payload_raw = script_match.group(1)
    payload = json.loads(payload_raw)
    assert payload["genres"], "Список жанров должен быть заполнен"
    assert "scenes" in payload and payload["scenes"], "Ожидаем метаданные сцен"
    assert "hysteresis" in payload and payload["hysteresis"], "Должны быть настройки антидребезга"

    # Проверяем, что опасные последовательности экранированы и не ломают <script>.
    assert "</script" not in payload_raw


def test_ui_page_legacy_path(monkeypatch) -> None:
    monkeypatch.setenv("MUSIC_CONFIG_PATH", "config/default.yaml")
    _reset_caches()
    client = TestClient(app)
    response = client.get("/ui")
    assert response.status_code == 200
    assert "text/html" in response.headers.get("content-type", "")
    body = response.text
    assert "RPG Auto-DJ" in body

    script_match = re.search(
        r"<script id=\"initial-data\" type=\"application/json\">(.*?)</script>",
        body,
        re.S,
    )
    assert script_match is not None, "initialData payload is not embedded in the page"

    payload_raw = script_match.group(1)
    payload = json.loads(payload_raw)
    assert payload["genres"], "Список жанров должен быть заполнен"
    assert "scenes" in payload and payload["scenes"], "Ожидаем метаданные сцен"
    assert "hysteresis" in payload and payload["hysteresis"], "Должны быть настройки антидребезга"

    # Проверяем, что опасные последовательности экранированы и не ломают <script>.
    assert "</script" not in payload_raw
