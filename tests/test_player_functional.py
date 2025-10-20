import subprocess
import sys
from pathlib import Path


def test_youtube_player_manual_playlist(tmp_path):
    project_root = Path(__file__).resolve().parent
    script = project_root / "js" / "player_functional.test.mjs"
    result = subprocess.run([
        "node",
        str(script),
    ], capture_output=True, text=True)
    if result.returncode != 0:
        sys.stdout.write(result.stdout)
        sys.stderr.write(result.stderr)
    assert result.returncode == 0, "JavaScript functional test failed"
