"""Build from an ASCII path: ESP-IDF rejects the user's workspace with spaces.

The original sources remain authoritative. Secrets are copied only to a temporary
local directory, removed on exit; only compiled artifacts are copied back.
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", choices=("esp32", "fake"), default="esp32")
    parser.add_argument('--edge-model', type=Path, help='Qualified real edge-model.json; excluded when not supplied')
    parser.add_argument('--jobs', type=int, default=2, help='Bound compiler concurrency on memory-constrained hosts')
    args = parser.parse_args()
    if not 1 <= args.jobs <= 16: parser.error('--jobs must be from 1 to 16')
    root = Path(__file__).resolve().parent
    # System TEMP may itself contain spaces; pick an explicit short path on Windows.
    default_base = Path(root.anchor) / "acbuild" if os.name == "nt" else Path(tempfile.gettempdir()) / "aircheck-build"
    base = Path(os.environ.get("AIRCHECK_BUILD_ROOT", str(default_base)))
    base.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="fw-", dir=base) as temp:
        staged = Path(temp) / "node"
        shutil.copytree(root, staged, ignore=shutil.ignore_patterns(".pio", "sdkconfig", "__pycache__"))
        if args.edge_model:
            from prepare_model import prepare
            checksum=prepare(args.edge_model, staged/'include/edge_model.hpp')
        result = subprocess.run([sys.executable, "-m", "platformio", "run", "-j", str(args.jobs), "-d", str(staged), "-e", args.env], check=False)
        if result.returncode:
            return result.returncode
        output = root / ".pio" / "staged" / (args.env + ('-edge-' + checksum[:12] if args.edge_model else ''))
        output.mkdir(parents=True, exist_ok=True)
        for filename in ("firmware.bin", "firmware.elf", "bootloader.bin", "partitions.bin"):
            shutil.copy2(staged / ".pio/build" / args.env / filename, output / filename)
        print(f"Verified build artifacts: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
