import json
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
NETLIST = ROOT / "hardware" / "tps-husb" / "netlist.enet"


class TpsHusbPowerContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        netlist = json.loads(NETLIST.read_text(encoding="utf-8"))
        cls.components = {
            component["props"]["Designator"]: component
            for component in netlist["components"].values()
        }

    def check_pins(self, designator: str, expected: dict[str, str]) -> None:
        pins = self.components[designator]["pinInfoMap"]
        for number, net in expected.items():
            self.assertEqual(pins[number]["net"], net, f"{designator} pin {number}")

    def test_pd_roles_and_tps_settings(self) -> None:
        self.assertEqual(
            self.components["U10"]["props"]["Manufacturer Part"], "HUSB311BLA"
        )
        self.assertEqual(
            self.components["U11"]["props"]["Manufacturer Part"], "FUSB302BMPX"
        )
        self.check_pins("U10", {"2": "PDIN", "5": "INT2", "6": "SCL2", "7": "SDA2"})
        self.check_pins("U11", {"2": "VBUS_TPS", "5": "INT", "6": "SCL", "7": "SDA"})
        self.check_pins("R28", {"1": "TPS_EN", "2": "VSYS"})
        self.check_pins("R30", {"1": "TPS_EN", "2": "AGND_TPS"})
        self.assertEqual(self.components["R28"]["props"]["Value"], "200kΩ")
        self.assertEqual(self.components["R30"]["props"]["Value"], "36kΩ")

    def test_input_paths_and_dc_control(self) -> None:
        for designator in ("U20", "U25"):
            self.assertEqual(
                self.components[designator]["props"]["Manufacturer Part"],
                "LM74800QDRRRQ1",
            )
        self.check_pins(
            "U20",
            {"2": "DCIN", "3": "DCIN", "6": "DC_UVLO", "9": "VSYS", "10": "DCVS", "12": "DCVS"},
        )
        self.check_pins(
            "U25",
            {"2": "PDIN", "3": "VSYS", "4": "VSYS", "5": "GND", "6": "PD_EN", "8": "", "9": "VSYS", "10": "VSYS", "12": "VSYS"},
        )
        self.check_pins("Q2", {"1": "DCIN", "4": "DGATE", "5": "DCVS"})
        self.check_pins("Q3", {"1": "VSYS", "4": "HGATE", "5": "DCVS"})
        self.check_pins("Q10", {"1": "PDIN", "4": "PDIN_GATE", "5": "VSYS"})
        self.check_pins("Q5", {"1": "GND", "2": "DC_CE", "6": "DC_UVLO"})
        self.check_pins("R4", {"1": "PD_EN", "2": "PDIN"})
        self.assertEqual(self.components["R4"]["props"]["Value"], "100K")

    def test_reset_bias_and_debug_header(self) -> None:
        self.assertEqual(self.components["RN4"]["props"]["Value"], "100kΩ")
        self.assertEqual(self.components["RN4"]["props"]["Tolerance"], "±1%")
        self.check_pins(
            "RN4",
            {"1": "", "2": "DC_CE", "3": "TPS_USB_C_VBUS_EN", "4": "CE_TPS", "5": "3V3", "6": "GND", "7": "GND", "8": "GND"},
        )
        self.check_pins("U19", {"40": "DC_CE", "41": "TPS_USB_C_VBUS_EN", "42": "CE_TPS"})
        self.check_pins(
            "U15",
            {"1": "GND", "2": "U0TX", "3": "U0RX", "4": "BOOT0", "5": "CHIP_EN", "6": "GND", "7": "GND"},
        )

    def test_variant_navigation(self) -> None:
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        variants = (ROOT / "docs" / "hardware-variants.md").read_text(encoding="utf-8")
        self.assertIn("(docs/mcu-resource-allocation-tps-husb.md)", readme)
        self.assertIn("(docs/tps-husb-input-power-path-selection.md)", readme)
        self.assertIn("hardware/tps-husb/netlist.enet", readme)
        self.assertIn("## `tps-sw` 固件相关网表变化", variants)
        self.assertIn("TPS55288` 出现在多个 variant", variants)


if __name__ == "__main__":
    unittest.main()
