"""FastAPI application exposing the music search API."""
from __future__ import annotations

from functools import lru_cache
import json
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import HTMLResponse, Response

from .config import load_config
from .models import (
    HealthStatus,
    MusicConfig,
    RecommendationRequest,
    RecommendationResult,
    SearchResult,
)
from .music_service import (
    GenreNotFoundError,
    MusicService,
    RecommendationUnavailableError,
    SceneNotFoundError,
)
from .ai_client import NeuralTaggerClient


app = FastAPI(title="DnD Music Tool", version="0.1.0")

_UI_TEMPLATE_PLACEHOLDER = "{{ initial_data | tojson | safe }}"


@lru_cache(maxsize=1)
def _load_ui_template() -> str:
    template_path = Path(__file__).with_name("templates") / "ui.html"
    return template_path.read_text(encoding="utf-8")


def _encode_initial_payload(initial_data: dict) -> str:
    """Serialize the initial payload exactly as the UI expects.

    The result mirrors Jinja's ``tojson`` filter behaviour so the embedded
    object can be consumed safely by inline JavaScript without risking that the
    ``</script>`` sequence or other HTML-sensitive characters break the page.
    """

    encoded = json.dumps(
        jsonable_encoder(initial_data), ensure_ascii=False, separators=(",", ":")
    )
    # Guard against prematurely closing the surrounding <script> block.
    encoded = encoded.replace("</", "<\\/")
    # Prevent HTML parsers from treating ampersands as entity starts.
    encoded = encoded.replace("&", "\\u0026")
    # These Unicode separators can break inline scripts in some browsers.
    encoded = encoded.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    return encoded


def _render_ui(initial_data: dict) -> str:
    template = _load_ui_template()
    initial_json = _encode_initial_payload(initial_data)
    if _UI_TEMPLATE_PLACEHOLDER not in template:
        raise RuntimeError("UI template placeholder not found")
    return template.replace(_UI_TEMPLATE_PLACEHOLDER, initial_json, 1)


@lru_cache(maxsize=1)
def get_config() -> MusicConfig:
    return load_config()


@lru_cache(maxsize=1)
def get_ai_client() -> NeuralTaggerClient:
    return NeuralTaggerClient()


@lru_cache(maxsize=1)
def get_service_cached() -> MusicService:
    return MusicService(get_config(), ai_client=get_ai_client())


def get_service() -> MusicService:
    return get_service_cached()


@app.get("/", response_model=HealthStatus)
async def health(service: MusicService = Depends(get_service)) -> HealthStatus:
    return HealthStatus(genres=list(service.available_genres()))


@app.head("/")
async def health_head(service: MusicService = Depends(get_service)) -> Response:
    """Lightweight HEAD variant of the health endpoint for platform probes."""

    # Touch the service so dependency validation matches the GET handler.
    service.available_genres()
    return Response(status_code=200)


@app.get("/ui", response_class=HTMLResponse)
async def ui(service: MusicService = Depends(get_service)) -> HTMLResponse:
    genres = list(service.available_genres())
    scene_library = service.describe_scenes()
    hysteresis = service.hysteresis_settings()

    initial_data = {
        "genres": genres,
        "scenes": scene_library,
        "hysteresis": hysteresis,
    }
    rendered = _render_ui(initial_data)
    return HTMLResponse(content=rendered)


@app.get("/api/search", response_model=SearchResult)
async def search(
    genre: str = Query(..., description="Genre of the campaign, e.g. fantasy"),
    scene: str = Query(..., description="Scene tag, e.g. battle"),
    service: MusicService = Depends(get_service),
) -> SearchResult:
    try:
        return service.search(genre, scene)
    except GenreNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except SceneNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/recommend", response_model=RecommendationResult)
async def recommend(
    request: RecommendationRequest,
    service: MusicService = Depends(get_service),
) -> RecommendationResult:
    try:
        return service.recommend(request.genre, request.tags)
    except GenreNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RecommendationUnavailableError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
