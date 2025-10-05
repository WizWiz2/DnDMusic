"""Application entry point for running with ``python -m app``.

This helper reads the standard ``PORT`` environment variable (used by
Render, Railway и другие PaaS-платформы) и пробрасывает его в uvicorn,
параллельно заставляя сервер слушать внешний интерфейс ``0.0.0.0``.

Локально можно включить автоматический перезапуск, установив
переменную окружения ``UVICORN_RELOAD=1``.
"""
from __future__ import annotations

import os

import uvicorn


def _strtobool(value: str | None) -> bool:
    if value is None:
        return False
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def main() -> None:
    """Run the FastAPI app under uvicorn with sensible defaults."""

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    reload = _strtobool(os.getenv("UVICORN_RELOAD"))

    uvicorn.run(
        "app.api:app",
        host=host,
        port=port,
        reload=reload,
    )


if __name__ == "__main__":
    main()
