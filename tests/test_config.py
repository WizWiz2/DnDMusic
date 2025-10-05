from pathlib import Path

import pytest

from app.config import load_config
from app.models import MusicConfig


def test_load_config_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config_path = Path("config/default.yaml").resolve()
    monkeypatch.setenv("MUSIC_CONFIG_PATH", str(config_path))
    config = load_config()
    assert isinstance(config, MusicConfig)
    assert "fantasy" in config.genres
    assert config.hysteresis.cache_ttl_sec == 600
