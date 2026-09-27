"""Contract tests for AirCheck's Docker Compose deployment boundary.

These checks render Compose configuration only. They never start or stop a
container and do not need a running Docker Engine.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import pytest


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_FILE = REPOSITORY_ROOT / "docker-compose.yml"
ENV_EXAMPLE = REPOSITORY_ROOT / ".env.example"
TEST_PROJECT_NAME = "aircheck-infrastructure-contract-tests"
TEST_ENV_OVERRIDES = {
    "BETTER_AUTH_SECRET": "infra-test-auth-secret-not-a-credential",
    "DEVICE_API_TOKEN": "infra-test-device-token-not-a-credential",
    "SIMULATOR_INTERNAL_TOKEN": "infra-test-internal-token-not-a-credential",
}


def _read_env_assignments(path: Path = ENV_EXAMPLE) -> tuple[dict[str, str], list[str]]:
    """Read simple KEY=VALUE assignments while preserving duplicate names."""
    values: dict[str, str] = {}
    keys: list[str] = []
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"Invalid environment assignment at {path.name}:{line_number}")
        keys.append(key)
        values[key] = value
    return values, keys


class ComposeRunner:
    """Run read-only Compose config rendering with an isolated test project."""

    def __init__(self, docker_cli: str) -> None:
        self.docker_cli = docker_cli
        self._rendered: dict[tuple[str, ...], dict[str, Any]] = {}
        template_values, _ = _read_env_assignments()
        self.template_values = template_values

        # Prevent a developer's shell environment or local Compose settings
        # from changing the values this suite is intended to verify.
        compose_variables = set(template_values)
        compose_variables.update(
            re.findall(
                r"(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)(?:[^}]*)\}",
                COMPOSE_FILE.read_text(encoding="utf-8"),
            )
        )
        self.process_environment = os.environ.copy()
        for variable in compose_variables | {
            "COMPOSE_FILE",
            "COMPOSE_PROFILES",
            "COMPOSE_PROJECT_NAME",
        }:
            self.process_environment.pop(variable, None)

    def _write_env_file(self, path: Path, overrides: dict[str, str] | None = None) -> Path:
        values = dict(self.template_values)
        values.update(TEST_ENV_OVERRIDES)
        if overrides:
            values.update(overrides)
        path.write_text(
            "\n".join(f"{key}={value}" for key, value in values.items()) + "\n",
            encoding="utf-8",
        )
        return path

    def run(
        self,
        profiles: tuple[str, ...] = (),
        *,
        overrides: dict[str, str] | None = None,
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory(prefix="aircheck-compose-contract-") as temporary_directory:
            env_file = self._write_env_file(Path(temporary_directory) / "compose-test.env", overrides)
            command = [
                self.docker_cli,
                "compose",
                "--project-directory",
                str(REPOSITORY_ROOT),
                "--project-name",
                TEST_PROJECT_NAME,
                "--env-file",
                str(env_file),
                "--file",
                str(COMPOSE_FILE),
            ]
            for profile in profiles:
                command.extend(["--profile", profile])
            command.extend(["config", "--format", "json"])
            return subprocess.run(
                command,
                cwd=REPOSITORY_ROOT,
                env=self.process_environment,
                capture_output=True,
                text=True,
                check=False,
                timeout=30,
            )

    def config(self, *profiles: str) -> dict[str, Any]:
        cache_key = tuple(sorted(profiles))
        if cache_key not in self._rendered:
            result = self.run(cache_key)
            assert result.returncode == 0, (
                "Docker Compose could not render the configuration. "
                f"stderr: {result.stderr.strip()}"
            )
            self._rendered[cache_key] = json.loads(result.stdout)
        return self._rendered[cache_key]


@pytest.fixture(scope="session")
def docker_cli() -> str:
    executable = shutil.which("docker")
    if executable is None:
        pytest.skip("Docker Compose CLI is unavailable; Compose-specific checks were not run")
    result = subprocess.run(
        [executable, "compose", "version"],
        capture_output=True,
        text=True,
        check=False,
        timeout=10,
    )
    if result.returncode != 0:
        pytest.skip("Docker Compose plugin is unavailable; Compose-specific checks were not run")
    return executable


@pytest.fixture(scope="session")
def compose_runner(docker_cli: str) -> ComposeRunner:
    return ComposeRunner(docker_cli)


def _services(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return config["services"]


def _volume_mount(service: dict[str, Any], target: str) -> dict[str, Any]:
    matches = [mount for mount in service.get("volumes", []) if mount["target"] == target]
    assert len(matches) == 1, f"Expected exactly one mount at {target}"
    return matches[0]


def _port(service: dict[str, Any], target: int) -> dict[str, Any]:
    matches = [port for port in service.get("ports", []) if port["target"] == target]
    assert len(matches) == 1, f"Expected exactly one published port {target}"
    return matches[0]


def test_env_example_covers_every_compose_interpolation() -> None:
    template_values, _ = _read_env_assignments()
    compose_text = COMPOSE_FILE.read_text(encoding="utf-8")
    referenced_variables = set(
        re.findall(r"(?<!\$)\$\{([A-Za-z_][A-Za-z0-9_]*)(?:[^}]*)\}", compose_text)
    )
    assert referenced_variables <= set(template_values), (
        "Compose variables missing from .env.example: "
        f"{sorted(referenced_variables - set(template_values))}"
    )


def test_env_example_has_valid_unique_assignments() -> None:
    _, keys = _read_env_assignments()
    assert len(keys) == len(set(keys)), "Duplicate keys in .env.example make configuration ambiguous"


def test_env_example_does_not_contain_runtime_secrets() -> None:
    values, _ = _read_env_assignments()
    for key in ("BETTER_AUTH_SECRET", "DEVICE_API_TOKEN", "SIMULATOR_INTERNAL_TOKEN"):
        assert key in values
        assert values[key] == "", f"{key} must remain blank in the committed template"


def test_git_ignores_local_env_but_keeps_the_example_template() -> None:
    git = shutil.which("git")
    if git is None:
        pytest.skip("Git CLI is unavailable; .env ignore rules could not be checked")

    ignored_env = subprocess.run(
        [git, "check-ignore", "--quiet", "--no-index", ".env"],
        cwd=REPOSITORY_ROOT,
        check=False,
        timeout=10,
    )
    example_is_not_ignored = subprocess.run(
        [git, "check-ignore", "--quiet", "--no-index", ".env.example"],
        cwd=REPOSITORY_ROOT,
        check=False,
        timeout=10,
    )
    assert ignored_env.returncode == 0, "A local .env file must be ignored by Git"
    assert example_is_not_ignored.returncode == 1, ".env.example must remain trackable"


def test_default_compose_config_contains_only_core_services(compose_runner: ComposeRunner) -> None:
    services = set(_services(compose_runner.config()))
    assert services == {"postgres", "ml-service", "backend", "https-proxy"}


def test_compose_render_requires_better_auth_secret(compose_runner: ComposeRunner) -> None:
    result = compose_runner.run(overrides={"BETTER_AUTH_SECRET": ""})
    assert result.returncode != 0, "Compose must reject a missing Better Auth signing secret"
    assert "BETTER_AUTH_SECRET" in result.stderr


@pytest.mark.parametrize(
    ("profile", "expected_optional_service"),
    [
        ("demo", "simulator"),
        ("web-demo", "web-simulator"),
        ("maintenance", "owner-cli"),
    ],
)
def test_each_optional_profile_enables_only_its_service(
    compose_runner: ComposeRunner, profile: str, expected_optional_service: str
) -> None:
    services = set(_services(compose_runner.config(profile)))
    assert services == {
        "postgres",
        "ml-service",
        "backend",
        "https-proxy",
        expected_optional_service,
    }


def test_backend_waits_for_healthy_database_and_started_ml_service(
    compose_runner: ComposeRunner,
) -> None:
    backend = _services(compose_runner.config())["backend"]
    dependencies = backend["depends_on"]
    assert dependencies["postgres"]["condition"] == "service_healthy"
    assert dependencies["ml-service"]["condition"] == "service_started"


def test_both_simulators_wait_for_backend_and_share_device_lease(
    compose_runner: ComposeRunner,
) -> None:
    services = _services(compose_runner.config("demo", "web-demo"))
    legacy = services["simulator"]
    web = services["web-simulator"]
    assert legacy["depends_on"]["backend"]["condition"] == "service_started"
    assert web["depends_on"]["backend"]["condition"] == "service_started"
    assert legacy["environment"]["SIMULATOR_LOCK_DIRECTORY"] == "/var/run/aircheck-simulator"
    assert web["environment"]["SIMULATOR_LOCK_DIRECTORY"] == "/var/run/aircheck-simulator"
    assert _volume_mount(legacy, "/var/run/aircheck-simulator")["source"] == "simulator-lock"
    assert _volume_mount(web, "/var/run/aircheck-simulator")["source"] == "simulator-lock"
    assert legacy["environment"]["DEVICE_ID"] == web["environment"]["DEVICE_ID"]


def test_machine_and_internal_tokens_are_wired_to_separate_purposes(
    compose_runner: ComposeRunner,
) -> None:
    services = _services(compose_runner.config("demo", "web-demo"))
    backend_env = services["backend"]["environment"]
    legacy_env = services["simulator"]["environment"]
    web_env = services["web-simulator"]["environment"]
    assert backend_env["DEVICE_API_TOKEN"] == "infra-test-device-token-not-a-credential"
    assert legacy_env["DEVICE_API_TOKEN"] == backend_env["DEVICE_API_TOKEN"]
    assert web_env["DEVICE_API_TOKEN"] == backend_env["DEVICE_API_TOKEN"]
    assert backend_env["SIMULATOR_INTERNAL_TOKEN"] == "infra-test-internal-token-not-a-credential"
    assert web_env["SIMULATOR_INTERNAL_TOKEN"] == backend_env["SIMULATOR_INTERNAL_TOKEN"]
    assert backend_env["DEVICE_API_TOKEN"] != backend_env["SIMULATOR_INTERNAL_TOKEN"]


def test_database_and_ml_ports_are_bound_to_loopback(compose_runner: ComposeRunner) -> None:
    services = _services(compose_runner.config())
    assert _port(services["postgres"], 5432)["host_ip"] == "127.0.0.1"
    assert _port(services["ml-service"], 8000)["host_ip"] == "127.0.0.1"


def test_backend_port_is_configurable_and_bound_to_loopback(compose_runner: ComposeRunner) -> None:
    backend = _services(compose_runner.config())["backend"]
    assert _port(backend, 3000)["host_ip"] == "127.0.0.1"


def test_caddy_is_only_publicly_published_service(compose_runner: ComposeRunner) -> None:
    services = _services(compose_runner.config("demo", "web-demo", "maintenance"))
    proxy_ports = services["https-proxy"].get("ports", [])
    assert {port["target"] for port in proxy_ports} == {80, 443}
    assert all("host_ip" not in port or port["host_ip"] != "127.0.0.1" for port in proxy_ports)

    for name, service in services.items():
        if name == "https-proxy":
            continue
        assert all(port["host_ip"] == "127.0.0.1" for port in service.get("ports", [])), (
            f"{name} must not publish a LAN-facing port"
        )


def test_python_simulators_do_not_publish_direct_http_ports(compose_runner: ComposeRunner) -> None:
    services = _services(compose_runner.config("demo", "web-demo"))
    assert services["simulator"].get("ports", []) == []
    assert services["web-simulator"].get("ports", []) == []


def test_postgres_healthcheck_and_read_only_migration_mount(compose_runner: ComposeRunner) -> None:
    postgres = _services(compose_runner.config())["postgres"]
    healthcheck = postgres["healthcheck"]
    assert "pg_isready" in " ".join(healthcheck["test"])
    assert healthcheck["interval"] == "5s"
    assert healthcheck["timeout"] == "5s"
    assert healthcheck["retries"] == 12
    assert _volume_mount(postgres, "/docker-entrypoint-initdb.d")["read_only"] is True


def test_web_simulator_has_local_healthcheck(compose_runner: ComposeRunner) -> None:
    web = _services(compose_runner.config("web-demo"))["web-simulator"]
    healthcheck = web["healthcheck"]
    assert "http://127.0.0.1:8090/healthz" in " ".join(healthcheck["test"])
    assert healthcheck["interval"] == "10s"
    assert healthcheck["timeout"] == "3s"
    assert healthcheck["retries"] == 5


def test_owner_cli_uses_the_maintenance_profile_and_healthy_database(
    compose_runner: ComposeRunner,
) -> None:
    services = _services(compose_runner.config("maintenance"))
    owner_cli = services["owner-cli"]
    assert owner_cli["build"]["target"] == "owner-tools"
    assert owner_cli["depends_on"]["postgres"]["condition"] == "service_healthy"


def test_named_volumes_cover_database_model_tls_and_simulator_lease(
    compose_runner: ComposeRunner,
) -> None:
    config = compose_runner.config("demo", "web-demo")
    assert {
        "postgres-data",
        "ml-model",
        "caddy-data",
        "caddy-config",
        "simulator-lock",
    } <= set(config["volumes"])
    services = _services(config)
    assert _volume_mount(services["postgres"], "/var/lib/postgresql/data")["source"] == "postgres-data"
    assert _volume_mount(services["ml-service"], "/app/model")["source"] == "ml-model"
    assert _volume_mount(services["https-proxy"], "/data")["source"] == "caddy-data"
    assert _volume_mount(services["https-proxy"], "/config")["source"] == "caddy-config"


def test_caddyfile_is_read_only_and_caddy_data_is_persistent(compose_runner: ComposeRunner) -> None:
    proxy = _services(compose_runner.config())["https-proxy"]
    caddyfile = _volume_mount(proxy, "/etc/caddy/Caddyfile")
    assert caddyfile["read_only"] is True
    assert Path(caddyfile["source"]).resolve() == (REPOSITORY_ROOT / "deploy" / "Caddyfile").resolve()


def test_caddy_routes_the_configured_host_over_internal_tls_to_backend() -> None:
    caddyfile = (REPOSITORY_ROOT / "deploy" / "Caddyfile").read_text(encoding="utf-8")
    assert "{$AIR_CHECK_DOMAIN:aircheck.home.arpa}" in caddyfile
    assert "tls internal" in caddyfile
    assert "reverse_proxy backend:{$PORT:3000}" in caddyfile


def test_all_compose_build_contexts_and_dockerfiles_exist(compose_runner: ComposeRunner) -> None:
    services = _services(compose_runner.config("demo", "web-demo", "maintenance"))
    build_services = {name: service for name, service in services.items() if "build" in service}
    assert set(build_services) == {
        "backend",
        "ml-service",
        "simulator",
        "web-simulator",
        "owner-cli",
    }
    for name, service in build_services.items():
        build = service["build"]
        context = Path(build["context"])
        dockerfile = context / build.get("dockerfile", "Dockerfile")
        assert context.is_dir(), f"{name} build context does not exist"
        assert dockerfile.is_file(), f"{name} Dockerfile does not exist"
