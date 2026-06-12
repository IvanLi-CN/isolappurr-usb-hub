#!/usr/bin/env python3
"""Check source file length budgets for hand-written project code."""

from __future__ import annotations

import argparse
import fnmatch
import os
import sys
from dataclasses import dataclass
from pathlib import Path


WARN_LIMIT = 800
FAIL_LIMIT = 1200

SOURCE_EXTENSIONS = {
    ".c",
    ".cc",
    ".cpp",
    ".css",
    ".h",
    ".hpp",
    ".inc",
    ".js",
    ".jsx",
    ".py",
    ".rs",
    ".sh",
    ".ts",
    ".tsx",
}

EXCLUDED_DIRS = {
    ".git",
    ".storybook-cache",
    ".venv",
    "dist",
    "hardware",
    "node_modules",
    "storybook-static",
    "target",
    "vendor",
}

EXCLUDED_FILES = {
    "Cargo.lock",
    "bun.lock",
}

ALLOWLIST = {
    "src/display_ui/dashboard_font.rs": "generated dashboard font data",
}


@dataclass(frozen=True)
class SourceFile:
    path: Path
    relative: str
    lines: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        default=".",
        help="repository root to scan (default: current directory)",
    )
    parser.add_argument(
        "--warn-limit",
        type=int,
        default=WARN_LIMIT,
        help=f"warning threshold in lines (default: {WARN_LIMIT})",
    )
    parser.add_argument(
        "--fail-limit",
        type=int,
        default=FAIL_LIMIT,
        help=f"failure threshold in lines (default: {FAIL_LIMIT})",
    )
    return parser.parse_args()


def is_generated(path: Path) -> bool:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for _ in range(8):
                line = fh.readline()
                if not line:
                    return False
                if "@generated" in line or "automatically generated" in line.lower():
                    return True
    except OSError:
        return False
    return False


def is_excluded_dir(parts: tuple[str, ...]) -> bool:
    return any(part in EXCLUDED_DIRS for part in parts)


def is_source(path: Path) -> bool:
    if path.name in EXCLUDED_FILES:
        return False
    return path.suffix in SOURCE_EXTENSIONS


def should_skip(relative: str, path: Path) -> bool:
    parts = Path(relative).parts
    if is_excluded_dir(parts):
        return True
    if relative in ALLOWLIST:
        return True
    if any(fnmatch.fnmatch(relative, pattern) for pattern in ("docs/plan/**", "docs/specs/**/tools/**")):
        return True
    return is_generated(path)


def count_lines(path: Path) -> int:
    with path.open("rb") as fh:
        return sum(1 for _ in fh)


def scan(root: Path) -> list[SourceFile]:
    files: list[SourceFile] = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [
            dirname
            for dirname in dirnames
            if dirname not in EXCLUDED_DIRS
            and not Path(dirpath, dirname).relative_to(root).as_posix().startswith("docs/specs/")
        ]
        for filename in filenames:
            path = Path(dirpath, filename)
            relative = path.relative_to(root).as_posix()
            if not is_source(path) or should_skip(relative, path):
                continue
            files.append(SourceFile(path=path, relative=relative, lines=count_lines(path)))
    return sorted(files, key=lambda item: (-item.lines, item.relative))


def main() -> int:
    args = parse_args()
    root = Path(args.root).resolve()
    sources = scan(root)
    warnings = [item for item in sources if args.warn_limit < item.lines <= args.fail_limit]
    failures = [item for item in sources if item.lines > args.fail_limit]

    if warnings:
        print(f"source length warnings (>{args.warn_limit} lines):")
        for item in warnings:
            print(f"  {item.lines:5d}  {item.relative}")

    if failures:
        print(f"source length failures (>{args.fail_limit} lines):", file=sys.stderr)
        for item in failures:
            print(f"  {item.lines:5d}  {item.relative}", file=sys.stderr)
        return 1

    print(
        f"source length check passed: {len(sources)} files scanned, "
        f"{len(warnings)} warnings, 0 failures"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
