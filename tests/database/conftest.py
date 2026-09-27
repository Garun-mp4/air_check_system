from __future__ import annotations

import json
import secrets
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence
from urllib.parse import quote

import pytest


ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "database" / "migrations"
POSTGRES_IMAGE = "postgres:16-alpine"
LABEL_KEY = "org.aircheck.test-scope"


@dataclass(frozen=True)
class IsolatedPostgres:
    container_name: str
    container_id: str
    label_value: str
    database_url: str = field(repr=False)
    database_user: str
    database_name: str

    def docker(self, args: Sequence[str], *, input_text: str | None = None) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["docker", *args],
            input=input_text,
            capture_output=True,
            text=True,
            check=False,
            timeout=30,
        )

    def psql(self, sql: str, *, check: bool = True) -> subprocess.CompletedProcess[str]:
        result = self.docker(
            [
                "exec",
                "-i",
                self.container_name,
                "psql",
                "-X",
                "-q",
                "-A",
                "-t",
                "-h",
                "127.0.0.1",
                "-p",
                "5432",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                self.database_user,
                "-d",
                self.database_name,
            ],
            input_text=sql,
        )
        if check and result.returncode != 0:
            raise AssertionError(
                f"psql failed with exit code {result.returncode}:\n"
                f"{result.stderr}\nSQL:\n{sql}"
            )
        return result


def _docker(args: Sequence[str], *, timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["docker", *args],
        capture_output=True,
        text=True,
        check=False,
        timeout=timeout,
    )


def _inspect_container(name: str) -> dict[str, object] | None:
    result = _docker(["inspect", name])
    if result.returncode != 0:
        return None
    inspected = json.loads(result.stdout)
    return inspected[0]


def _assert_owned_container(
    inspected: dict[str, object],
    *,
    container_id: str,
    name: str,
    label_value: str,
) -> None:
    config = inspected["Config"]
    assert isinstance(config, dict)
    labels = config.get("Labels")
    assert isinstance(labels, dict)
    assert inspected["Id"] == container_id
    assert inspected["Name"] == f"/{name}"
    assert labels.get(LABEL_KEY) == label_value


@pytest.fixture(scope="session")
def postgres_db() -> IsolatedPostgres:
    """Run the actual SQL migrations against a fresh, disposable PostgreSQL 16."""
    try:
        docker_info = _docker(["version", "--format", "{{.Server.Version}}"], timeout=10)
    except (FileNotFoundError, subprocess.TimeoutExpired) as error:
        pytest.skip(f"Docker Engine is unavailable: {error}")
    if docker_info.returncode != 0 or not docker_info.stdout.strip():
        pytest.skip(f"Docker Engine is unavailable: {docker_info.stderr.strip()}")

    image = _docker(["image", "inspect", POSTGRES_IMAGE], timeout=10)
    if image.returncode != 0:
        pulled = _docker(["pull", POSTGRES_IMAGE], timeout=180)
        if pulled.returncode != 0:
            pytest.skip(f"Could not obtain {POSTGRES_IMAGE}: {pulled.stderr.strip()}")

    suffix = uuid.uuid4().hex[:12]
    name = f"aircheck-db-test-{suffix}"
    label_value = f"pytest-{suffix}"
    database_user = "aircheck_test"
    database_name = "aircheck_test"
    password = secrets.token_hex(24)

    existing = _docker(
        ["ps", "-a", "--filter", f"name=^/{name}$", "--format", "{{.ID}}"],
        timeout=10,
    )
    if existing.returncode != 0:
        pytest.skip(f"Could not inspect Docker containers: {existing.stderr.strip()}")
    assert not existing.stdout.strip(), f"Refusing to reuse existing container {name}"

    started = _docker(
        [
            "run",
            "--detach",
            "--rm",
            "--name",
            name,
            "--label",
            f"{LABEL_KEY}={label_value}",
            "--tmpfs",
            "/var/lib/postgresql/data:rw,nosuid,nodev,size=512m",
            "--publish",
            "127.0.0.1::5432",
            "--env",
            f"POSTGRES_USER={database_user}",
            "--env",
            f"POSTGRES_DB={database_name}",
            "--env",
            f"POSTGRES_PASSWORD={password}",
            POSTGRES_IMAGE,
        ],
        timeout=45,
    )
    if started.returncode != 0:
        pytest.fail(f"Could not start isolated PostgreSQL: {started.stderr.strip()}")
    container_id = started.stdout.strip()
    database: IsolatedPostgres | None = None
    try:
        inspected = _inspect_container(name)
        assert inspected is not None, "The newly created PostgreSQL container disappeared"
        _assert_owned_container(
            inspected,
            container_id=container_id,
            name=name,
            label_value=label_value,
        )
        host_config = inspected.get("HostConfig")
        assert isinstance(host_config, dict)
        tmpfs = host_config.get("Tmpfs")
        assert isinstance(tmpfs, dict)
        assert "/var/lib/postgresql/data" in tmpfs
        mounts = inspected.get("Mounts")
        assert isinstance(mounts, list)
        assert mounts == [], "The test database must not use a Docker volume or host bind mount"

        port_result = _docker(["port", name, "5432/tcp"], timeout=10)
        if port_result.returncode != 0:
            pytest.fail(f"Could not resolve temporary PostgreSQL port: {port_result.stderr.strip()}")
        host_port = port_result.stdout.strip().rsplit(":", maxsplit=1)[-1]
        assert host_port.isdigit(), f"Unexpected Docker port mapping: {port_result.stdout!r}"

        database = IsolatedPostgres(
            container_name=name,
            container_id=container_id,
            label_value=label_value,
            database_url=(
                f"postgresql://{database_user}:{quote(password)}@127.0.0.1:"
                f"{host_port}/{database_name}"
            ),
            database_user=database_user,
            database_name=database_name,
        )

        ready = False
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            check = database.docker(
                [
                    "exec",
                    name,
                    "pg_isready",
                    "-h",
                    "127.0.0.1",
                    "-p",
                    "5432",
                    "-U",
                    database_user,
                    "-d",
                    database_name,
                ],
                input_text=None,
            )
            if check.returncode == 0:
                ready = True
                break
            time.sleep(0.25)
        if not ready:
            logs = _docker(["logs", name], timeout=10)
            pytest.fail(f"PostgreSQL did not become ready:\n{logs.stdout}\n{logs.stderr}")

        migrations = sorted(MIGRATIONS.glob("*.sql"))
        assert migrations, f"No migrations found in {MIGRATIONS}"
        for migration in migrations:
            applied = database.psql(migration.read_text(encoding="utf-8"))
            assert applied.returncode == 0

        version = database.psql("SHOW server_version_num;").stdout.strip()
        assert version.startswith("16"), f"Expected PostgreSQL 16, got server_version_num={version}"
        yield database
    finally:
        inspected = _inspect_container(name)
        if inspected is not None:
            _assert_owned_container(
                inspected,
                container_id=container_id,
                name=name,
                label_value=label_value,
            )
            stopped = _docker(["stop", "--time", "10", name], timeout=20)
            if stopped.returncode != 0:
                remaining = _inspect_container(name)
                if remaining is not None:
                    _assert_owned_container(
                        remaining,
                        container_id=container_id,
                        name=name,
                        label_value=label_value,
                    )
                    removed = _docker(["rm", "--force", container_id], timeout=20)
                    if removed.returncode != 0:
                        raise RuntimeError(
                            f"Could not clean up only the owned temporary container {name}: "
                            f"{removed.stderr.strip()}"
                        )
