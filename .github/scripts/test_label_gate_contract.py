import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
LABEL_GATE_WORKFLOW = ROOT / ".github" / "workflows" / "label-gate.yml"


class LabelGateWorkflowContractTest(unittest.TestCase):
    def test_label_gate_reads_current_pull_request_labels(self) -> None:
        workflow = LABEL_GATE_WORKFLOW.read_text(encoding="utf-8")

        self.assertIn('gh pr view "$PR_NUMBER" --json labels --jq \'.labels\' > labels.json', workflow)
        self.assertIn("--labels-json-file labels.json", workflow)
        self.assertNotIn('--event "$GITHUB_EVENT_PATH"', workflow)


if __name__ == "__main__":
    unittest.main()
