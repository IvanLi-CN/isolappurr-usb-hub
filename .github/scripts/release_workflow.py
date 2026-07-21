#!/usr/bin/env python3
"""Helpers for release workflow shell validation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def load_json(path: str) -> Any:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def validate_release_shell(
    release: dict[str, Any],
    *,
    channel: str,
    target_sha: str,
) -> None:
    if channel not in {"stable", "dev"}:
        raise ValueError(f"unsupported channel: {channel}")

    kind = "Stable" if channel == "stable" else "Dev"
    tag = (
        release.get("tag_name")
        or release.get("tagName")
        or release.get("name")
        or "<unknown>"
    )

    if not release.get("draft"):
        raise ValueError(
            f"{kind} release {tag} already exists as a published release."
        )

    is_prerelease = bool(release.get("prerelease") or release.get("isPrerelease"))
    if channel == "stable" and is_prerelease:
        raise ValueError(f"{kind} release {tag} cannot reuse a prerelease shell.")
    if channel == "dev" and not is_prerelease:
        raise ValueError(f"{kind} release {tag} must remain a prerelease shell.")

    target = release.get("target_commitish") or release.get("targetCommitish")
    if target and target != target_sha:
        raise ValueError(f"{kind} release {tag} targets {target}, expected {target_sha}.")


def cmd_validate_release_shell(args: argparse.Namespace) -> int:
    validate_release_shell(
        load_json(args.release_json_file),
        channel=args.channel,
        target_sha=args.target_sha,
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="cmd", required=True)

    validate = subparsers.add_parser("validate-release-shell")
    validate.add_argument("--release-json-file", required=True)
    validate.add_argument("--channel", required=True)
    validate.add_argument("--target-sha", required=True)
    validate.set_defaults(func=cmd_validate_release_shell)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
