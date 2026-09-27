from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

from conftest import ROOT, IsolatedPostgres


PROBE = Path(__file__).with_name("repository_probe.mjs")
PG_PACKAGE = ROOT / "frontend" / "node_modules" / "pg" / "package.json"


@pytest.fixture
def repository_db(postgres_db: IsolatedPostgres) -> IsolatedPostgres:
    """Give each repository test a clean schema while reusing only this temporary DB."""
    postgres_db.psql(
        'TRUNCATE TABLE measurements, predictions, recommendations, actuator_commands, '
        'actuator_states, node_settings, aircheck_access_audit, aircheck_access_roles, '
        '"session", "account", verification, "user" RESTART IDENTITY CASCADE;'
    )
    if shutil.which("node") is None:
        pytest.skip("Node.js is required to exercise the TypeScript PostgresRepository")
    if not PG_PACKAGE.is_file():
        pytest.skip("frontend dependencies are absent; run npm ci in frontend/ before DB repository tests")
    return postgres_db


def _run_repository_probe(database: IsolatedPostgres, scenario: str) -> None:
    node = shutil.which("node")
    assert node is not None
    env = os.environ.copy()
    env["DATABASE_URL"] = database.database_url
    env["NODE_NO_WARNINGS"] = "1"
    result = subprocess.run(
        [node, "--experimental-strip-types", str(PROBE), scenario],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )
    assert result.returncode == 0, (
        f"Repository scenario {scenario!r} failed with exit code {result.returncode}.\n"
        f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    )
    assert f"{scenario}: passed" in result.stdout


def test_postgres_repository_measurement_round_trip_history_bounds_and_ordering(
    repository_db: IsolatedPostgres,
) -> None:
    _run_repository_probe(repository_db, "measurement-history")


def test_postgres_repository_prediction_and_recommendation_latest_reads(
    repository_db: IsolatedPostgres,
) -> None:
    _run_repository_probe(repository_db, "read-models")


def test_postgres_repository_settings_defaults_persistence_and_node_isolation(
    repository_db: IsolatedPostgres,
) -> None:
    _run_repository_probe(repository_db, "settings")


def test_postgres_repository_retention_preserves_boundaries_pending_commands_and_state(
    repository_db: IsolatedPostgres,
) -> None:
    _run_repository_probe(repository_db, "retention")


def test_postgres_repository_retention_cleanup_rolls_back_as_one_transaction(
    repository_db: IsolatedPostgres,
) -> None:
    _run_repository_probe(repository_db, "retention-rollback")


def test_postgres_repository_command_report_and_cleanup_are_transactional(
    repository_db: IsolatedPostgres,
) -> None:
    _run_repository_probe(repository_db, "transactions")


def test_postgres_repository_concurrent_measurement_writes_persist_all_rows(
    repository_db: IsolatedPostgres,
) -> None:
    _run_repository_probe(repository_db, "concurrent-writes")


def test_postgres_repository_concurrent_identical_commands_are_deduplicated(
    repository_db: IsolatedPostgres,
) -> None:
    _run_repository_probe(repository_db, "concurrent-command-deduplication")
