from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Sequence

from aircheck_simulator_3d.app.application import Application
from aircheck_simulator_3d.app.config import load_config
from aircheck_simulator_3d.app.logging_setup import close_logging, configure_logging


def _positive_seconds(value: str) -> float:
    try:
        seconds = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("must be a number") from exc
    if seconds <= 0:
        raise argparse.ArgumentTypeError("must be greater than zero")
    return seconds


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="AirCheck 3D digital-twin simulator")
    parser.add_argument(
        "--config-dir",
        type=Path,
        help="directory containing the simulator TOML configuration files",
    )
    parser.add_argument(
        "--smoke-test-seconds",
        type=_positive_seconds,
        help="open the Panda3D window and close it after this many seconds",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    logging_configured = False
    try:
        config = load_config(args.config_dir)
        configure_logging(config.logging)
        logging_configured = True
        logging.getLogger("aircheck.application").info("Starting AirCheck 3D Simulator")
        Application(config).run(smoke_test_seconds=args.smoke_test_seconds)
    except Exception as exc:
        logging.getLogger("aircheck.application").exception("Simulator startup failed: %s", exc)
        return 1
    finally:
        if logging_configured:
            close_logging()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
