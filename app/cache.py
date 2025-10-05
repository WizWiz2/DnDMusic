"""Простейший in-memory TTL кэш."""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Dict, Generic, Optional, Tuple, TypeVar


K = TypeVar("K")
V = TypeVar("V")


@dataclass
class _CacheEntry(Generic[V]):
    value: V
    expires_at: float


class TTLCache(Generic[K, V]):
    """Неблокирующий кэш с абсолютным временем жизни."""

    def __init__(self, ttl_seconds: int) -> None:
        self._ttl = ttl_seconds
        self._storage: Dict[K, _CacheEntry[V]] = {}

    def get(self, key: K) -> Optional[V]:
        entry = self._storage.get(key)
        if not entry:
            return None
        if entry.expires_at < time.time():
            self._storage.pop(key, None)
            return None
        return entry.value

    def set(self, key: K, value: V) -> None:
        expires_at = time.time() + self._ttl
        self._storage[key] = _CacheEntry(value=value, expires_at=expires_at)

    def clear(self) -> None:
        self._storage.clear()

    def stats(self) -> Tuple[int, int]:
        """Возвращает количество элементов и TTL."""
        return len(self._storage), self._ttl
