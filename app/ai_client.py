"""Клиент для обращения к нейросетевому сервису рекомендаций."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Iterable, Optional, List, Dict
from urllib.parse import urlparse, parse_qs, urlunparse

import httpx
from .config import load_config


DEFAULT_ENDPOINT = "http://localhost:8081/api/v1/recommend"
DEFAULT_TIMEOUT = 30.0
ENV_ENDPOINT = "MUSIC_AI_ENDPOINT"
ENV_TOKEN = "MUSIC_AI_TOKEN"
ENV_TIMEOUT = "MUSIC_AI_TIMEOUT"
ENV_HF_LABELS = "MUSIC_AI_CANDIDATE_LABELS"
ENV_OAI_MODEL = "MUSIC_AI_OAI_MODEL"  # Модель для OpenAI-совместимых провайдеров (например, Groq)


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
        self._endpoint = self._normalize_endpoint(str(raw_endpoint).strip())
        self._timeout = self._resolve_timeout(timeout)
        self._token = token or os.getenv(ENV_TOKEN)
        self._transport = transport
        # Режим работы всегда генеративный для HF эндпоинтов
        # Опциональный оверрайд списка меток для zero-shot fallback
        self._hf_labels_env: Optional[List[str]] = self._parse_labels_env(os.getenv(ENV_HF_LABELS))
        self._labels_cache: Dict[str, List[str]] = {}
        # Имя модели для OpenAI-совместимых API (если передано отдельно)
        self._oai_model_env: Optional[str] = (os.getenv(ENV_OAI_MODEL, "").strip() or None)

    def recommend_scene(self, genre: str, tags: Iterable[str]) -> ScenePrediction:
        normalized_tags: list[str] = []
        for tag in tags:
            tag_text = str(tag).strip()
            if tag_text:
                normalized_tags.append(tag_text)
        genre_text = str(genre).strip()
        prompt = self._build_prompt(genre_text, normalized_tags)

        # Ветвление: OpenAI-совместимый endpoint (например, Groq) — работаем через /chat/completions
        if self._is_openai_chat_endpoint(self._endpoint):
            return self._call_openai_chat(self._endpoint, prompt)
        if self._should_use_plain_prompt():
            # 1) Попытка генерации текста
            gen_payload = {
                "inputs": prompt,
                "parameters": {
                    "max_new_tokens": 48,
                    "temperature": 0.7,
                    "return_full_text": False,
                },
                "options": {  # см. HF Inference API
                    "wait_for_model": True,
                    "use_cache": True,
                },
            }
            payload = gen_payload
        else:
            payload = {"prompt": prompt, "tags": normalized_tags}
            if genre_text:
                payload["genre"] = genre_text

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            # Просим роутер дождаться прогрева модели, чтобы не ловить 503
            "X-Wait-For-Model": "true",
        }
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"

        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                # Порядок попыток: заданный endpoint → альтернативный (router/api-inference)
                attempt_urls: list[str] = [self._endpoint]
                alt = self._alt_hf_endpoint(self._endpoint)
                if alt and alt != self._endpoint:
                    attempt_urls.append(alt)

                response = None  # type: ignore[assignment]
                last_exc: Exception | None = None
                for url in attempt_urls:
                    try:
                        resp = client.post(url, json=payload, headers=headers)
                        if resp.status_code == 200:
                            response = resp
                            break
                        # Если не 200, пробуем следующий URL (если он есть)
                        response = resp
                    except httpx.HTTPError as e:  # pragma: no cover
                        last_exc = e
                        continue
                if response is None and last_exc is not None:
                    raise last_exc
        except httpx.HTTPError as exc:  # pragma: no cover - сеть может вести себя по-разному
            details = str(exc).strip()
            message = "Не удалось обратиться к сервису рекомендаций"
            if self._endpoint:
                message = f"{message} ({self._endpoint})"
            if details:
                message = f"{message}: {details}"
            raise NeuralTaggerError(message) from exc

        # Если HF сообщил, что это zero-shot классификатор — пробуем fallback с метками
        if (
            response.status_code != 200
            and self._should_use_plain_prompt()
            and isinstance(response.text, str)
            and "zero-shot-classification expects" in response.text
        ):
            labels = self._candidate_labels_for_genre(genre_text)
            if not labels:
                raise NeuralTaggerError(
                    "Модель требует candidate_labels, но список меток не удалось собрать. "
                    "Проверьте конфиг жанров или задайте MUSIC_AI_CANDIDATE_LABELS."
                )
            zs_payload = {"inputs": prompt, "parameters": {"candidate_labels": labels}}
            try:
                with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                    response = client.post(self._endpoint, json=zs_payload, headers=headers)
            except httpx.HTTPError as exc:  # pragma: no cover
                details = str(exc).strip()
                message = "Не удалось обратиться к zero-shot модели"
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
            # Улучшим диагностику для Hugging Face
            if self._is_hf_host(self._endpoint) and response.status_code in (401, 403, 404, 410):
                hint = (
                    "Проверьте MUSIC_AI_TOKEN (требуется авторизация), корректность имени модели "
                    "(учитывается регистр: например ai-forever/ruT5-base). Допустимы URL: "
                    "router (https://router.huggingface.co/hf-inference/models/<org>/<model>) "
                    "или api-inference (https://api-inference.huggingface.co/models/<org>/<model>)."
                )
                raise NeuralTaggerError(
                    f"Hugging Face вернул {response.status_code}. {hint} Текст: {text}"
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

        # Обработка ответа HF: генерация или zero-shot
        if scene_block is None:
            # Single-object generation response
            if isinstance(data, dict) and ("generated_text" in data or "summary_text" in data):
                scene_block = data.get("generated_text") or data.get("summary_text")
            # Or list response (e.g. multiple sequences) — take first
            elif isinstance(data, list) and data and isinstance(data[0], dict):
                first = data[0]
                if "generated_text" in first or "summary_text" in first:
                    scene_block = first.get("generated_text") or first.get("summary_text")
            # Zero-shot format: {labels: [...], scores: [...]}
            if scene_block is None and isinstance(data, dict) and isinstance(data.get("labels"), list):
                labels_list = data.get("labels") or []
                scores_list = data.get("scores") or []
                if labels_list:
                    scene_block = labels_list[0]
                    if not confidence and isinstance(scores_list, list) and scores_list:
                        confidence = scores_list[0]
            elif scene_block is None and isinstance(data, list) and data and isinstance(data[0], dict):
                first = data[0]
                labels_list = first.get("labels") or []
                scores_list = first.get("scores") or []
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

    # --- OpenAI-compatible (Groq, LM Studio, OpenRouter, Ollama via proxy) ---

    def _is_openai_chat_endpoint(self, url: str) -> bool:
        if not url:
            return False
        try:
            parsed = urlparse(url)
        except Exception:
            return False
        path = (parsed.path or "").lower()
        host = (parsed.hostname or "").lower()
        return "/chat/completions" in path or host.endswith("api.groq.com") or "/openai/" in path

    def _extract_oai_model(self, url: str) -> Optional[str]:
        try:
            parsed = urlparse(url)
        except Exception:
            return self._oai_model_env
        # model из query (?model=...)
        q = parse_qs(parsed.query or "")
        model = (q.get("model", [None])[0] or "").strip()
        if model:
            return model
        # неофициальный формат: /chat/completions/<model>
        if "/chat/completions/" in (parsed.path or ""):
            tail = (parsed.path or "").split("/chat/completions/")[-1].strip("/")
            if tail:
                return tail
        return self._oai_model_env

    def _normalize_oai_url(self, url: str) -> str:
        """Удалить model из пути/квери, оставить чистый /chat/completions."""
        try:
            parsed = urlparse(url)
        except Exception:
            return url
        path = parsed.path or ""
        if "/chat/completions/" in path:
            path = path[: path.rfind("/chat/completions/")] + "/chat/completions"
        parsed = parsed._replace(path=path, query="")
        return urlunparse(parsed)

    def _call_openai_chat(self, endpoint: str, prompt: str) -> ScenePrediction:
        model = self._extract_oai_model(endpoint)
        if not model:
            raise NeuralTaggerError(
                "Не задана модель для OpenAI-совместимого эндпоинта. "
                f"Добавьте '?model=...' к URL или переменную {ENV_OAI_MODEL}."
            )

        url = self._normalize_oai_url(endpoint)
        sys_prompt = (
            "You produce a single short English search query for background instrumental music. "
            "Rules: return ONLY the query text, 3-6 words, no quotes, no trailing punctuation. "
            "Prefer adding '-vocals'. Avoid words like lyrics, vocal, lofi, podcast. "
            "Use given hints when present."
        )

        # Add lightweight EN keyword hints for RU tags/genres to stabilize generation
        en_hints = self._build_en_hints_from_ru(prompt)
        user_content = prompt if not en_hints else f"{prompt}\nHints (EN keywords): {', '.join(en_hints)}"

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": sys_prompt},
                {"role": "user", "content": user_content},
            ],
            "temperature": 0.4,
            "max_tokens": 32,
        }

        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        # Разрешаем использовать общий MUSIC_AI_TOKEN
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"

        try:
            with httpx.Client(timeout=self._timeout, transport=self._transport) as client:
                resp = client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as exc:  # pragma: no cover
            raise NeuralTaggerError(f"Не удалось обратиться к OpenAI-совместимому сервису ({url}): {exc}") from exc
        if resp.status_code != 200:
            raise NeuralTaggerError(
                f"OpenAI-совместимый сервис вернул статус {resp.status_code}: {resp.text}"
            )
        data = resp.json()
        try:
            content = data["choices"][0]["message"]["content"]
        except Exception as exc:
            raise NeuralTaggerError("Ответ OpenAI-совместимого сервиса не содержит результата") from exc
        text = str(content or "").strip()
        text = " ".join(text.split())
        if not text:
            raise NeuralTaggerError("Пустой ответ от генеративной модели")
        return ScenePrediction(scene=text.lower())

    def _build_en_hints_from_ru(self, prompt_text: str) -> List[str]:
        text = (prompt_text or "").lower()
        hints: List[str] = []

        # Generic music constraints
        base = ["instrumental", "background", "soundtrack"]

        # Genre heuristics
        if "fantasy" in text or "фэнтези" in text or "средневек" in text:
            hints += ["epic", "medieval", "fantasy"]
        if "cyberpunk" in text or "киберпанк" in text:
            hints += ["cyberpunk", "synthwave", "neon"]
        if "horror" in text or "ужас" in text or "хоррор" in text:
            hints += ["dark ambient", "horror"]
        if "sci" in text or "науч" in text or "космос" in text or "space" in text:
            hints += ["space", "ambient"]
        if "post" in text or "пустош" in text:
            hints += ["post apocalyptic"]
        if "steampunk" in text or "стимпанк" in text:
            hints += ["steampunk"]

        # RU → EN tag keywords (substring-based)
        mapping: List[tuple[List[str], List[str]]] = [
            (["драка", "бой", "битва", "сраж"], ["battle"]),
            (["дракон", "драко"], ["dragon"]),
            (["таверн"], ["tavern", "medieval"]),
            (["погон"], ["chase", "dnb"]),
            (["стелс", "скрыт", "шпион"], ["stealth"]),
            (["ритуал", "обряд"], ["ritual"]),
            (["исслед", "развед"], ["exploration", "ambient"]),
            (["трактир", "бар"], ["bar", "lounge"]),
            (["лес", "дебр"], ["forest"]),
            (["пещер", "подзем", "данж"], ["dungeon"]),
            (["город"], ["city"]),
            (["страш", "жутк", "кошмар"], ["creepy", "dark"]),
        ]
        for triggers, words in mapping:
            if any(t in text for t in triggers):
                for w in words:
                    if w not in hints:
                        hints.append(w)

        # Always include base constraints at the end
        for w in base:
            if w not in hints:
                hints.append(w)

        return hints[:10]

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

    @staticmethod
    def _normalize_endpoint(value: str) -> str:
        """Поправляет сокращённые значения эндпоинта для Hugging Face.

        Допустимые сокращения:
        - "google/flan-t5-base" → "https://api-inference.huggingface.co/models/google/flan-t5-base"
        - "models/google/flan-t5-base" → "https://api-inference.huggingface.co/models/google/flan-t5-base"
        Иначе — возвращает как есть.
        """
        if not value:
            return value
        lower = value.lower().strip()
        # Уже полноценный URL — вернуть как есть
        if lower.startswith("http://") or lower.startswith("https://"):
            return value
        # "models/..." без схемы
        if lower.startswith("models/"):
            return f"https://api-inference.huggingface.co/{value.lstrip('/')}"
        # Шаблон org/model
        if "/" in lower and not lower.startswith("/"):
            # Похоже на <org>/<model>
            return f"https://api-inference.huggingface.co/models/{value.lstrip('/')}"
        return value

    @staticmethod
    def _is_hf_host(url: str) -> bool:
        try:
            host = (urlparse(url).hostname or "").lower()
        except Exception:
            return False
        return bool(host) and (host.endswith("huggingface.co") or host.endswith("hf.space"))

    @staticmethod
    def _alt_hf_endpoint(url: str) -> Optional[str]:
        """Вернуть альтернативный endpoint HF для совместимости.

        - router → api-inference
        - api-inference → router
        - короткие формы/"models/..." обрабатываются в _normalize_endpoint
        """
        try:
            parsed = urlparse(url)
        except Exception:
            return None
        host = (parsed.hostname or "").lower()
        path = parsed.path or ""
        if not host:
            return None
        parts = [p for p in path.split("/") if p]

        # Извлечь org/model из пути, если возможно
        model_id: Optional[str] = None
        if "models" in parts:
            idx = parts.index("models")
            tail = parts[idx + 1 :]
            if tail:
                model_id = "/".join(tail)

        if not model_id or "/" not in model_id:
            return None

        if "router.huggingface.co" in host:
            return f"https://api-inference.huggingface.co/models/{model_id}"
        if "api-inference.huggingface.co" in host:
            return f"https://router.huggingface.co/hf-inference/models/{model_id}"
        return None

    def _candidate_labels_for_genre(self, genre: str | None) -> List[str]:
        """Собрать список сцен как метки для zero-shot.

        Приоритет:
        - MUSIC_AI_CANDIDATE_LABELS (через запятую или JSON-массив)
        - сцены выбранного жанра из конфига
        - объединение всех сцен
        """
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
        if raw.startswith("[") and raw.endswith("]"):
            try:
                import json as _json

                arr = _json.loads(raw)
                return [str(x).strip() for x in arr if str(x).strip()]
            except Exception:
                pass
        parts = [p.strip() for p in raw.replace(";", ",").split(",")]
        items = [p for p in parts if p]
        return items or None

    
