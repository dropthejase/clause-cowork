from __future__ import annotations
import logging
import os
import shutil
from pathlib import Path

logger = logging.getLogger(__name__)

# Root of the repo — skills/ lives here
_REPO_ROOT = Path(__file__).parent.parent.parent
_SKILLS_SRC = _REPO_ROOT / "skills"


def _skill_dirs(acp_bin: str) -> list[str]:
    """Return agent-specific skill directories for the given acp_bin string."""
    dirs = [".agents/skills/"]
    b = acp_bin.lower()
    if "claude" in b:
        dirs.append(".claude/skills/")
    elif "kiro" in b:
        dirs.append(".kiro/skills/")
    elif "gemini" in b:
        dirs.append(".gemini/skills/")
    return dirs


def install_skills(workspace: str, acp_bin: str) -> dict:
    """Copy skill files and context docs into the workspace for the given agent.

    Idempotent — skips files that are already up to date.
    Returns {installed: [...], skipped: [...], errors: [...]}.
    """
    workspace_path = Path(workspace)
    if not workspace_path.is_dir():
        return {"installed": [], "skipped": [], "errors": [f"workspace not found: {workspace}"]}

    installed: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    # 1. Copy each skill directory (with shared scripts merged in)
    shared_scripts = _SKILLS_SRC / "shared" / "scripts"
    skill_dirs = _skill_dirs(acp_bin)
    for skill_name in _iter_skills():
        src_skill = _SKILLS_SRC / skill_name
        for rel_dir in skill_dirs:
            dest_skill = workspace_path / rel_dir / skill_name
            result = _sync_skill(src_skill, dest_skill)
            installed.extend(result["installed"])
            skipped.extend(result["skipped"])
            errors.extend(result["errors"])
            # Merge shared scripts into this skill's scripts/ folder
            if shared_scripts.is_dir():
                result = _sync_dir(shared_scripts, dest_skill / "scripts")
                installed.extend(result["installed"])
                skipped.extend(result["skipped"])
                errors.extend(result["errors"])

    # 2. Write workspace context file from template
    tmpl = _SKILLS_SRC / "AGENTS.md.template"
    if not tmpl.exists():
        errors.append("template not found: AGENTS.md.template")
    else:
        content = tmpl.read_text(encoding="utf-8")
        b = acp_bin.lower()
        if "claude" in b:
            dest_paths = [workspace_path / "CLAUDE.md"]
        elif "kiro" in b:
            dest_paths = [
                workspace_path / "AGENTS.md",
                workspace_path / ".kiro" / "steering" / "AGENTS.md",
            ]
        elif "gemini" in b:
            dest_paths = [workspace_path / "GEMINI.md"]
        else:
            dest_paths = [workspace_path / "AGENTS.md"]

        for dest in dest_paths:
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists() and dest.read_text(encoding="utf-8") == content:
                skipped.append(str(dest.name))
            else:
                dest.write_text(content, encoding="utf-8")
                installed.append(str(dest.name))
                logger.info("skill_installer: wrote %s", dest)

    logger.info(
        "skill_installer: workspace=%s acp_bin=%r installed=%d skipped=%d errors=%d",
        workspace, acp_bin, len(installed), len(skipped), len(errors),
    )
    return {"installed": installed, "skipped": skipped, "errors": errors}


def _iter_skills() -> list[str]:
    if not _SKILLS_SRC.is_dir():
        return []
    return [
        d.name for d in _SKILLS_SRC.iterdir()
        if d.is_dir() and (d / "SKILL.md").exists()
    ]


def _sync_skill(src: Path, dest: Path) -> dict:
    """Recursively sync a skill directory. Returns {installed, skipped, errors}."""
    return _sync_dir(src, dest)


def _sync_dir(src: Path, dest: Path) -> dict:
    installed: list[str] = []
    skipped: list[str] = []
    errors: list[str] = []

    for src_file in src.rglob("*"):
        if not src_file.is_file():
            continue
        rel = src_file.relative_to(src)
        dest_file = dest / rel
        try:
            dest_file.parent.mkdir(parents=True, exist_ok=True)
            content = src_file.read_bytes()
            if dest_file.exists() and dest_file.read_bytes() == content:
                skipped.append(str(dest_file))
            else:
                dest_file.write_bytes(content)
                installed.append(str(dest_file))
        except Exception as e:
            errors.append(f"{dest_file}: {e}")

    return {"installed": installed, "skipped": skipped, "errors": errors}
