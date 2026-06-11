from dotenv import load_dotenv
load_dotenv(override=False)  # .env sets defaults; explicit env vars take precedence

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime
from logging.handlers import RotatingFileHandler

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers.health import router as health_router
from routers.parse import router as parse_router
from routers.clauses import router as clauses_router
from routers.connections import router as connections_router
from routers.config import router as config_router
from routers.tags import router as tags_router
from routers.workspace import router as workspace_router
from routers.document_meta import router as document_meta_router
from routers.fs import router as fs_router
from routers.chat import router as chat_router
from routers.chat_ws import router as chat_ws_router
from services.acp_session import manager as acp_manager


def _configure_logging() -> None:
    log_dir = os.path.join(os.path.dirname(__file__), "logs")
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, f"backend_{datetime.now().strftime('%Y-%m-%d-%H%M%S')}.log")
    fmt = logging.Formatter("%(asctime)s %(levelname)-8s %(name)s: %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in root.handlers[:]:
        root.removeHandler(h)
        h.close()
    root.addHandler(RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=3))
    root.addHandler(logging.StreamHandler())
    for h in root.handlers:
        h.setFormatter(fmt)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _configure_logging()
    yield
    # Cancel in-flight background extractions and wait for clean teardown
    import asyncio as _asyncio
    from routers.workspace import _background_tasks
    if _background_tasks:
        logging.getLogger(__name__).info("lifespan: cancelling %d in-flight extraction task(s)", len(_background_tasks))
        for task in list(_background_tasks):
            task.cancel()
        try:
            await _asyncio.wait_for(
                _asyncio.gather(*list(_background_tasks), return_exceptions=True),
                timeout=3.0
            )
        except _asyncio.TimeoutError:
            logging.getLogger(__name__).warning("lifespan: timed out waiting for extraction tasks — forcing shutdown")
    await acp_manager.shutdown()


app = FastAPI(title="WordGraph Backend", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # add-in runs on localhost
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(parse_router)
app.include_router(clauses_router)
app.include_router(connections_router)
app.include_router(config_router)
app.include_router(tags_router)
app.include_router(workspace_router)
app.include_router(document_meta_router)
app.include_router(fs_router)
app.include_router(chat_router)
app.include_router(chat_ws_router)

@app.get("/")
async def root():
    return {"status": "ok", "version": "0.1.0"}
