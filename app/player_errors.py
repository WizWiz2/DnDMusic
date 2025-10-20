"""Player error reporting service.

This module contains primitives for receiving player error reports from the
frontend and forwarding them to the project's logging pipeline.  The service
emits structured JSON records to stdout (via the standard ``logging`` module).
These records are designed to be scraped by log forwarders such as Loki or
Elastic Beats, which enables alerting/visualisation dashboards built on top of
Grafana/ELK.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from typing import Any, Dict, Optional

from pydantic import BaseModel, ConfigDict, Field


_LOGGER = logging.getLogger("player_errors")


class PlayerErrorReport(BaseModel):
    """Schema of the payload emitted by the YouTube player error handler."""

    model_config = ConfigDict(populate_by_name=True)

    error_code: int = Field(..., alias="errorCode", description="YouTube API error code")
    video_id: Optional[str] = Field(
        None, alias="videoId", description="Identifier of the affected video"
    )
    request: Optional[Dict[str, Any]] = Field(
        None, description="Last playlist request issued by the UI"
    )
    last_query: Optional[str] = Field(
        None, alias="lastQuery", description="Most recent search query"
    )
    playlist_index: Optional[int] = Field(
        None, alias="playlistIndex", description="Index of the failing track in the playlist"
    )
    playlist_length: Optional[int] = Field(
        None, alias="playlistLength", description="Number of items in the active playlist"
    )
    consecutive_errors: Optional[int] = Field(
        None,
        alias="consecutivePlaybackErrors",
        description="How many playback errors occurred without recovery",
    )
    reported_at: Optional[datetime] = Field(
        None,
        alias="reportedAt",
        description="Client-side timestamp (ISO-8601) for when the error happened",
    )
    manual_list_active: Optional[bool] = Field(
        None,
        alias="manualListActive",
        description="Whether a manual override playlist was in use",
    )
    manual_list_initial_length: Optional[int] = Field(
        None,
        alias="manualListInitialLength",
        description="Size of the manual playlist before error handling",
    )
    manual_list_remaining_length: Optional[int] = Field(
        None,
        alias="manualListRemainingLength",
        description="Size of the manual playlist after removing failing entries",
    )
    manual_list_was_trimmed: Optional[bool] = Field(
        None,
        alias="manualListWasTrimmed",
        description="Indicates whether an entry was removed from the manual list",
    )
    removed_manual_video_id: Optional[str] = Field(
        None,
        alias="removedManualVideoId",
        description="Identifier of the manual override entry that was dropped",
    )


class PlayerErrorService:
    """Persist player error reports to structured logging.

    The service currently emits JSON lines to stdout which makes them easy to
    ingest by observability pipelines.  Alerting can be configured on top of
    this stream (for example, Grafana Loki with alert rules that trigger when
    the rate of ``player_error" events spikes).
    """

    def __init__(self, logger: Optional[logging.Logger] = None) -> None:
        self._logger = logger or _LOGGER

    def log(self, report: PlayerErrorReport) -> None:
        """Emit a structured log entry for the incoming report."""

        logged_at = datetime.now(timezone.utc).isoformat()
        payload = report.model_dump(exclude_none=True)
        payload["logged_at"] = logged_at
        # ``ensure_ascii=False`` preserves Cyrillic characters in logs, while
        # ``sort_keys=True`` stabilises the output for easier diffing in tests.
        message = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        self._logger.warning("player_error %s", message)


__all__ = ["PlayerErrorReport", "PlayerErrorService"]
