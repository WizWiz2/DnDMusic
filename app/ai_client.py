"""Клиент для обращения к нейросетевому сервису рекомендаций."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable, Optional, List, Dict
from urllib.parse import urlparse

import httpx
from .config import load_config


DEFAULT_ENDPOINT = "http://localhost:8081/api/v1/recommend"
DEFAULT_TIMEOUT = 30.0
ENV_ENDPOINT = "MUSIC_AI_ENDPOINT"
ENV_TOKEN = "MUSIC_AI_TOKEN"
ENV_TIMEOUT = "MUSIC_AI_TIMEOUT"
ENV_HF_LABELS = "MUSIC_AI_CANDIDATE_LABELS"


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
        # Optional override: comma-separated or JSON-like list of labels
        self._hf_labels_env: Optional[List[str]] = self._parse_labels_env(os.getenv(ENV_HF_LABELS))
        self._labels_cache: Dict[str, List[str]] = {}

    def recommend_scene(self, genre: str, tags: Iterable[str]) -> ScenePrediction:
        normalized_tags: list[str] = []
        for tag in tags:
            tag_text = str(tag).strip()
            if tag_text:
                normalized_tags.append(tag_text)
        genre_text = str(genre).strip()
        prompt = self._build_prompt(genre_text, normalized_tags)
        if self._should_use_plain_prompt():
            # Hugging Face zero-shot classification expects candidate labels
            labels = self._candidate_labels_for_genre(genre_text)
            payload: dict[str, object] = {"inputs": prompt}
            if labels:
                payload["parameters"] = {"candidate_labels": labels}
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
            raise NeuralTaggerError(
                f"Сервис рекомендаций вернул статус {response.status_code}: {response.text}"
            )

        data = response.json()

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

        # Hugging Face zero-shot format handling
        if scene_block is None and isinstance(data, dict) and "labels" in data and isinstance(data.get("labels"), list):
            labels_list = data.get("labels") or []
            scores_list = data.get("scores") or []
            if labels_list:
                scene_block = labels_list[0]
                if not confidence and isinstance(scores_list, list) and scores_list:
                    confidence = scores_list[0]

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

    def _candidate_labels_for_genre(self, genre: str | None) -> List[str]:
        """Return candidate labels for HF zero-shot classification.

        Priority:
        - Explicit env override via MUSIC_AI_CANDIDATE_LABELS
        - Scenes of the provided genre from the loaded config
        - Fallback: all scenes across all genres
        """
        # Env override, if provided
        if self._hf_labels_env:
            return self._hf_labels_env

        key = (genre or "").strip().lower() or "__all__"
        if key in self._labels_cache:
            return self._labels_cache[key]

        try:
            cfg = load_config()
        except Exception:
            self._labels_cache[key] = []
            return []

        labels: List[str] = []
        if genre:
            g = cfg.genres.get(key)
            if g and g.scenes:
                labels = sorted(g.scenes.keys())
        if not labels:
            # Fallback to union across all genres
            seen = set()
            for g in cfg.genres.values():
                for s in g.scenes.keys():
                    if s not in seen:
                        seen.add(s)
                        labels.append(s)
            labels.sort()

        self._labels_cache[key] = labels
        return labels

    @staticmethod
    def _parse_labels_env(value: Optional[str]) -> Optional[List[str]]:
        if not value:
            return None
        raw = value.strip()
        if not raw:
            return None
        # Accept either comma-separated or JSON-like [..]
        if raw.startswith("[") and raw.endswith("]"):
            try:
                # Minimal safe eval for JSON arrays
                import json as _json

                arr = _json.loads(raw)
                return [str(x).strip() for x in arr if str(x).strip()]
            except Exception:
                pass
        # Fallback: comma/semicolon separated list
        parts = [p.strip() for p in raw.replace(";", ",").split(",")]
        items = [p for p in parts if p]
        return items or None
