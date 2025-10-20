"""Helpers for fetching and filtering YouTube video identifiers."""
from __future__ import annotations

from itertools import islice
from typing import Iterable, List, Sequence, Set

import httpx


class YouTubeSearchError(RuntimeError):
    """Raised when a YouTube API request fails."""


class YouTubeSearchClient:
    """Small helper around the YouTube Data API search endpoints."""

    _SEARCH_URL = "https://www.googleapis.com/youtube/v3/search"
    _VIDEOS_URL = "https://www.googleapis.com/youtube/v3/videos"

    def __init__(
        self,
        api_key: str,
        *,
        http_client: httpx.Client | None = None,
        max_results: int = 15,
        region_code: str | None = None,
    ) -> None:
        if not api_key:
            raise ValueError("YouTube API key must be provided")
        self._api_key = api_key
        self._max_results = max(1, min(max_results, 50))
        self._region_code = region_code.upper() if region_code else None
        self._client = http_client or httpx.Client(timeout=httpx.Timeout(10.0))
        self._owns_client = http_client is None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def search_videos(self, query: str) -> List[str]:
        """Search for videos matching the query and return video identifiers."""

        normalized_query = query.strip()
        if not normalized_query:
            return []

        payload = {
            "part": "id",
            "type": "video",
            "videoEmbeddable": "true",
            "maxResults": self._max_results,
            "q": normalized_query,
        }
        data = self._request_json(self._SEARCH_URL, payload)
        video_ids: List[str] = []
        for item in data.get("items", []):
            video_id = item.get("id", {}).get("videoId")
            if isinstance(video_id, str):
                video_ids.append(video_id)
        return video_ids

    def filter_playable(self, video_ids: Sequence[str]) -> List[str]:
        """Filter a sequence of video IDs to those playable in the embedded player."""

        ordered_ids = [vid for vid in video_ids if isinstance(vid, str) and vid.strip()]
        if not ordered_ids:
            return []

        playable: Set[str] = set()
        for batch in self._chunk(ordered_ids, 50):
            payload = {
                "part": "status,contentDetails",
                "id": ",".join(batch),
            }
            data = self._request_json(self._VIDEOS_URL, payload)
            for item in data.get("items", []):
                video_id = item.get("id")
                if not isinstance(video_id, str):
                    continue
                status = item.get("status") or {}
                if not status.get("embeddable"):
                    continue
                if status.get("privacyStatus") not in {None, "public", "unlisted"}:
                    continue
                restrictions = (item.get("contentDetails") or {}).get("regionRestriction") or {}
                if not self._is_region_allowed(restrictions):
                    continue
                playable.add(video_id)

        return [vid for vid in ordered_ids if vid in playable]

    def _is_region_allowed(self, restrictions: dict) -> bool:
        if not restrictions:
            return True

        region = self._region_code
        blocked = restrictions.get("blocked")
        if region and isinstance(blocked, list):
            blocked_normalized = {code.upper() for code in blocked if isinstance(code, str)}
            if region in blocked_normalized:
                return False
        elif not region and blocked:
            # When region unknown treat blocked list as a hard restriction.
            return False

        allowed = restrictions.get("allowed")
        if isinstance(allowed, list):
            allowed_normalized = {code.upper() for code in allowed if isinstance(code, str)}
            if region:
                return region in allowed_normalized
            # Without a specific region we cannot guarantee playback if allowlist exists.
            return False

        return True

    def _request_json(self, url: str, params: dict) -> dict:
        request_params = dict(params)
        request_params["key"] = self._api_key
        try:
            response = self._client.get(url, params=request_params)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            raise YouTubeSearchError(str(exc)) from exc

        data = response.json()
        if isinstance(data, dict) and "error" in data:
            error_info = data.get("error")
            if isinstance(error_info, dict):
                message = error_info.get("message") or "YouTube API returned an error"
            else:
                message = "YouTube API returned an error"
            raise YouTubeSearchError(str(message))
        if not isinstance(data, dict):
            raise YouTubeSearchError("Unexpected response from YouTube API")
        return data

    @staticmethod
    def _chunk(seq: Sequence[str], size: int) -> Iterable[Sequence[str]]:
        it = iter(seq)
        while True:
            batch = list(islice(it, size))
            if not batch:
                break
            yield batch


__all__ = ["YouTubeSearchClient", "YouTubeSearchError"]
