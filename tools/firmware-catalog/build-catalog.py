#!/usr/bin/env python3
"""Build an IsolaPurr firmware catalog from release artifacts."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--artifact-id", required=True)
    parser.add_argument("--recovery-artifact-id", type=str)
    parser.add_argument("--version", required=True)
    parser.add_argument("--git-sha", required=True)
    parser.add_argument("--build-id", required=True)
    parser.add_argument("--app-bin", type=Path)
    parser.add_argument("--elf", type=Path)
    parser.add_argument("--full-image", type=Path)
    args = parser.parse_args()

    app_files = []
    if args.app_bin:
        app_files.append(
            {
                "kind": "app_bin",
                "path": args.app_bin.name,
                "sha256": sha256(args.app_bin),
                "size": args.app_bin.stat().st_size,
                "flashAddress": 0x10000,
            }
        )
    if args.elf:
        app_files.append(
            {
                "kind": "elf",
                "path": args.elf.name,
                "sha256": sha256(args.elf),
                "size": args.elf.stat().st_size,
            }
        )

    if not app_files:
        raise SystemExit("at least one of --app-bin or --elf is required")

    recovery_files = []
    if args.full_image:
        recovery_files.append(
            {
                "kind": "full_image",
                "path": args.full_image.name,
                "sha256": sha256(args.full_image),
                "size": args.full_image.stat().st_size,
                "flashAddress": 0x0,
            }
        )
    if args.elf:
        recovery_files.append(
            {
                "kind": "elf",
                "path": args.elf.name,
                "sha256": sha256(args.elf),
                "size": args.elf.stat().st_size,
            }
        )

    artifacts = [
        {
            "artifactId": args.artifact_id,
            "target": "esp32s3_app",
            "version": args.version,
            "gitSha": args.git_sha,
            "buildId": args.build_id,
            "files": app_files,
        }
    ]
    if recovery_files:
        artifacts.append(
            {
                "artifactId": args.recovery_artifact_id
                or f"{args.artifact_id}-recovery",
                "target": "esp32s3_full",
                "version": args.version,
                "gitSha": args.git_sha,
                "buildId": args.build_id,
                "files": recovery_files,
            }
        )

    catalog = {
        "schemaVersion": "1",
        "artifacts": artifacts,
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(catalog, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
