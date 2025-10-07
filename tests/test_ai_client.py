import json

import pytest
import httpx

from app.ai_client import NeuralTaggerClient, NeuralTaggerError


def test_neural_client_success() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        payload = json.loads(request.content.decode())
        inputs = payload["inputs"]
        assert inputs["genre"] == "fantasy"
        assert inputs["tags"] == ["battle"]
        assert inputs["prompt"] == "Жанр: fantasy. Теги: battle"
        assert inputs["tags_text"] == "battle"
        return httpx.Response(200, json={"scene": "battle", "confidence": 0.88, "reason": "stub"})

    client = NeuralTaggerClient(endpoint="http://test", transport=httpx.MockTransport(handler))
    prediction = client.recommend_scene("fantasy", ["battle"])
    assert prediction.scene == "battle"
    assert prediction.confidence == pytest.approx(0.88)
    assert prediction.reason == "stub"


def test_neural_client_error_status() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    client = NeuralTaggerClient(endpoint="http://test", transport=httpx.MockTransport(handler))
    with pytest.raises(NeuralTaggerError):
        client.recommend_scene("fantasy", ["battle"])


def test_neural_client_nested_scene() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode())
        assert payload["inputs"]["prompt"] == "Жанр: fantasy. Теги: battle, dragons"
        assert payload["inputs"]["tags_text"] == "battle, dragons"
        return httpx.Response(
            200,
            json={
                "result": {
                    "scene": {"name": "BATTLE", "confidence": 0.73, "comment": "ok"},
                    "reason": "extra",
                }
            },
        )

    client = NeuralTaggerClient(endpoint="http://test", transport=httpx.MockTransport(handler))
    prediction = client.recommend_scene("fantasy", ["battle", "dragons"])
    assert prediction.scene == "battle"
    assert prediction.confidence == pytest.approx(0.73)
    assert prediction.reason == "extra"


def test_neural_client_fallback_prompt() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode())
        assert payload["inputs"]["tags"] == []
        assert payload["inputs"]["prompt"] == "Жанр: fantasy"
        assert "tags_text" not in payload["inputs"]
        return httpx.Response(200, json={"scene": "city"})

    client = NeuralTaggerClient(endpoint="http://test", transport=httpx.MockTransport(handler))
    prediction = client.recommend_scene("fantasy", [])
    assert prediction.scene == "city"


def test_neural_client_prompt_without_genre_and_tags() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content.decode())
        assert payload["inputs"]["genre"] == ""
        assert payload["inputs"]["tags"] == []
        assert payload["inputs"]["prompt"] == "Музыкальная сцена"
        return httpx.Response(200, json={"scene": "mystery"})

    client = NeuralTaggerClient(endpoint="http://test", transport=httpx.MockTransport(handler))
    prediction = client.recommend_scene("", [" ", ""])
    assert prediction.scene == "mystery"
