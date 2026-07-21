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
        self.assertIn("name: Pages / PR build\n", workflow)
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

    def test_release_workflow_persists_build_date_for_retention(self) -> None:
        workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")

        self.assertIn(
            'echo "VITE_BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$GITHUB_ENV"',
            workflow,
        )
        self.assertIn("VITE_BUILD_DATE: ${{ env.VITE_BUILD_DATE }}", workflow)

    def test_release_workflow_finds_draft_releases_from_list_api(self) -> None:
        workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")

        self.assertNotIn("/releases/tags/${RELEASE_TAG}", workflow)
        self.assertIn("/releases?per_page=200", workflow)
        self.assertIn("first(.[] | select(.tag_name == $tag)) // empty", workflow)

    def test_release_workflow_uses_scripted_release_shell_validation(self) -> None:
        workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")

        self.assertEqual(workflow.count("python3 - <<'PY'"), 4)
        self.assertEqual(
            workflow.count("python3 .github/scripts/release_workflow.py validate-release-shell"),
            1,
        )
        self.assertEqual(
            workflow.count(
                "python3 release-helpers/.github/scripts/release_workflow.py validate-release-shell"
            ),
            2,
        )

    def test_release_workflow_keeps_dev_jobs_running_when_stable_gates_are_skipped(self) -> None:
        workflow = RELEASE_WORKFLOW.read_text(encoding="utf-8")

        self.assertIn(
            "if: always() && needs.intent.outputs.shouldRelease == 'true' && (needs.intent.outputs.channel != 'stable' || needs.stable-draft.result == 'success')",
            workflow,
        )
        self.assertIn(
            "if: always() && needs.intent.outputs.shouldRelease == 'true' && needs.upload-assets.result == 'success' && (needs.intent.outputs.channel != 'stable' || needs.stable-pages.result == 'success')",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
