"""Lightweight YouTube Data API v3 client for embeddable search.

The client is intentionally minimal: it performs a ``search.list`` request to
retrieve candidate video IDs with ``videoEmbeddable=true`` and then verifies
the embeddable status via ``videos.list``.  Only IDs that are confirmed as
embeddable are returned to callers.

No API key is stored in the repository.  The key must be supplied via the
``YOUTUBE_API_KEY`` environment variable and is never exposed to the frontend.
"""
from __future__ import annotations

from dataclasses import dataclass
import os
from typing import Iterable, List, Optional

import httpx


YOUTUBE_API_KEY_ENV = "YOUTUBE_API_KEY"
_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
_VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"


class YouTubeApiError(RuntimeError):
    """Raised when YouTube Data API responds with an error."""


@dataclass(slots=True)
class YouTubeDataClient:
    api_key: str
    timeout: float = 10.0

    def _client(self) -> httpx.Client:
        return httpx.Client(timeout=self.timeout)

    def search_embeddable_video_ids(self, query: str, *, max_results: int = 20) -> List[str]:
        """Return a list of embeddable video IDs for the query.

        The function first calls ``search.list`` with ``videoEmbeddable=true``
        and then verifies embeddability via ``videos.list``.  The resulting
        list contains unique IDs and is truncated to ``max_results`` items.
        """

        q = str(query or "").strip()
        if not q:
            return []

        # Step 1: search for candidate videos that claim embeddability.
        params = {
            "key": self.api_key,
            "part": "id",
            "type": "video",
            "videoEmbeddable": "true",
            "maxResults": min(max(1, int(max_results) * 2), 50),  # fetch a bit more for filtering
            "q": q,
        }
        with self._client() as client:
            resp = client.get(_SEARCH_URL, params=params)
        if resp.status_code != 200:
            raise YouTubeApiError(f"search.list failed: {resp.status_code} {resp.text}")
        data = resp.json()
        items = data.get("items") or []
        candid_ids = [
            it.get("id", {}).get("videoId")
            for it in items
            if isinstance(it, dict)
        ]
        candid_ids = [vid for vid in candid_ids if isinstance(vid, str) and vid]
        if not candid_ids:
            return []

        # Step 2: verify embeddable status using videos.list
        verified = self._filter_embeddable(candid_ids)
        if not verified:
            return []
        # Preserve original order but limit to ``max_results``
        seen = set()
        ordered: List[str] = []
        for vid in candid_ids:
            if vid in verified and vid not in seen:
                seen.add(vid)
                ordered.append(vid)
                if len(ordered) >= max_results:
                    break
        return ordered

    def _filter_embeddable(self, video_ids: Iterable[str]) -> set[str]:
        ids = [vid for vid in video_ids if isinstance(vid, str) and vid]
        if not ids:
            return set()
        params = {
            "key": self.api_key,
            "part": "status",
            "id": ",".join(ids[:50]),  # API limit
        }
        with self._client() as client:
            resp = client.get(_VIDEOS_URL, params=params)
        if resp.status_code != 200:
            raise YouTubeApiError(f"videos.list failed: {resp.status_code} {resp.text}")
        data = resp.json()
        items = data.get("items") or []
        ok: set[str] = set()
        for it in items:
            if not isinstance(it, dict):
                continue
            vid = it.get("id")
            status = it.get("status") or {}
            if (
                isinstance(vid, str)
                and isinstance(status, dict)
                and status.get("embeddable") is True
            ):
                ok.add(vid)
        return ok


def build_client_from_env() -> Optional[YouTubeDataClient]:
    key = os.getenv(YOUTUBE_API_KEY_ENV, "").strip()
    if not key:
        return None
    return YouTubeDataClient(api_key=key)


__all__ = [
    "YouTubeDataClient",
    "YouTubeApiError",
    "build_client_from_env",
    "YOUTUBE_API_KEY_ENV",
]

