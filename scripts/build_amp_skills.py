#!/usr/bin/env python3
"""Build or drift-check the Amp skills and lifecycle plugin projection."""

from __future__ import annotations

import argparse
import sys
import tempfile
from pathlib import Path

from .port_lib import SOURCE_PLUGIN_DIR, TARGETS_DIR
from .port_lib import amp
from .port_lib.generated_tree import tree_differences

OUTPUT_DIR = TARGETS_DIR / "amp"


def _differences(expected: Path, actual: Path) -> list[str]:
    return tree_differences(expected, actual)


def check() -> int:
    if not OUTPUT_DIR.exists():
        print(f"[amp-skills] missing generated target: {OUTPUT_DIR}", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory(prefix="amp-skills-check-") as tmp:
        generated = Path(tmp) / "amp"
        amp.build_target(SOURCE_PLUGIN_DIR, generated)
        differences = _differences(generated, OUTPUT_DIR)

    if differences:
        print("[amp-skills] generated target has drift:", file=sys.stderr)
        for difference in differences:
            print(f"  - {difference}", file=sys.stderr)
        print("Run `make amp-skills` and commit the result.", file=sys.stderr)
        return 1

    skill_count = amp.validate(OUTPUT_DIR / "skills")
    amp.validate_plugin(OUTPUT_DIR / amp.PLUGIN_TARGET_RELATIVE, SOURCE_PLUGIN_DIR)
    print(f"[amp-target] OK: {skill_count} skills and 1 plugin")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(prog="scripts.build_amp_skills")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Generate in a temporary directory and fail if targets/amp has drift.",
    )
    args = parser.parse_args()

    if args.check:
        return check()

    result = amp.build_target(SOURCE_PLUGIN_DIR, OUTPUT_DIR)
    print(
        f"[amp-target] built {result['skills']} skills and "
        f"{result['plugins']} plugin in {OUTPUT_DIR}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
