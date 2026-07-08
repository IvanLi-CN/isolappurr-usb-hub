import importlib.util
import pathlib
import sys
import unittest


SCRIPT_PATH = (
    pathlib.Path(__file__).resolve().parents[2]
    / "tools"
    / "firmware-bundle"
    / "build-web-bundle.py"
)


def load_module():
    spec = importlib.util.spec_from_file_location("build_web_bundle", SCRIPT_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("failed to load build-web-bundle.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


build_web_bundle = load_module()


class BuildWebBundleTest(unittest.TestCase):
    def test_select_release_window_filters_drafts_and_invalid_rows(self) -> None:
        releases = [
            {
                "tag_name": "v0.6.0",
                "draft": False,
                "published_at": "2026-07-08T12:00:00Z",
            },
            {
                "tag_name": "v0.5.9",
                "draft": True,
                "published_at": "2026-07-07T12:00:00Z",
            },
            {
                "tag_name": "v0.5.8",
                "draft": False,
                "published_at": None,
            },
            {
                "tag_name": "v0.5.7",
                "draft": False,
                "published_at": "2026-07-05T12:00:00Z",
            },
        ]

        selected = build_web_bundle.select_release_window(releases, 2)

        self.assertEqual([release["tag_name"] for release in selected], ["v0.6.0", "v0.5.7"])

    def test_select_recovery_tags_picks_latest_stable_and_prerelease(self) -> None:
        releases = [
            {"tag_name": "v0.6.0-dev.2", "prerelease": True},
            {"tag_name": "v0.6.0", "prerelease": False},
            {"tag_name": "v0.5.9", "prerelease": False},
            {"tag_name": "v0.5.9-dev.1", "prerelease": True},
        ]

        tags = build_web_bundle.select_recovery_tags(releases)

        self.assertEqual(tags, {"v0.6.0", "v0.6.0-dev.2"})

    def test_output_paths_stay_relative_to_web_base(self) -> None:
        self.assertEqual(
            build_web_bundle.output_path_for("v0.6.0-dev.2", "isolapurr-usb-hub.full.bin"),
            "releases/v0.6.0-dev.2/isolapurr-usb-hub.full.bin",
        )

    def test_select_recovery_artifact_falls_back_to_elf(self) -> None:
        catalog = {
            "artifacts": [
                {
                    "artifactId": "isolapurr-3550a0c263a8",
                    "target": "esp32s3_app",
                    "files": [
                        {
                            "kind": "app_bin",
                            "path": "isolapurr-usb-hub.app.bin",
                        },
                        {
                            "kind": "elf",
                            "path": "isolapurr-usb-hub.elf",
                        },
                    ],
                }
            ]
        }
        assets = {
            "isolapurr-usb-hub.elf": build_web_bundle.ReleaseAsset(
                name="isolapurr-usb-hub.elf",
                url="https://example.invalid/isolapurr-usb-hub.elf",
                size=123,
            )
        }

        selected = build_web_bundle.select_recovery_artifact(catalog, assets)

        self.assertIsNotNone(selected)
        artifact, firmware_file = selected
        self.assertEqual(artifact["target"], "esp32s3_app")
        self.assertEqual(firmware_file["kind"], "elf")


if __name__ == "__main__":
    unittest.main()
