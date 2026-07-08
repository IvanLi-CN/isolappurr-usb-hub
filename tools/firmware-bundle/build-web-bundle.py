#!/usr/bin/env python3
"""Build a same-origin firmware bundle manifest for the web app."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


CATALOG_ASSET_NAME = "isolapurr-firmware-catalog.json"
APP_BIN_ASSET_NAME = "isolapurr-usb-hub.app.bin"


@dataclass
class ReleaseAsset:
    name: str
    url: str
    size: int


def request_json(url: str, token: str | None) -> Any:
    request = Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "isolapurr-firmware-bundle-builder",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    with urlopen(request) as response:  # noqa: S310
        return json.load(response)


def download(url: str, out_path: Path, token: str | None) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    request = Request(
        url,
        headers={
            "Accept": "application/octet-stream",
            "User-Agent": "isolapurr-firmware-bundle-builder",
            **({"Authorization": f"Bearer {token}"} if token else {}),
        },
    )
    with urlopen(request) as response, out_path.open("wb") as fh:  # noqa: S310
        shutil.copyfileobj(response, fh)


def sanitize_tag(tag_name: str) -> str:
    return "".join(
        ch if ch.isalnum() or ch in {"-", "_", "."} else "-"
        for ch in tag_name
    )


def asset_map(release: dict[str, Any]) -> dict[str, ReleaseAsset]:
    return {
        asset["name"]: ReleaseAsset(
            name=asset["name"],
            url=asset["browser_download_url"],
            size=asset.get("size", 0),
        )
        for asset in release.get("assets", [])
        if isinstance(asset, dict)
        and isinstance(asset.get("name"), str)
        and isinstance(asset.get("browser_download_url"), str)
    }


def select_release_window(
    releases: list[dict[str, Any]],
    limit: int,
) -> list[dict[str, Any]]:
    return [
        release
        for release in releases
        if isinstance(release, dict)
        and release.get("draft") is False
        and isinstance(release.get("tag_name"), str)
        and isinstance(release.get("published_at"), str)
    ][: max(limit, 0)]


def select_recovery_tags(releases: list[dict[str, Any]]) -> set[str]:
    latest_stable = next(
        (release["tag_name"] for release in releases if not release.get("prerelease")),
        None,
    )
    latest_prerelease = next(
        (release["tag_name"] for release in releases if release.get("prerelease")),
        None,
    )
    return {tag for tag in [latest_stable, latest_prerelease] if tag}


def read_catalog(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def artifact_by_target(catalog: dict[str, Any], target: str) -> dict[str, Any] | None:
    for artifact in catalog.get("artifacts", []):
        if isinstance(artifact, dict) and artifact.get("target") == target:
            return artifact
    return None


def first_file_by_kind(
    artifact: dict[str, Any] | None,
    kind: str,
) -> dict[str, Any] | None:
    if not artifact:
        return None
    for file in artifact.get("files", []):
        if isinstance(file, dict) and file.get("kind") == kind:
            return file
    return None


def select_recovery_artifact(
    catalog: dict[str, Any],
    assets: dict[str, ReleaseAsset],
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    recovery_artifact = artifact_by_target(catalog, "esp32s3_full")
    recovery_file = first_file_by_kind(recovery_artifact, "full_image")
    if (
        recovery_artifact
        and recovery_file
        and isinstance(recovery_file.get("path"), str)
        and recovery_file["path"] in assets
    ):
        return recovery_artifact, recovery_file

    app_artifact = artifact_by_target(catalog, "esp32s3_app")
    elf_file = first_file_by_kind(app_artifact, "elf")
    if (
        app_artifact
        and elf_file
        and isinstance(elf_file.get("path"), str)
        and elf_file["path"] in assets
    ):
        return app_artifact, elf_file

    return None


def output_path_for(tag_name: str, asset_name: str) -> str:
    return f"releases/{sanitize_tag(tag_name)}/{asset_name}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, help="GitHub owner/repo")
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--github-token-env", default="GITHUB_TOKEN")
    args = parser.parse_args()

    token = os.getenv(args.github_token_env)
    api_url = f"https://api.github.com/repos/{args.repo}/releases?per_page=100"

    try:
        releases = request_json(api_url, token)
    except (HTTPError, URLError) as err:
        raise SystemExit(f"failed to load releases from {api_url}: {err}") from err

    if not isinstance(releases, list):
        raise SystemExit("GitHub releases API did not return a list")

    selected = select_release_window(releases, args.limit)
    recovery_tags = select_recovery_tags(selected)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for child in args.output_dir.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()

    manifest_entries: list[dict[str, Any]] = []
    bundled_recovery_tags: set[str] = set()
    for release in selected:
        tag_name = release["tag_name"]
        assets = asset_map(release)
        if CATALOG_ASSET_NAME not in assets or APP_BIN_ASSET_NAME not in assets:
            continue

        catalog_rel_path = output_path_for(tag_name, CATALOG_ASSET_NAME)
        app_rel_path = output_path_for(tag_name, APP_BIN_ASSET_NAME)
        download(assets[CATALOG_ASSET_NAME].url, args.output_dir / catalog_rel_path, token)
        download(assets[APP_BIN_ASSET_NAME].url, args.output_dir / app_rel_path, token)

        catalog = read_catalog(args.output_dir / catalog_rel_path)
        app_artifact = artifact_by_target(catalog, "esp32s3_app")
        if not app_artifact:
            continue
        app_file = first_file_by_kind(app_artifact, "app_bin")
        if not app_file:
            continue

        recovery_entry: dict[str, Any] | None = None
        recovery_selection = select_recovery_artifact(catalog, assets)
        if tag_name in recovery_tags and recovery_selection:
            recovery_artifact, recovery_file = recovery_selection
            recovery_asset_name = recovery_file["path"]
            recovery_rel_path = output_path_for(tag_name, recovery_asset_name)
            download(
                assets[recovery_asset_name].url,
                args.output_dir / recovery_rel_path,
                token,
            )
            recovery_entry = {
                "artifactId": recovery_artifact["artifactId"],
                "assetPath": f"firmware/{recovery_rel_path}",
                "fileName": recovery_asset_name,
                "fileKind": recovery_file["kind"],
                "flashAddress": recovery_file.get("flashAddress", 0),
                "sha256": recovery_file.get("sha256"),
                "size": recovery_file.get("size"),
            }
            bundled_recovery_tags.add(tag_name)

        manifest_entries.append(
            {
                "tagName": tag_name,
                "version": app_artifact.get("version", tag_name),
                "publishedAt": release["published_at"],
                "prerelease": bool(release.get("prerelease")),
                "catalogPath": f"firmware/{catalog_rel_path}",
                "app": {
                    "artifactId": app_artifact["artifactId"],
                    "assetPath": f"firmware/{app_rel_path}",
                    "fileName": APP_BIN_ASSET_NAME,
                    "fileKind": "app_bin",
                    "flashAddress": app_file.get("flashAddress", 0x10000),
                    "sha256": app_file.get("sha256"),
                    "size": app_file.get("size"),
                },
                "recovery": recovery_entry,
            }
        )

    payload = {
        "schemaVersion": "1",
        "repo": args.repo,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "releaseCount": len(manifest_entries),
        "recoveryTags": sorted(bundled_recovery_tags),
        "releases": manifest_entries,
    }
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        sys.exit(130)
