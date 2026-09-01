import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "notify-release-failure.yml"
OIDRUNE_NOTIFY_REF = (
    "IvanLi-CN/oidrune/.github/workflows/notify.yml@"
    "e48822f99c6402a753ed86557ea029754cbab20b"
)


class NotifyReleaseFailureContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.workflow = WORKFLOW.read_text(encoding="utf-8")

    def test_calls_are_pinned_to_trusted_oidrune_release(self) -> None:
        self.assertEqual(self.workflow.count(f"uses: {OIDRUNE_NOTIFY_REF}"), 2)
        self.assertNotIn("IvanLi-CN/github-workflows/.github/workflows/", self.workflow)
        self.assertNotIn("@main", self.workflow)

    def test_trigger_and_failure_filters_are_preserved(self) -> None:
        self.assertIn("workflow_run:\n", self.workflow)
        self.assertIn("workflows:\n      - Release\n", self.workflow)
        self.assertIn("types:\n      - completed\n", self.workflow)
        self.assertIn(
            "if: github.event_name == 'workflow_run' && github.event.workflow_run.conclusion == 'failure'",
            self.workflow,
        )
        self.assertIn("workflow_dispatch:\n", self.workflow)
        self.assertIn("if: github.event_name == 'workflow_dispatch'", self.workflow)

    def test_each_caller_job_grants_oidc_and_uses_supported_inputs(self) -> None:
        self.assertEqual(self.workflow.count("permissions:\n      id-token: write"), 2)
        self.assertEqual(self.workflow.count("outcome: failure"), 2)
        self.assertEqual(self.workflow.count("summary: >-"), 2)
        self.assertNotIn("gateway_url", self.workflow)
        self.assertNotIn("oidc_audience", self.workflow)
        self.assertNotIn("SHOUTRRR_URL", self.workflow)
        self.assertNotIn("secrets:", self.workflow)

    def test_summaries_are_complete_and_distinguish_failure_from_smoke(self) -> None:
        for field in ("project:", "status:", "result:", "target_sha:", "run_url:", "title:"):
            self.assertEqual(self.workflow.count(field), 2, msg=f"missing summary field: {field}")
        self.assertIn("title: Release workflow failure", self.workflow)
        self.assertIn("title: Release notification smoke", self.workflow)
        self.assertIn("${{ github.event.workflow_run.head_sha }}", self.workflow)
        self.assertIn("${{ github.event.workflow_run.html_url }}", self.workflow)
        self.assertIn(
            "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
            self.workflow,
        )


if __name__ == "__main__":
    unittest.main()
