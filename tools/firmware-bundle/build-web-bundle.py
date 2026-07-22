#!/usr/bin/env python3
"""Build a same-origin firmware bundle manifest for the web app."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
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


def write_catalog(path: Path, payload: dict[str, Any]) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


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


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def copy_file(source: Path, destination: Path) -> None:
    if not source.is_file():
        raise SystemExit(f"required firmware bundle input is missing: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def synthesized_full_image_name(elf_name: str) -> str:
    if elf_name.endswith(".elf"):
        return f"{elf_name[:-4]}.full.bin"
    return f"{elf_name}.full.bin"


def save_image_command(elf_path: Path, out_path: Path, *, merged: bool) -> list[str]:
    command = [
        "espflash",
        "save-image",
        "--chip",
        "esp32s3",
    ]
    if merged:
        command.extend(["--merge", "--skip-padding"])
    command.extend([str(elf_path), str(out_path)])
    return command


def generate_full_image_from_elf(elf_path: Path, out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        save_image_command(elf_path, out_path, merged=True),
        capture_output=True,
        text=True,
        check=False,
        env={**os.environ, "ESPFLASH_SKIP_UPDATE_CHECK": "true"},
    )
    if result.returncode == 0:
        return
    combined = "\n".join(
        part.strip() for part in [result.stdout, result.stderr] if part.strip()
    )
    detail = f": {combined}" if combined else ""
    raise SystemExit(
        f"failed to synthesize full_image from {elf_path.name} with espflash{detail}"
    )


def inject_synthesized_recovery_artifact(
    catalog: dict[str, Any],
    app_artifact: dict[str, Any],
    *,
    file_name: str,
    sha256: str,
    size: int,
) -> dict[str, Any]:
    artifacts = catalog.setdefault("artifacts", [])
    if not isinstance(artifacts, list):
        raise SystemExit("firmware catalog artifacts field is not a list")

    recovery_artifact = artifact_by_target(catalog, "esp32s3_full")
    synthesized = {
        "artifactId": f"{app_artifact['artifactId']}-recovery",
        "target": "esp32s3_full",
        "version": app_artifact.get("version"),
        "gitSha": app_artifact.get("gitSha"),
        "buildId": app_artifact.get("buildId"),
        "files": [
            {
                "kind": "full_image",
                "path": file_name,
                "sha256": sha256,
                "size": size,
                "flashAddress": 0,
            }
        ],
    }
    if recovery_artifact is None:
        artifacts.append(synthesized)
        return synthesized

    recovery_artifact.update(
        {
            "artifactId": synthesized["artifactId"],
            "target": "esp32s3_full",
            "version": synthesized["version"],
            "gitSha": synthesized["gitSha"],
            "buildId": synthesized["buildId"],
            "files": synthesized["files"],
        }
    )
    return recovery_artifact


def current_release_manifest_entry(
    *,
    output_dir: Path,
    tag_name: str,
    version: str,
    published_at: str,
    prerelease: bool,
    catalog_path: Path,
    app_bin_path: Path,
    full_image_path: Path | None,
) -> tuple[dict[str, Any], bool]:
    catalog = read_catalog(catalog_path)
    app_artifact = artifact_by_target(catalog, "esp32s3_app")
    if not app_artifact:
        raise SystemExit("current firmware catalog does not include esp32s3_app")
    app_file = first_file_by_kind(app_artifact, "app_bin")
    if not app_file:
        raise SystemExit("current firmware catalog does not include app_bin")
    app_asset_name = app_file.get("path")
    if not isinstance(app_asset_name, str) or not app_asset_name:
        app_asset_name = app_bin_path.name

    catalog_rel_path = output_path_for(tag_name, CATALOG_ASSET_NAME)
    app_rel_path = output_path_for(tag_name, app_asset_name)
    catalog_out_path = output_dir / catalog_rel_path
    app_out_path = output_dir / app_rel_path
    catalog_out_path.parent.mkdir(parents=True, exist_ok=True)
    write_catalog(catalog_out_path, catalog)
    copy_file(app_bin_path, app_out_path)

    recovery_entry: dict[str, Any] | None = None
    bundled_recovery = False
    recovery_artifact = artifact_by_target(catalog, "esp32s3_full")
    recovery_file = first_file_by_kind(recovery_artifact, "full_image")
    if full_image_path is not None and recovery_artifact and recovery_file:
        recovery_asset_name = recovery_file.get("path")
        if not isinstance(recovery_asset_name, str) or not recovery_asset_name:
            recovery_asset_name = full_image_path.name
        recovery_rel_path = output_path_for(tag_name, recovery_asset_name)
        recovery_out_path = output_dir / recovery_rel_path
        copy_file(full_image_path, recovery_out_path)
        recovery_entry = {
            "artifactId": recovery_artifact["artifactId"],
            "assetPath": f"firmware/{recovery_rel_path}",
            "fileName": recovery_asset_name,
            "fileKind": "full_image",
            "flashAddress": recovery_file.get("flashAddress", 0),
            "sha256": recovery_file.get("sha256") or sha256_file(recovery_out_path),
            "size": recovery_file.get("size") or recovery_out_path.stat().st_size,
        }
        bundled_recovery = True

    return (
        {
            "tagName": tag_name,
            "version": version,
            "publishedAt": published_at,
            "prerelease": prerelease,
            "catalogPath": f"firmware/{catalog_rel_path}",
            "app": {
                "artifactId": app_artifact["artifactId"],
                "assetPath": f"firmware/{app_rel_path}",
                "fileName": app_asset_name,
                "fileKind": "app_bin",
                "flashAddress": app_file.get("flashAddress", 0x10000),
                "sha256": app_file.get("sha256") or sha256_file(app_out_path),
                "size": app_file.get("size") or app_out_path.stat().st_size,
            },
            "recovery": recovery_entry,
        },
        bundled_recovery,
    )


def current_release_args_present(args: argparse.Namespace) -> bool:
    fields = [
        args.current_release_tag,
        args.current_release_version,
        args.current_published_at,
        args.current_catalog,
        args.current_app_bin,
    ]
    present = [field is not None and field != "" for field in fields]
    if any(present) and not all(present):
        raise SystemExit(
            "current release injection requires --current-release-tag, "
            "--current-release-version, --current-published-at, "
            "--current-catalog, and --current-app-bin"
        )
    return all(present)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True, help="GitHub owner/repo")
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--github-token-env", default="GITHUB_TOKEN")
    parser.add_argument("--current-release-tag")
    parser.add_argument("--current-release-version")
    parser.add_argument("--current-published-at")
    parser.add_argument("--current-prerelease", action="store_true")
    parser.add_argument("--current-catalog", type=Path)
    parser.add_argument("--current-app-bin", type=Path)
    parser.add_argument("--current-full-image", type=Path)
    args = parser.parse_args()

    token = os.getenv(args.github_token_env)
    api_url = f"https://api.github.com/repos/{args.repo}/releases?per_page=100"

    try:
        releases = request_json(api_url, token)
    except (HTTPError, URLError) as err:
        raise SystemExit(f"failed to load releases from {api_url}: {err}") from err

    if not isinstance(releases, list):
        raise SystemExit("GitHub releases API did not return a list")

    has_current_release = current_release_args_present(args)
    selected = select_release_window(releases, args.limit)
    if has_current_release:
        selected = [
            release
            for release in selected
            if release.get("tag_name") != args.current_release_tag
        ][: max(args.limit - 1, 0)]
    recovery_release_window = [
        *(
            [
                {
                    "tag_name": args.current_release_tag,
                    "prerelease": args.current_prerelease,
                }
            ]
            if has_current_release
            else []
        ),
        *selected,
    ]
    recovery_tags = select_recovery_tags(recovery_release_window)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    for child in args.output_dir.iterdir():
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()

    manifest_entries: list[dict[str, Any]] = []
    bundled_recovery_tags: set[str] = set()
    if has_current_release:
        current_entry, bundled_recovery = current_release_manifest_entry(
            output_dir=args.output_dir,
            tag_name=args.current_release_tag,
            version=args.current_release_version,
            published_at=args.current_published_at,
            prerelease=args.current_prerelease,
            catalog_path=args.current_catalog,
            app_bin_path=args.current_app_bin,
            full_image_path=args.current_full_image,
        )
        manifest_entries.append(current_entry)
        if bundled_recovery:
            bundled_recovery_tags.add(args.current_release_tag)

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
            recovery_file_kind = recovery_file["kind"]
            if recovery_file_kind == "elf":
                recovery_source_rel_path = output_path_for(tag_name, recovery_asset_name)
                recovery_source_path = args.output_dir / recovery_source_rel_path
                download(assets[recovery_asset_name].url, recovery_source_path, token)
                synthesized_name = synthesized_full_image_name(recovery_asset_name)
                recovery_rel_path = output_path_for(tag_name, synthesized_name)
                recovery_output_path = args.output_dir / recovery_rel_path
                generate_full_image_from_elf(recovery_source_path, recovery_output_path)
                recovery_source_path.unlink(missing_ok=True)
                recovery_sha256 = sha256_file(recovery_output_path)
                recovery_size = recovery_output_path.stat().st_size
                recovery_artifact = inject_synthesized_recovery_artifact(
                    catalog,
                    app_artifact,
                    file_name=synthesized_name,
                    sha256=recovery_sha256,
                    size=recovery_size,
                )
                write_catalog(args.output_dir / catalog_rel_path, catalog)
                recovery_asset_name = synthesized_name
                recovery_file_kind = "full_image"
            else:
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
                "fileKind": recovery_file_kind,
                "flashAddress": 0 if recovery_file_kind == "full_image" else recovery_file.get("flashAddress", 0),
                "sha256": sha256_file(args.output_dir / recovery_rel_path)
                if recovery_file_kind == "full_image"
                else recovery_file.get("sha256"),
                "size": (args.output_dir / recovery_rel_path).stat().st_size
                if recovery_file_kind == "full_image"
                else recovery_file.get("size"),
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
