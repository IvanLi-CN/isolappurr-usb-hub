import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
PAGES_WORKFLOW = ROOT / ".github" / "workflows" / "pages.yml"
RELEASE_WORKFLOW = ROOT / ".github" / "workflows" / "release.yml"


class ReleasePagesContractTest(unittest.TestCase):
    def test_pages_workflow_is_pr_check_plus_release_tag_backfill_only(self) -> None:
        workflow = PAGES_WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("name: Pages\n", workflow)
        self.assertIn("pull_request:\n", workflow)
        self.assertIn("merge_group:\n", workflow)
        self.assertIn("workflow_dispatch:\n", workflow)
        self.assertIn("release_tag:\n", workflow)
        self.assertNotIn("\n  push:\n", workflow)
        self.assertIn("name: PR build\n", workflow)
        self.assertIn('gh release download "$RELEASE_TAG"', workflow)
        self.assertNotIn("bun run retain-pages-assets", workflow)

    def test_release_workflow_prepares_draft_then_deploys_pages_before_publish(self) -> None:
        workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")

        prepare_index = workflow.index("name: prepare stable draft release")
        deploy_index = workflow.index("name: deploy stable public site")
        publish_index = workflow.index("name: publish GitHub release")

        self.assertLess(prepare_index, deploy_index)
        self.assertLess(deploy_index, publish_index)
        self.assertIn("uses: actions/upload-pages-artifact@v5", workflow)
        self.assertIn("uses: actions/deploy-pages@v5", workflow)
        self.assertIn("bun run retain-pages-assets", workflow)
        self.assertIn("gh release upload", workflow)
        self.assertIn("gh release edit", workflow)


if __name__ == "__main__":
    unittest.main()
