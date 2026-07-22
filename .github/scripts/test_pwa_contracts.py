import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
VITE_CONFIG = ROOT / "web" / "vite.config.ts"


class PwaContractTest(unittest.TestCase):
    def test_flash_workbench_is_a_first_class_pwa_page(self) -> None:
        config = VITE_CONFIG.read_text(encoding="utf-8")
        package_json = (ROOT / "web" / "package.json").read_text(encoding="utf-8")
        shell_script = (
            ROOT / "web" / "scripts" / "copy-spa-shells.ts"
        ).read_text(encoding="utf-8")

        self.assertIn('name: "Firmware flash"', config)
        self.assertIn('url: "flash/"', config)
        self.assertIn('"pwa/flash-wide.png"', config)
        self.assertIn("navigateFallback: `${base}index.html`", config)
        self.assertIn("copy-spa-shells.ts", package_json)
        self.assertIn('new URL("flash/index.html", distPath)', shell_script)

    def test_firmware_metadata_is_precached_without_large_images(self) -> None:
        config = VITE_CONFIG.read_text(encoding="utf-8")

        self.assertIn("**/*.{js,css,html,ico,png,svg,webmanifest,json}", config)
        self.assertNotIn('"**/firmware/**/*"', config)
        self.assertIn('"**/firmware/**/*.bin"', config)
        self.assertIn('"**/firmware/**/*.elf"', config)


if __name__ == "__main__":
    unittest.main()
