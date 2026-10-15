"""Resource conflicts must fail before firmware reaches a board."""
import json
from pathlib import Path


def test_single_wroom_controller_has_no_pin_conflicts():
    root = Path(__file__).resolve().parents[2]
    config = json.loads((root / "config/hardware.json").read_text(encoding="utf-8"))
    assert config["controllers"] == 1
    pins = list(config["outputs"].values()) + list(config["inputs"].values())
    pins += [config["sensor_bus"][name] for name in ("sda", "scl")]
    pins += [sensor[name] for sensor in config["sensors"] for name in ("rx", "tx") if name in sensor]
    pins += [config["sd"][name] for name in ("sck", "miso", "mosi", "cs")]
    assert len(pins) == len(set(pins))
    assert not set(pins) & {0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 15}
    assert not set(config["outputs"].values()) & set(range(34, 40))
    sensor_config = root / "aircheck_simulator_3d/config/devices.toml"
    import tomllib
    virtual = tomllib.loads(sensor_config.read_text(encoding="utf-8"))
    assert {sensor["id"] for sensor in config["sensors"]} == set(virtual["sensors"])
