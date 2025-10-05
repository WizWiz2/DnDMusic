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
