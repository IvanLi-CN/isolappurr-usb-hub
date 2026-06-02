import unittest

from release_intent import resolve_version, validate_labels


POLICY = {
    "releaseIntent": {
        "typeLabels": ["type:major", "type:minor", "type:patch", "type:none"],
        "channelLabels": ["channel:stable", "channel:dev"],
        "componentLabels": ["component:host-tools", "component:firmware"],
        "unknownReleaseLabelPrefixes": ["type:", "channel:", "component:"],
    }
}


class ReleaseIntentTest(unittest.TestCase):
    def test_accepts_exact_release_intent(self) -> None:
        result = validate_labels(
            ["type:minor", "channel:stable", "component:firmware"], POLICY
        )
        self.assertTrue(result["valid"])
        self.assertTrue(result["shouldRelease"])
        self.assertEqual(result["type"], "minor")
        self.assertEqual(result["channel"], "stable")
        self.assertEqual(result["components"], ["firmware"])

    def test_rejects_missing_or_duplicate_release_intent(self) -> None:
        result = validate_labels(["type:minor", "type:patch", "channel:dev"], POLICY)
        self.assertFalse(result["valid"])
        self.assertIn("expected exactly one type label", result["errors"][0])

    def test_rejects_unknown_reserved_label(self) -> None:
        result = validate_labels(["type:minor", "channel:stable", "type:tiny"], POLICY)
        self.assertFalse(result["valid"])
        self.assertIn("unknown release-intent labels", result["errors"][-1])

    def test_type_none_is_valid_without_release(self) -> None:
        result = validate_labels(["type:none", "channel:dev"], POLICY)
        self.assertTrue(result["valid"])
        self.assertFalse(result["shouldRelease"])

    def test_first_stable_release_is_0_1_0(self) -> None:
        result = resolve_version("patch", "stable", [])
        self.assertEqual(result["tag"], "v0.1.0")
        self.assertFalse(result["isPrerelease"])

    def test_stable_release_bumps_latest_stable(self) -> None:
        result = resolve_version("minor", "stable", ["v0.1.0", "v0.2.0-dev.1"])
        self.assertEqual(result["tag"], "v0.2.0")

    def test_dev_release_increments_for_target_base(self) -> None:
        result = resolve_version(
            "minor", "dev", ["v0.1.0", "v0.2.0-dev.1", "v0.2.0-dev.2"]
        )
        self.assertEqual(result["tag"], "v0.2.0-dev.3")
        self.assertTrue(result["isPrerelease"])


if __name__ == "__main__":
    unittest.main()
