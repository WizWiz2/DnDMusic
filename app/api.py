"""FastAPI application exposing the music search API."""
from __future__ import annotations

from functools import lru_cache

from fastapi import Depends, FastAPI, HTTPException, Query

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
