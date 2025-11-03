"""Клиент для обращения к нейросетевому сервису рекомендаций."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable, Optional
from urllib.parse import urlparse

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
        # Режим работы всегда генеративный для HF эндпоинтов

    def recommend_scene(self, genre: str, tags: Iterable[str]) -> ScenePrediction:
        normalized_tags: list[str] = []
        for tag in tags:
            tag_text = str(tag).strip()
            if tag_text:
                normalized_tags.append(tag_text)
        genre_text = str(genre).strip()
        prompt = self._build_prompt(genre_text, normalized_tags)
        if self._should_use_plain_prompt():
            # Генерация текста поиска (text2text/text-generation)
            payload = {
                "inputs": prompt,
                "parameters": {
                    "max_new_tokens": 48,
                    "temperature": 0.7,
                    "return_full_text": False,
                },
            }
        else:
            payload = {"prompt": prompt, "tags": normalized_tags}
            if genre_text:
                payload["genre"] = genre_text

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
            text = response.text
            # Дружественная подсказка, если сконфигурирована zero-shot модель HF
            if (
                self._should_use_plain_prompt()
                and isinstance(text, str)
                and "zero-shot-classification expects" in text
            ):
                raise NeuralTaggerError(
                    "Эндпоинт Hugging Face настроен на zero-shot классификацию. "
                    "Для генерации укажите модель text2text/text-generation, например: "
                    "MUSIC_AI_ENDPOINT=https://api-inference.huggingface.co/models/ai-forever/ruT5-base "
                    "или google/flan-t5-base."
                )
            raise NeuralTaggerError(
                f"Сервис рекомендаций вернул статус {response.status_code}: {text}"
            )

        data = response.json()
        # Surface model-side errors early when they come as JSON payloads
        if isinstance(data, dict) and data.get("error"):
            raise NeuralTaggerError(f"Сервис рекомендаций сообщил ошибку: {data.get('error')}")

        # API сервиса фиксирован, но на практике уже встречались варианты ответа:
        # 1. {"scene": "battle", "confidence": 0.8, "reason": "..."}
        # 2. {"result": {"scene": "battle", ...}}
        # 3. {"scene": {"name": "battle", "confidence": 0.8, "comment": "..."}}
        # 4. HuggingFace zero-shot: {"labels": ["battle", ...], "scores": [0.92, ...], "sequence": "..."}
        payload_data = data.get("result") if isinstance(data, dict) else None
        if isinstance(payload_data, dict):
            scene_block = payload_data.get("scene")
            confidence = payload_data.get("confidence")
            reason = payload_data.get("reason")
        else:
            scene_block = data.get("scene") if isinstance(data, dict) else None
            confidence = data.get("confidence") if isinstance(data, dict) else None
            reason = data.get("reason") if isinstance(data, dict) else None

        # Обработка ответа генеративных моделей Hugging Face
        if scene_block is None:
            # Single-object generation response
            if isinstance(data, dict) and ("generated_text" in data or "summary_text" in data):
                scene_block = data.get("generated_text") or data.get("summary_text")
            # Or list response (e.g. multiple sequences) — take first
            elif isinstance(data, list) and data and isinstance(data[0], dict):
                first = data[0]
                if "generated_text" in first or "summary_text" in first:
                    scene_block = first.get("generated_text") or first.get("summary_text")

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

    def _should_use_plain_prompt(self) -> bool:
        if not self._endpoint:
            return False
        try:
            parsed = urlparse(self._endpoint)
        except ValueError:
            return False
        host = (parsed.hostname or "").lower()
        if not host:
            return False
        return host.endswith("huggingface.co") or host.endswith("hf.space")

    
