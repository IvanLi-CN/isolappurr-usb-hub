#!/usr/bin/env python3
"""Validate PR release intent labels and resolve release versions."""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SEMVER_TAG_RE = re.compile(
    r"^v(?P<major>0|[1-9]\d*)\.(?P<minor>0|[1-9]\d*)\.(?P<patch>0|[1-9]\d*)"
    r"(?:-(?P<pre>[0-9A-Za-z.-]+))?$"
)


@dataclass(frozen=True, order=True)
class Version:
    major: int
    minor: int
    patch: int

    @classmethod
    def parse_tag(cls, tag: str) -> tuple["Version", str | None] | None:
        match = SEMVER_TAG_RE.match(tag)
        if not match:
            return None
        return (
            cls(
                int(match.group("major")),
                int(match.group("minor")),
                int(match.group("patch")),
            ),
            match.group("pre"),
        )

    def bump(self, release_type: str) -> "Version":
        if release_type == "major":
            return Version(self.major + 1, 0, 0)
        if release_type == "minor":
            return Version(self.major, self.minor + 1, 0)
        if release_type == "patch":
            return Version(self.major, self.minor, self.patch + 1)
        raise ValueError(f"unsupported release type: {release_type}")

    def tag(self) -> str:
        return f"v{self.major}.{self.minor}.{self.patch}"


def load_json(path: str | None, raw: str | None = None) -> Any:
    if raw is not None:
        return json.loads(raw)
    if path is None:
        raise ValueError("missing JSON input")
    return json.loads(Path(path).read_text(encoding="utf-8"))


def labels_from_event(event: dict[str, Any]) -> list[str]:
    pr = event.get("pull_request") or {}
    return [label.get("name", "") for label in pr.get("labels", [])]


def normalize_labels(labels: Any) -> list[str]:
    if not isinstance(labels, list):
        raise ValueError("labels JSON must be a list")
    normalized: list[str] = []
    for label in labels:
        if isinstance(label, str):
            normalized.append(label)
        elif isinstance(label, dict) and isinstance(label.get("name"), str):
            normalized.append(label["name"])
        else:
            raise ValueError(f"unsupported label entry: {label!r}")
    return normalized


def validate_labels(labels: list[str], policy: dict[str, Any]) -> dict[str, Any]:
    release_policy = policy["releaseIntent"]
    type_labels = set(release_policy["typeLabels"])
    channel_labels = set(release_policy["channelLabels"])
    component_labels = set(release_policy["componentLabels"])
    reserved_prefixes = tuple(release_policy["unknownReleaseLabelPrefixes"])

    selected_types = [label for label in labels if label in type_labels]
    selected_channels = [label for label in labels if label in channel_labels]
    selected_components = [label for label in labels if label in component_labels]
    known = type_labels | channel_labels | component_labels
    unknown = [
        label
        for label in labels
        if label.startswith(reserved_prefixes) and label not in known
    ]

    errors: list[str] = []
    if len(selected_types) != 1:
        errors.append(
            f"expected exactly one type label, found {len(selected_types)}: {selected_types}"
        )
    if len(selected_channels) != 1:
        errors.append(
            "expected exactly one channel label, "
            f"found {len(selected_channels)}: {selected_channels}"
        )
    if unknown:
        errors.append(f"unknown release-intent labels: {unknown}")

    result = {
        "valid": not errors,
        "errors": errors,
        "labels": labels,
        "type": selected_types[0].split(":", 1)[1] if len(selected_types) == 1 else None,
        "channel": selected_channels[0].split(":", 1)[1]
        if len(selected_channels) == 1
        else None,
        "components": [label.split(":", 1)[1] for label in selected_components],
    }
    result["shouldRelease"] = result["valid"] and result["type"] != "none"
    return result


def parse_release_tags(raw: Any) -> list[str]:
    if isinstance(raw, list):
        tags = []
        for item in raw:
            if isinstance(item, str):
                tags.append(item)
            elif isinstance(item, dict):
                tag = item.get("tagName") or item.get("tag_name") or item.get("name")
                if isinstance(tag, str):
                    tags.append(tag)
        return tags
    raise ValueError("release tags JSON must be a list")


def resolve_version(release_type: str, channel: str, tags: list[str]) -> dict[str, Any]:
    if release_type == "none":
        return {
            "shouldRelease": False,
            "version": "",
            "tag": "",
            "isPrerelease": False,
        }
    if release_type not in {"major", "minor", "patch"}:
        raise ValueError(f"unsupported release type: {release_type}")
    if channel not in {"stable", "dev"}:
        raise ValueError(f"unsupported channel: {channel}")

    parsed = [Version.parse_tag(tag) for tag in tags]
    parsed = [item for item in parsed if item is not None]
    stable_versions = [version for version, pre in parsed if pre is None]
    latest_stable = max(stable_versions) if stable_versions else None

    base = Version(0, 1, 0) if latest_stable is None else latest_stable.bump(release_type)
    if channel == "stable":
        return {
            "shouldRelease": True,
            "version": base.tag()[1:],
            "tag": base.tag(),
            "isPrerelease": False,
        }

    dev_prefix = f"{base.tag()}-dev."
    dev_numbers: list[int] = []
    for tag in tags:
        if tag.startswith(dev_prefix):
            suffix = tag[len(dev_prefix) :]
            if suffix.isdigit():
                dev_numbers.append(int(suffix))
    next_dev = max(dev_numbers, default=0) + 1
    tag = f"{dev_prefix}{next_dev}"
    return {
        "shouldRelease": True,
        "version": tag[1:],
        "tag": tag,
        "isPrerelease": True,
    }


def write_outputs(values: dict[str, Any], path: str | None) -> None:
    if not path:
        return
    with Path(path).open("a", encoding="utf-8") as fh:
        for key, value in values.items():
            if isinstance(value, bool):
                encoded = "true" if value else "false"
            elif isinstance(value, (list, dict)):
                encoded = json.dumps(value, separators=(",", ":"))
            elif value is None:
                encoded = ""
            else:
                encoded = str(value)
            fh.write(f"{key}={encoded}\n")


def cmd_validate(args: argparse.Namespace) -> int:
    policy = load_json(args.policy)
    event = load_json(args.event) if args.event else None
    if event is not None:
        labels = labels_from_event(event)
    else:
        labels = normalize_labels(load_json(args.labels_json_file, args.labels_json))
    result = validate_labels(labels, policy)
    if args.out:
        Path(args.out).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    write_outputs(result, args.github_output)
    return 0 if result["valid"] else 1


def cmd_resolve(args: argparse.Namespace) -> int:
    tags = parse_release_tags(load_json(args.tags_json_file, args.tags_json))
    result = resolve_version(args.release_type, args.channel, tags)
    if args.out:
        Path(args.out).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))
    write_outputs(result, args.github_output)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="cmd", required=True)

    validate = subparsers.add_parser("validate")
    validate.add_argument("--policy", default=".github/quality-gates.json")
    validate.add_argument("--event")
    validate.add_argument("--labels-json")
    validate.add_argument("--labels-json-file")
    validate.add_argument("--out")
    validate.add_argument("--github-output")
    validate.set_defaults(func=cmd_validate)

    resolve = subparsers.add_parser("resolve-version")
    resolve.add_argument("--release-type", required=True)
    resolve.add_argument("--channel", required=True)
    resolve.add_argument("--tags-json")
    resolve.add_argument("--tags-json-file")
    resolve.add_argument("--out")
    resolve.add_argument("--github-output")
    resolve.set_defaults(func=cmd_resolve)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except Exception as exc:
        print(f"release_intent.py: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
