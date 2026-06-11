"""Pydantic models for clauses, tags, connections, and API response shapes.

Clause is the core domain object — one row per paragraph/table block in a document.
classified_hash / classified_text are set only by set_clause_classification.py (never by extraction)
and serve as the stable baseline for needs_reclassification comparisons.
"""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field
import uuid

EdgeType = Literal["references", "subject_to", "contradicts"]


class Tag(BaseModel):
    value: str
    user_defined: bool = False


class Connection(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    target_id: str
    target_doc_id: str = ""
    edge_type: EdgeType
    note: Optional[str] = None
    user_created: bool = False
    user_rejected: bool = False


class Clause(BaseModel):
    stable_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    doc_id: str
    paragraph_hash: str
    position: int
    raw_text: str
    clause_type: Optional[str] = None
    clause_tags: list[Tag] = Field(default_factory=list)
    connections: list[Connection] = Field(default_factory=list)
    is_table: bool = False
    tombstoned: bool = False
    parent: Optional[str] = None
    classified_hash: Optional[str] = None  # paragraph_hash at time of last classification; never set by extraction
    classified_text: Optional[str] = None  # raw_text at time of last classification; never set by extraction
    needs_reclassification: bool = False  # true when classified_hash set and fuzzy(current, classified_text) < threshold


class ClausePatch(BaseModel):
    """Partial update from user edits — only provided fields are applied."""
    clause_type: Optional[str] = None
    add_tags: list[Tag] = Field(default_factory=list)
    remove_tags: list[str] = Field(default_factory=list)


class GraphResponse(BaseModel):
    doc_id: str
    clauses: list[Clause]
    new_paragraph_count: int = 0
    tombstoned_count: int = 0
