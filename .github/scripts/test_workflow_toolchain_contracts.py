import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKFLOWS = [
    ROOT / ".github" / "workflows" / "firmware.yml",
    ROOT / ".github" / "workflows" / "release.yml",
]


def install_espflash_bodies(workflow_text: str) -> list[str]:
    lines = workflow_text.splitlines()
    bodies: list[str] = []
    i = 0
    while i < len(lines):
        if lines[i].strip() == "- name: Install espflash":
            i += 1
            body: list[str] = []
            while i < len(lines) and not lines[i].startswith("      - name:"):
                body.append(lines[i])
                i += 1
            bodies.append("\n".join(body))
            continue
        i += 1
    return bodies


class WorkflowToolchainContractTest(unittest.TestCase):
    def test_install_espflash_steps_pin_stable_host_rustc(self) -> None:
        expected_host = 'host="$(rustc +stable -vV | sed -n \'s/^host: //p\')"'
        expected_cargo = 'cargo +stable install espflash --locked --target "$host"'

        for workflow_path in WORKFLOWS:
            bodies = install_espflash_bodies(workflow_path.read_text(encoding="utf-8"))
            self.assertGreater(
                len(bodies),
                0,
                msg=f"missing Install espflash step in {workflow_path}",
            )
            for body in bodies:
                self.assertIn(expected_host, body, msg=f"{workflow_path} must pin rustc to stable")
                self.assertIn(
                    expected_cargo,
                    body,
                    msg=f"{workflow_path} must install espflash with a resolved host target",
                )


if __name__ == "__main__":
    unittest.main()
