"""Resolves the canonical workspace.db path for a given workspace root."""
from __future__ import annotations
import os


def workspace_db_path(workspace_path: str) -> str:
    return os.path.join(workspace_path, ".clause-cowork", "db", "workspace.db")
