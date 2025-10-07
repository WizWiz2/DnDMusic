"""Клиент для обращения к нейросетевому сервису рекомендаций."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable, Optional

import httpx


DEFAULT_ENDPOINT = "http://localhost:8081/api/v1/recommend"
DEFAULT_TIMEOUT = 30.0
ENV_ENDPOINT = "MUSIC_AI_ENDPOINT"
ENV_TOKEN = "MUSIC_AI_TOKEN"
ENV_TIMEOUT = "MUSIC_AI_TIMEOUT"


class NeuralTaggerError(RuntimeError):
    """Базовая ошибка при обращении к нейросетевому сервису."""


@dataclass(slots=True)
class ScenePrediction:
    """Результат от нейросетевого сервиса."""

    scene: str
    confidence: Optional[float] = None
    reason: Optional[str] = None


class NeuralTaggerClient:
    """HTTP-клиент, вызывающий внешний сервис выбора сцены."""

    def __init__(
        self,
        endpoint: str | None = None,
        *,
        timeout: float | None = None,
        token: str | None = None,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        raw_endpoint = endpoint or os.getenv(ENV_ENDPOINT, DEFAULT_ENDPOINT)
        self._endpoint = str(raw_endpoint).strip()
        self._timeout = self._resolve_timeout(timeout)
        self._token = token or os.getenv(ENV_TOKEN)
        self._transport = transport

    def recommend_scene(self, genre: str, tags: Iterable[str]) -> ScenePrediction:
        normalized_tags: list[str] = []
        for tag in tags:
            tag_text = str(tag).strip()
            if tag_text:
                normalized_tags.append(tag_text)
        genre_text = str(genre).strip()
        tags_text = ", ".join(normalized_tags)
        prompt = self._build_prompt(genre_text, normalized_tags)
        inputs_payload: dict[str, object] = {
            "genre": genre,
            "tags": normalized_tags,
            "prompt": prompt,
        }
        if tags_text:
            inputs_payload["tags_text"] = tags_text

        payload: dict[str, object] = {"inputs": inputs_payload}
        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"

        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                response = client.post(self._endpoint, json=payload, headers=headers)
        except httpx.HTTPError as exc:  # pragma: no cover - сеть может вести себя по-разному
            details = str(exc).strip()
            message = "Не удалось обратиться к сервису рекомендаций"
            if self._endpoint:
                message = f"{message} ({self._endpoint})"
            if details:
                message = f"{message}: {details}"
            raise NeuralTaggerError(message) from exc

        if response.status_code != 200:
            raise NeuralTaggerError(
                f"Сервис рекомендаций вернул статус {response.status_code}: {response.text}"
            )

        data = response.json()

        # API сервиса фиксирован, но на практике уже встречались варианты ответа:
        # 1. {"scene": "battle", "confidence": 0.8, "reason": "..."}
        # 2. {"result": {"scene": "battle", ...}}
        # 3. {"scene": {"name": "battle", "confidence": 0.8, "comment": "..."}}
        payload_data = data.get("result") if isinstance(data, dict) else None
        if isinstance(payload_data, dict):
            scene_block = payload_data.get("scene")
            confidence = payload_data.get("confidence")
            reason = payload_data.get("reason")
        else:
            scene_block = data.get("scene") if isinstance(data, dict) else None
            confidence = data.get("confidence") if isinstance(data, dict) else None
            reason = data.get("reason") if isinstance(data, dict) else None

        raw_scene: Optional[str]
        if isinstance(scene_block, dict):
            raw_scene = (
                scene_block.get("name")
                or scene_block.get("value")
                or scene_block.get("slug")
                or scene_block.get("scene")
            )
            confidence = confidence or scene_block.get("confidence") or scene_block.get("score")
            reason = reason or scene_block.get("reason") or scene_block.get("comment") or scene_block.get("explanation")
        else:
            raw_scene = scene_block
            if isinstance(data, dict) and confidence is None:
                confidence = data.get("score")
            if isinstance(data, dict) and reason is None:
                reason = data.get("comment") or data.get("explanation")

        if not raw_scene:
            raise NeuralTaggerError("Ответ сервиса не содержит сцены")

        if confidence is not None:
            try:
                confidence = float(confidence)
            except (TypeError, ValueError) as exc:  # pragma: no cover - защитный код
                raise NeuralTaggerError("Неверное значение confidence в ответе сервиса") from exc
        return ScenePrediction(scene=str(raw_scene).lower(), confidence=confidence, reason=reason)

    @staticmethod
    def _build_prompt(genre: str, tags: list[str]) -> str:
        """Собирает осмысленную текстовую подсказку для сервиса."""

        prompt_parts: list[str] = []
        if genre:
            prompt_parts.append(f"Жанр: {genre}")
        if tags:
            prompt_parts.append(f"Теги: {', '.join(tags)}")
        if prompt_parts:
            return ". ".join(prompt_parts)
        return "Музыкальная сцена"

    def _resolve_timeout(self, timeout: float | None) -> float:
        if timeout is not None:
            return float(timeout)

        env_timeout = os.getenv(ENV_TIMEOUT)
        if env_timeout:
            try:
                return float(env_timeout)
            except ValueError as exc:
                raise ValueError(
                    f"Неверное значение таймаута '{env_timeout}' в переменной {ENV_TIMEOUT}"
                ) from exc

        return DEFAULT_TIMEOUT
