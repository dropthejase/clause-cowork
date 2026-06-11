from __future__ import annotations
import os
import pathlib
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/fs", tags=["fs"])


@router.get("/ls")
async def list_directory(path: str = Query(default="")):
    """List subdirectories at the given path. Defaults to home directory."""
    if path:
        base = pathlib.Path(path)
    else:
        home = pathlib.Path.home()
        base = next((p for p in (home / "Desktop", home / "Documents") if p.is_dir()), home)
    if not base.exists() or not base.is_dir():
        return JSONResponse(status_code=400, content={"error": f"Not a directory: {path}"})

    entries = []
    try:
        for entry in sorted(base.iterdir(), key=lambda e: e.name.lower()):
            if entry.is_dir() and not entry.name.startswith("."):
                entries.append({"name": entry.name, "path": str(entry)})
    except PermissionError:
        pass

    return {
        "path": str(base),
        "parent": str(base.parent) if base != base.parent else None,
        "entries": entries,
        "home": str(pathlib.Path.home()),
    }
