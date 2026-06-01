from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import ROUTERS


ALLOWED_ORIGINS = (
    "http://localhost:3000",
    "http://127.0.0.1:3000",
)


def create_app() -> FastAPI:
    app = FastAPI(title="Data Bucket API")
    configure_middleware(app)
    register_routes(app)
    return app


def configure_middleware(app: FastAPI) -> None:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(ALLOWED_ORIGINS),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def register_routes(app: FastAPI) -> None:
    for router in ROUTERS:
        app.include_router(router)


app = create_app()
