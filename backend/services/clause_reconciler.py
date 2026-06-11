"""Shared block-matching logic used by both parse.py and workspace.py background extraction."""
from models.clause import Clause
from services.extractor import ExtractedBlock
from services.hasher import hash_paragraph, fuzzy_match


def _needs_reclass(existing: Clause, new_text: str, threshold: float) -> bool:
    """True when the new text has diverged significantly from the text at last classification."""
    if existing.clause_type is None or existing.classified_hash is None:
        return False
    seg_hash = hash_paragraph(new_text)
    if existing.classified_hash == seg_hash:
        return False
    baseline = existing.classified_text or existing.raw_text
    match = fuzzy_match(new_text, {existing.classified_hash: baseline}, threshold=threshold)
    return match.score < threshold


async def reconcile_blocks(
    blocks: list[ExtractedBlock],
    all_clauses: list[Clause],
    doc_id: str,
    threshold: float,
) -> tuple[list[Clause], int]:
    """Match extracted blocks against existing clauses, returning clauses to upsert and new_count."""
    existing_by_stable_id = {c.stable_id: c for c in all_clauses}
    existing_by_hash = {c.paragraph_hash: c for c in all_clauses}

    seen_ids: set[str] = set()
    clauses_to_upsert: list[Clause] = []
    new_count = 0

    for block in blocks:
        seg_hash = hash_paragraph(block.text)
        existing = existing_by_stable_id.get(block.node_id)

        if existing is None:
            # Stable_id miss — try fuzzy match against existing clauses by content
            old_texts = {c.paragraph_hash: c.raw_text for c in all_clauses if c.stable_id not in seen_ids}
            match = fuzzy_match(block.text, old_texts, threshold=threshold)
            if not match.is_new and match.matched_hash and match.matched_hash in existing_by_hash:
                existing = existing_by_hash[match.matched_hash]
                existing.stable_id = block.node_id
                existing.paragraph_hash = seg_hash
                existing.position = block.position
                existing.raw_text = block.text
                existing.is_table = block.is_table
                existing.parent = block.parent or existing.parent
                existing.tombstoned = False
                existing.needs_reclassification = _needs_reclass(existing, block.text, threshold)
                clause = existing
            else:
                clause = Clause(
                    stable_id=block.node_id,
                    doc_id=doc_id,
                    paragraph_hash=seg_hash,
                    position=block.position,
                    raw_text=block.text,
                    is_table=block.is_table,
                    parent=block.parent,
                )
                new_count += 1
        else:
            existing.paragraph_hash = seg_hash
            existing.position = block.position
            existing.raw_text = block.text
            existing.is_table = block.is_table
            existing.parent = block.parent or existing.parent
            existing.tombstoned = False
            existing.needs_reclassification = _needs_reclass(existing, block.text, threshold)
            clause = existing

        clauses_to_upsert.append(clause)
        seen_ids.add(clause.stable_id)

    return clauses_to_upsert, new_count
