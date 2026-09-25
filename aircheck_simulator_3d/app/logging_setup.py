from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler

from .config import LoggingConfig


LOGGER_NAMES = (
    "aircheck.application",
    "aircheck.simulation",
    "aircheck.api",
)


def configure_logging(config: LoggingConfig) -> None:
    config.directory.mkdir(parents=True, exist_ok=True)
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    for logger_name, filename in zip(LOGGER_NAMES, ("application.log", "simulation.log", "api.log"), strict=True):
        logger = logging.getLogger(logger_name)
        logger.setLevel(config.level.upper())
        logger.propagate = False
        for handler in logger.handlers[:]:
            logger.removeHandler(handler)
            handler.close()
        handler = RotatingFileHandler(
            config.directory / filename,
            maxBytes=config.max_bytes,
            backupCount=config.backup_count,
            encoding="utf-8",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)


def close_logging() -> None:
    for logger_name in LOGGER_NAMES:
        logger = logging.getLogger(logger_name)
        for handler in logger.handlers[:]:
            logger.removeHandler(handler)
            handler.close()
