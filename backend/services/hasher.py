from __future__ import annotations
import hashlib
from dataclasses import dataclass


def hash_paragraph(text: str) -> str:
    """SHA-256 fingerprint of paragraph text (normalised whitespace)."""
    normalised = " ".join(text.split())
    return hashlib.sha256(normalised.encode()).hexdigest()[:16]


@dataclass
class MatchResult:
    matched_hash: str | None
    score: float
    is_new: bool


def _similarity(a: str, b: str) -> float:
    """0.0–1.0 similarity score using diff-match-patch."""
    from diff_match_patch import diff_match_patch
    dmp = diff_match_patch()
    diffs = dmp.diff_main(a, b)
    dmp.diff_cleanupSemantic(diffs)
    common = sum(len(text) for op, text in diffs if op == 0)
    total = max(len(a), len(b), 1)
    return common / total


def fuzzy_match(
    new_text: str,
    old_nodes: dict[str, str],  # {hash: text}
    threshold: float = 0.85,
) -> MatchResult:
    """Match new_text against old node texts. Returns best match above threshold."""
    new_hash = hash_paragraph(new_text)

    # Exact match first
    if new_hash in old_nodes:
        return MatchResult(matched_hash=new_hash, score=1.0, is_new=False)

    best_score = 0.0
    best_hash: str | None = None
    for old_hash, old_text in old_nodes.items():
        score = _similarity(new_text, old_text)
        if score > best_score:
            best_score = score
            best_hash = old_hash

    if best_score >= threshold:
        return MatchResult(matched_hash=best_hash, score=best_score, is_new=False)

    return MatchResult(matched_hash=None, score=best_score, is_new=True)
