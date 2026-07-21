import unittest

from release_workflow import validate_release_shell


class ReleaseWorkflowTest(unittest.TestCase):
    def test_stable_release_shell_accepts_matching_draft(self) -> None:
        validate_release_shell(
            {
                "tag_name": "v0.6.2",
                "draft": True,
                "prerelease": False,
                "target_commitish": "abc123",
            },
            channel="stable",
            target_sha="abc123",
        )

    def test_stable_release_shell_rejects_published_release(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            r"Stable release v0\.6\.2 already exists as a published release\.",
        ):
            validate_release_shell(
                {
                    "tag_name": "v0.6.2",
                    "draft": False,
                    "prerelease": False,
                    "target_commitish": "abc123",
                },
                channel="stable",
                target_sha="abc123",
            )

    def test_stable_release_shell_rejects_prerelease_shell(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            r"Stable release v0\.6\.2 cannot reuse a prerelease shell\.",
        ):
            validate_release_shell(
                {
                    "tag_name": "v0.6.2",
                    "draft": True,
                    "prerelease": True,
                    "target_commitish": "abc123",
                },
                channel="stable",
                target_sha="abc123",
            )

    def test_dev_release_shell_accepts_matching_draft_prerelease(self) -> None:
        validate_release_shell(
            {
                "tag_name": "v0.6.2-dev.1",
                "draft": True,
                "prerelease": True,
                "target_commitish": "abc123",
            },
            channel="dev",
            target_sha="abc123",
        )

    def test_dev_release_shell_rejects_non_prerelease_shell(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            r"Dev release v0\.6\.2-dev\.1 must remain a prerelease shell\.",
        ):
            validate_release_shell(
                {
                    "tag_name": "v0.6.2-dev.1",
                    "draft": True,
                    "prerelease": False,
                    "target_commitish": "abc123",
                },
                channel="dev",
                target_sha="abc123",
            )

    def test_release_shell_rejects_target_sha_mismatch(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            r"Stable release v0\.6\.2 targets old123, expected abc123\.",
        ):
            validate_release_shell(
                {
                    "tag_name": "v0.6.2",
                    "draft": True,
                    "prerelease": False,
                    "target_commitish": "old123",
                },
                channel="stable",
                target_sha="abc123",
            )


if __name__ == "__main__":
    unittest.main()
