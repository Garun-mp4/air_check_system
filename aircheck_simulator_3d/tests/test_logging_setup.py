import logging
from pathlib import Path

from aircheck_simulator_3d.app.config import LoggingConfig
from aircheck_simulator_3d.app.logging_setup import close_logging, configure_logging


def test_logging_creates_separate_rotating_files(tmp_path: Path) -> None:
    configure_logging(LoggingConfig(directory=tmp_path, level="INFO", max_bytes=1024, backup_count=1))
    try:
        logging.getLogger("aircheck.application").info("application marker")
        logging.getLogger("aircheck.simulation").info("simulation marker")
        logging.getLogger("aircheck.api").info("api marker")
        logging.getLogger("aircheck.networking.http").warning("network marker")
    finally:
        close_logging()

    expected = {
        "application.log": "application marker",
        "simulation.log": "simulation marker",
        "api.log": "api marker",
        "network.log": "network marker",
    }
    for filename, marker in expected.items():
        assert marker in (tmp_path / filename).read_text(encoding="utf-8")
