"""Export the static geometry only, without starting a simulator or network."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from aircheck_simulator_3d.app.config import DEFAULT_CONFIG_DIR, load_config
from aircheck_simulator_3d.app.scene_reference import scene_reference


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    output = ROOT / 'frontend/src/lib/stand-reference.json'
    expected = json.dumps(scene_reference(load_config(DEFAULT_CONFIG_DIR, {})), ensure_ascii=False, indent=2) + '\n'
    if args.check:
        if not output.exists() or output.read_text(encoding='utf-8') != expected:
            raise SystemExit('stand-reference.json is stale; run scripts/export_stand_reference.py')
    else:
        output.write_text(expected, encoding='utf-8')


if __name__ == '__main__':
    main()
