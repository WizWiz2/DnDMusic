"""Helpers to load configuration from YAML."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict

import yaml

from .models import MusicConfig


DEFAULT_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "default.yaml"
ENV_CONFIG_PATH = "MUSIC_CONFIG_PATH"


def _normalize_keys(data: Any) -> Any:
    """Понижает регистр ключей словарей для сопоставления жанров/сцен."""
    if isinstance(data, dict):
        return {str(k).lower(): _normalize_keys(v) for k, v in data.items()}
    if isinstance(data, list):
        return [_normalize_keys(item) for item in data]
    return data


def load_config(path: Path | None = None) -> MusicConfig:
    """Loads config from YAML file."""
    config_path = path or Path(os.getenv(ENV_CONFIG_PATH, DEFAULT_CONFIG_PATH))
    with open(config_path, "r", encoding="utf-8") as fh:
        raw_data: Dict[str, Any] = yaml.safe_load(fh)
    normalized = raw_data.copy()
    if "genres" in normalized:
        normalized["genres"] = _normalize_keys(normalized["genres"])
    return MusicConfig.model_validate(normalized)
