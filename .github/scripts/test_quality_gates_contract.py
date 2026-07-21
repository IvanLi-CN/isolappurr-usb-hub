import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
QUALITY_GATES = ROOT / ".github" / "quality-gates.json"

EXPECTED_REQUIRED_CHECKS = [
    "Label Gate",
    "CI / Web (quality gates)",
    "CI / Rust fmt",
    "Firmware (ESP32-S3) / build",
    "Host tools / linux-x86_64",
    "Host tools / macos-aarch64",
    "Host tools / windows-x86_64",
    "Desktop / web dist",
    "Desktop / macos",
    "Desktop / windows",
    "Desktop / linux",
    "Pages / PR build",
    "Repo Contracts / Python contract tests",
]

EXPECTED_PR_WORKFLOWS = {
    "Label Gate": ROOT / ".github" / "workflows" / "label-gate.yml",
    "CI": ROOT / ".github" / "workflows" / "ci.yml",
    "Firmware (ESP32-S3)": ROOT / ".github" / "workflows" / "firmware.yml",
    "Host tools": ROOT / ".github" / "workflows" / "host-tools.yml",
    "Desktop": ROOT / ".github" / "workflows" / "desktop.yml",
    "Pages": ROOT / ".github" / "workflows" / "pages.yml",
    "Repo Contracts": ROOT / ".github" / "workflows" / "repo-contracts.yml",
}


def workflow_on_block(workflow_path: pathlib.Path) -> str:
    text = workflow_path.read_text(encoding="utf-8")
    start = text.index("on:\n")
    end = text.index("\npermissions:\n", start)
    return text[start:end]


class QualityGatesContractTest(unittest.TestCase):
    def test_quality_gates_uses_current_schema_and_unique_required_checks(self) -> None:
        declaration = json.loads(QUALITY_GATES.read_text(encoding="utf-8"))

        self.assertEqual(declaration["schema_version"], 1)
        self.assertEqual(declaration["implementation_profile"], "final")
        self.assertEqual(
            declaration["policy"]["branch_protection"]["protected_branches"],
            ["main"],
        )
        self.assertTrue(declaration["policy"]["require_signed_commits"])
        self.assertEqual(declaration["informational_checks"], [])
        self.assertEqual(declaration["waivers"], [])
        self.assertEqual(declaration["required_checks"], EXPECTED_REQUIRED_CHECKS)
        self.assertEqual(
            len(declaration["required_checks"]),
            len(set(declaration["required_checks"])),
            msg="required_checks must not contain duplicates",
        )
        self.assertIn("releaseIntent", declaration)

    def test_expected_pr_workflows_flatten_to_required_checks(self) -> None:
        declaration = json.loads(QUALITY_GATES.read_text(encoding="utf-8"))
        expected_workflows = declaration["expected_pr_workflows"]

        self.assertEqual(
            [item["workflow"] for item in expected_workflows],
            list(EXPECTED_PR_WORKFLOWS.keys()),
        )

        flattened_jobs: list[str] = []
        for item in expected_workflows:
            flattened_jobs.extend(item["jobs"])

        self.assertEqual(flattened_jobs, declaration["required_checks"])

    def test_required_pr_workflows_report_merge_group_and_avoid_trigger_level_path_filters(
        self,
    ) -> None:
        for workflow_name, workflow_path in EXPECTED_PR_WORKFLOWS.items():
            on_block = workflow_on_block(workflow_path)
            self.assertIn(
                "pull_request:\n",
                on_block,
                msg=f"{workflow_name} must trigger on pull_request",
            )
            self.assertIn(
                "merge_group:\n",
                on_block,
                msg=f"{workflow_name} must trigger on merge_group",
            )
            self.assertNotIn(
                "paths:\n",
                on_block,
                msg=f"{workflow_name} must not rely on trigger-level paths filters",
            )
            self.assertNotIn(
                "paths-ignore:\n",
                on_block,
                msg=f"{workflow_name} must not rely on trigger-level paths-ignore filters",
            )

    def test_host_tools_required_matrix_checks_always_materialize(self) -> None:
        text = EXPECTED_PR_WORKFLOWS["Host tools"].read_text(encoding="utf-8")
        build_header = text.split("\n  build:\n", 1)[1].split("\n    steps:\n", 1)[0]

        self.assertIn("name: Host tools / ${{ matrix.slug }}", build_header)
        self.assertNotIn(
            "if: needs.gate.outputs.run_build == 'true'",
            build_header,
            msg="required matrix job must expand even when build inputs are unchanged",
        )
        self.assertIn("- name: Skip host tools build", text)
        self.assertIn("if: needs.gate.outputs.run_build != 'true'", text)

    def test_desktop_required_matrix_checks_always_materialize(self) -> None:
        text = EXPECTED_PR_WORKFLOWS["Desktop"].read_text(encoding="utf-8")
        build_header = text.split("\n  build:\n", 1)[1].split("\n    steps:\n", 1)[0]

        self.assertIn("name: Desktop / ${{ matrix.name }}", build_header)
        self.assertNotIn(
            "if: needs.gate.outputs.run_build == 'true'",
            build_header,
            msg="required desktop matrix job must expand even when inputs are unchanged",
        )
        self.assertIn("- name: Skip desktop build", text)
        self.assertIn("SHOULD_BUILD:", text)


if __name__ == "__main__":
    unittest.main()
