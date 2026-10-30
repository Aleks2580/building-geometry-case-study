from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from app.config import Config
from app.db import create_pool
from app.v1.errors import request_validation_error_handler
from app.v1.router import router as v1_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    await app.state.db_pool.open()
    try:
        yield
    finally:
        await app.state.db_pool.close()


def create_app(config: Config) -> FastAPI:
    app = FastAPI(
        title="Building Geometry Case Study",
        version="0.1.0",
        debug=config.debug,
        lifespan=lifespan,
    )

    app.state.config = config
    app.state.db_pool = create_pool(config)

    origins = [o.strip() for o in config.allowed_origins.split(";")]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(v1_router)
    app.exception_handler(RequestValidationError)(request_validation_error_handler)

    @app.get("/")
    async def root() -> dict:
        from app import __version__

        return {"status": "ok", "version": __version__}

    return app


def deploy_factory() -> FastAPI:
    config = Config()
    return create_app(config)


def local_factory() -> FastAPI:
    from dotenv import load_dotenv

    load_dotenv()
    config = Config()
    return create_app(config)
