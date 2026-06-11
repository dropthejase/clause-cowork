"""Workspace configuration model — persisted as JSON in config table under key 'workspace'."""
from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


class WorkspaceConfig(BaseModel):
    connection_threshold_prompt: Optional[str] = None
    re_enrich_threshold: float = 0.85
    strict_clause_types: bool = True
    strict_clause_tags: bool = False
    strict_doc_types: bool = True
    strict_doc_tags: bool = False
