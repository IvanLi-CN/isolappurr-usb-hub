import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CANONICAL_REPO_URL = "https://github.com/IvanLi-CN/isolappurr-usb-hub"
WORKFLOW_DOC = "docs/maintainer-workflow.md"
USER_SKILL = "skills/isolapurr-user-operations/SKILL.md"
MAINTAINER_SKILL = "skills/isolapurr-maintainer-workflow/SKILL.md"

BANNED_LEGACY_PATTERNS = [
    ("status --hardware", re.compile(r"status --hardware(?=$|[^-A-Za-z0-9_])")),
    ("status --device", re.compile(r"status --device(?=$|[^-A-Za-z0-9_])")),
    ("hardware save --id", re.compile(r"hardware save --id(?=$|[^-A-Za-z0-9_])")),
    (
        "hardware save --transport",
        re.compile(r"hardware save --transport(?=$|[^-A-Za-z0-9_])"),
    ),
]

AD_HOC_DEMO_ROUTE_PATTERNS = [
    re.compile(r"/demo/"),
    re.compile(r'path\s*=\s*"demo"'),
    re.compile(r'path\s*=\s*"/demo"'),
    re.compile(r"path\s*=\s*\{[^}]*demo[^}]*\}"),
    re.compile(r"demo="),
    re.compile(r'searchParams\.(get|has)\(\s*["\']demo["\']\s*\)'),
]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class SkillContractTest(unittest.TestCase):
    def test_release_url_is_consistent(self) -> None:
        skill = read(USER_SKILL)
        readme = read("README.md")
        installer_sh = read("tools/isolapurr-host/install/install-isolapurr-host.sh")
        installer_ps1 = read("tools/isolapurr-host/install/install-isolapurr-host.ps1")

        self.assertIn(CANONICAL_REPO_URL, skill)
        self.assertIn(CANONICAL_REPO_URL, readme)
        self.assertRegex(
            installer_sh,
            re.compile(rf'^REPO_URL="{re.escape(CANONICAL_REPO_URL)}"$', re.MULTILINE),
        )
        self.assertRegex(
            installer_ps1,
            re.compile(rf'^\$RepoUrl = "{re.escape(CANONICAL_REPO_URL)}"$', re.MULTILINE),
        )

    def test_user_skill_stops_at_missing_tools_install_gate(self) -> None:
        skill = read(USER_SKILL)

        required_fragments = [
            "If either command is absent, this is an install gate",
            "stop before hardware listing, scanning, status, provisioning, flashing, reset, monitor, or diagnostics",
            "Do not list system USB or serial ports as a substitute result",
            "If the chosen GitHub Release or installer asset is unavailable",
            "Do not fall back to raw USB/serial enumeration",
        ]
        for fragment in required_fragments:
            self.assertIn(fragment, skill)

    def test_repo_managed_docs_do_not_reintroduce_legacy_cli_forms(self) -> None:
        checked_files = [
            "README.md",
            "AGENTS.md",
            WORKFLOW_DOC,
            USER_SKILL,
            MAINTAINER_SKILL,
        ]
        for path in checked_files:
            content = read(path)
            for label, pattern in BANNED_LEGACY_PATTERNS:
                self.assertIsNone(
                    pattern.search(content),
                    msg=f"{path} reintroduced {label}",
                )

    def test_workflow_entry_links_are_consistent(self) -> None:
        readme = read("README.md")
        agents = read("AGENTS.md")
        workflow = read(WORKFLOW_DOC)
        maintainer_skill = read(MAINTAINER_SKILL)

        required_links = [
            "docs/maintainer-workflow.md",
            "skills/isolapurr-user-operations/SKILL.md",
            "skills/isolapurr-developer-operations/SKILL.md",
            "skills/isolapurr-maintainer-workflow/SKILL.md",
        ]
        for link in required_links:
            self.assertIn(link, readme)
            self.assertIn(link, agents)
            self.assertIn(link, workflow)
        self.assertIn("docs/specs/r7m2q-cli-devd-alignment/SPEC.md", workflow)
        self.assertIn("deprecated released selector variants", maintainer_skill)

    def test_repo_contracts_workflow_watches_all_truth_sources(self) -> None:
        workflow = read(".github/workflows/repo-contracts.yml")
        required_paths = [
            "AGENTS.md",
            "README.md",
            "web/README.md",
            "docs/maintainer-workflow.md",
            "docs/specs/kvbq9-web-demo-surface-policy/**",
            "docs/specs/r7m2q-cli-devd-alignment/**",
            "skills/isolapurr-user-operations/**",
            "skills/isolapurr-developer-operations/**",
            "skills/isolapurr-maintainer-workflow/**",
            "tools/isolapurr-host/src/bin/isolapurr/**",
            "web/src/App.tsx",
            "web/src/pages/**",
        ]
        for path in required_paths:
            self.assertIn(path, workflow)

    def test_user_skill_uses_current_released_surface_examples(self) -> None:
        skill = read(USER_SKILL)
        required_fragments = [
            "isolapurr status --device-id <device-id>",
            "isolapurr status --url http://<host-or-ip>",
            "isolapurr hardware save --device-id <device-id> --name <name> --port-path <port-path>",
            "isolapurr power show --device-id <device-id>",
            "isolapurr diagnostics export --device-id <device-id>",
            "isolapurr settings reset other --device-id <device-id> --yes",
        ]
        for fragment in required_fragments:
            self.assertIn(fragment, skill)

    def test_web_demo_surface_policy_links_are_present(self) -> None:
        readme = read("README.md")
        web_readme = read("web/README.md")
        agents = read("AGENTS.md")
        workflow = read(WORKFLOW_DOC)
        policy_path = "docs/specs/kvbq9-web-demo-surface-policy/SPEC.md"

        self.assertIn(policy_path, readme)
        self.assertIn("kvbq9-web-demo-surface-policy/SPEC.md", web_readme)
        self.assertIn(policy_path, agents)
        self.assertIn(policy_path, workflow)

    def test_page_level_storybook_stories_are_not_present(self) -> None:
        for path in ROOT.glob("web/src/pages/*.stories.*"):
            self.fail(f"page-level Storybook story is forbidden: {path}")

    def test_app_router_does_not_add_ad_hoc_demo_entrypoints(self) -> None:
        app = read("web/src/App.tsx")
        for pattern in AD_HOC_DEMO_ROUTE_PATTERNS:
            self.assertIsNone(
                pattern.search(app),
                msg=f"web/src/App.tsx reintroduced ad hoc demo entrypoint: {pattern.pattern}",
            )


if __name__ == "__main__":
    unittest.main()
