#!/usr/bin/env python3
"""Deploy skills to an agent directory.

Copies all skill scripts and SKILL.md files from skills/ into the target agent
directory, substituting {{SKILLS_ROOT}} with the agent's root folder name.

Usage:
  python3 skills/deploy.py <workspace_path> <agent>

  agent: claude | kiro | gemini | agents (maps to .claude / .kiro / .gemini / .agents)

Examples:
  python3 skills/deploy.py ~/Desktop/my-workspace claude
  python3 skills/deploy.py ~/Desktop/my-workspace kiro
"""
import os
import shutil
import sys

AGENT_ROOTS = {
    "claude": ".claude",
    "kiro":   ".kiro",
    "gemini": ".gemini",
    "agents": ".agents",
}

SKILLS_DIR = os.path.dirname(os.path.abspath(__file__))


def deploy(workspace: str, agent: str) -> None:
    root = AGENT_ROOTS.get(agent, ".agents")

    target_skills = os.path.join(workspace, root, "skills")

    for skill in ("analyse", "index"):
        src_skill_dir = os.path.join(SKILLS_DIR, skill)
        dst_skill_dir = os.path.join(target_skills, skill)

        # Copy scripts verbatim (skip __pycache__ and non-files)
        src_scripts = os.path.join(src_skill_dir, "scripts")
        if os.path.isdir(src_scripts):
            dst_scripts = os.path.join(dst_skill_dir, "scripts")
            os.makedirs(dst_scripts, exist_ok=True)
            for fname in os.listdir(src_scripts):
                src_file = os.path.join(src_scripts, fname)
                if os.path.isfile(src_file):
                    shutil.copy2(src_file, os.path.join(dst_scripts, fname))

        # Copy any extra .md guides verbatim (e.g. NOTES_GUIDE.md)
        os.makedirs(dst_skill_dir, exist_ok=True)
        for fname in os.listdir(src_skill_dir):
            if fname.endswith(".md") and fname != "SKILL.md":
                shutil.copy2(os.path.join(src_skill_dir, fname), os.path.join(dst_skill_dir, fname))

        # Render SKILL.md — substitute {{SKILLS_ROOT}}
        skill_md_src = os.path.join(src_skill_dir, "SKILL.md")
        skill_md_dst = os.path.join(dst_skill_dir, "SKILL.md")
        os.makedirs(dst_skill_dir, exist_ok=True)
        content = open(skill_md_src).read().replace("{{SKILLS_ROOT}}", root)
        with open(skill_md_dst, "w") as f:
            f.write(content)

    # Copy shared scripts into both skill directories so each is self-contained
    shared_scripts = os.path.join(SKILLS_DIR, "shared", "scripts")
    if os.path.isdir(shared_scripts):
        for skill in ("analyse", "index"):
            dst_scripts = os.path.join(target_skills, skill, "scripts")
            os.makedirs(dst_scripts, exist_ok=True)
            for fname in os.listdir(shared_scripts):
                src_file = os.path.join(shared_scripts, fname)
                if os.path.isfile(src_file):
                    shutil.copy2(src_file, os.path.join(dst_scripts, fname))

    # Copy NOTES_GUIDE.md from index/ into both skill directories
    notes_guide_src = os.path.join(SKILLS_DIR, "index", "NOTES_GUIDE.md")
    if os.path.isfile(notes_guide_src):
        for skill in ("analyse", "index"):
            dst_skill_dir = os.path.join(target_skills, skill)
            os.makedirs(dst_skill_dir, exist_ok=True)
            shutil.copy2(notes_guide_src, os.path.join(dst_skill_dir, "NOTES_GUIDE.md"))

    print(f"Deployed to {os.path.join(workspace, root, 'skills')} (agent={agent}, root={root})")


def main() -> None:
    if len(sys.argv) != 3:
        print("Usage: deploy.py <workspace_path> <agent>")
        sys.exit(1)
    deploy(os.path.expanduser(sys.argv[1]), sys.argv[2])


if __name__ == "__main__":
    main()
