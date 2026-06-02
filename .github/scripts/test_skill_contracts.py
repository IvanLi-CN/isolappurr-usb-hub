import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CANONICAL_REPO_URL = "https://github.com/IvanLi-CN/isolappurr-usb-hub"


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class SkillContractTest(unittest.TestCase):
    def test_release_url_is_consistent(self) -> None:
        skill = read("skills/isolapurr-user-operations/SKILL.md")
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
        skill = read("skills/isolapurr-user-operations/SKILL.md")

        required_fragments = [
            "If either command is absent, this is an install gate",
            "stop before hardware listing, scanning, status, provisioning, flashing, reset, monitor, or diagnostics",
            "Do not list system USB or serial ports as a substitute result",
            "If the chosen GitHub Release or installer asset is unavailable",
            "Do not fall back to raw USB/serial enumeration",
        ]
        for fragment in required_fragments:
            self.assertIn(fragment, skill)


if __name__ == "__main__":
    unittest.main()
