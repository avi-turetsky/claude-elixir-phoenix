"""Cross-file consistency checks born from the 2026-06-11 session-insights work.

Two bug classes that per-skill scoring cannot catch:

1. References teaching anti-patterns their own Iron Laws ban
   (mix-tasks.md shipped Mix.Task.run("app.start") as the canonical example
   while Iron Law #23 bans it).
2. Skill-invoked shell scripts using cwd-relative .claude/ state paths
   (fetch-cc-changelog.sh created a stray nested .claude/ dir when run from
   inside the skill folder).
"""

import glob
import os
import re

REPO_ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..")
SKILLS_GLOB = os.path.join(REPO_ROOT, "plugins", "elixir-phoenix", "skills", "*")


# --- 1. Iron Law <-> references consistency ---

# Banned patterns that must never appear in references as POSITIVE examples.
# Each occurrence must have a negative marker within +/- WINDOW lines.
BANNED_PATTERNS = [
    ("Iron Law #23 (mix tasks never app.start)",
     re.compile(r'Mix\.Task\.run\(["\']app\.start["\']\)')),
    ("Iron Law #4 (no :float for money)",
     re.compile(r'(?:field|add)\s+:(?:price|amount|cost|total|balance|fee|salary|wage)[a-z_]*,\s*:float')),
    ("Iron Law #10 (no String.to_atom on input)",
     re.compile(r'String\.to_atom\(')),
    ("Iron Law #15 (no implicit cross joins)",
     re.compile(r'from\(\s*\w+\s+in\s+[A-Z]\w*\s*,\s*\w+\s+in\s+[A-Z]')),
    ("Iron Law #12 (no raw/1 with variables)",
     re.compile(r'(?<![\w.])raw\(\s*@?[a-z_]+\s*\)')),
]

NEGATIVE_MARKERS = re.compile(
    r"WRONG|NEVER|Never\b|never\b|DO NOT|Do NOT|Don'?t|don'?t|anti-pattern|Anti-pattern"
    r"|Iron Law|iron law|AVOID|Avoid\b|avoid\b|instead|Instead|BAD\b|Bad:|❌|✗"
    r"|exhaustion|unsafe|Unsafe|vulnerab|XSS|injection|Cartesian|deprecated|caution|Caution"
)

WINDOW = 5


def _reference_files():
    return sorted(glob.glob(os.path.join(SKILLS_GLOB, "references", "*.md")))


class TestIronLawReferenceConsistency:
    def test_reference_files_exist(self):
        assert len(_reference_files()) > 50, "reference glob looks broken"

    def test_no_unmarked_banned_patterns(self):
        violations = []
        for path in _reference_files():
            with open(path) as f:
                lines = f.read().split("\n")
            for idx, line in enumerate(lines):
                for law, pattern in BANNED_PATTERNS:
                    if not pattern.search(line):
                        continue
                    lo = max(0, idx - WINDOW)
                    hi = min(len(lines), idx + WINDOW + 1)
                    context = "\n".join(lines[lo:hi])
                    if not NEGATIVE_MARKERS.search(context):
                        rel = os.path.relpath(path, REPO_ROOT)
                        violations.append(f"{rel}:{idx + 1} — {law}: {line.strip()[:80]}")
        assert not violations, (
            "Banned Iron Law patterns appear in references WITHOUT a negative "
            "marker (WRONG/NEVER/anti-pattern/...) nearby — they read as "
            "positive examples:\n" + "\n".join(violations)
        )


# --- 2. Skill script .claude/ path anchoring ---

# A literal `.claude/` path that does not go through CLAUDE_PROJECT_DIR (or an
# explicit $PWD fallback) resolves against the caller's cwd. Skill scripts run
# wherever the Bash tool's persistent cwd happens to be.
RELATIVE_CLAUDE_PATH = re.compile(r'''(?x)
    (?<! [\w$}/.\-] )      # not preceded by var/expansion/path chars
    \.claude/              # the literal relative path
''')


def _skill_scripts():
    scripts = sorted(glob.glob(os.path.join(SKILLS_GLOB, "scripts", "*.sh")))
    scripts += sorted(glob.glob(os.path.join(REPO_ROOT, "scripts", "*.sh")))
    return scripts


class TestSkillScriptPathAnchoring:
    def test_scripts_exist(self):
        assert len(_skill_scripts()) >= 2, "script glob looks broken"

    def test_no_cwd_relative_claude_paths(self):
        violations = []
        for path in _skill_scripts():
            with open(path) as f:
                lines = f.read().split("\n")
            for idx, line in enumerate(lines):
                if line.lstrip().startswith("#"):
                    continue
                if not RELATIVE_CLAUDE_PATH.search(line):
                    continue
                # Anchored on the same line is fine
                if "CLAUDE_PROJECT_DIR" in line or "$PWD" in line:
                    continue
                rel = os.path.relpath(path, REPO_ROOT)
                violations.append(f"{rel}:{idx + 1} — {line.strip()[:90]}")
        assert not violations, (
            "cwd-relative .claude/ paths in skill scripts — anchor with "
            '"${CLAUDE_PROJECT_DIR:-$PWD}" (nested-state-dir bug class):\n'
            + "\n".join(violations)
        )
