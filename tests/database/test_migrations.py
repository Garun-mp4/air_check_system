from __future__ import annotations

import json
from pathlib import Path

import pytest

from conftest import MIGRATIONS, IsolatedPostgres


MEASUREMENT_FIELDS = (
    "indoor_co2",
    "indoor_temperature",
    "indoor_humidity",
    "indoor_pm25",
    "outdoor_temperature",
    "outdoor_humidity",
    "outdoor_pm25",
)


def _measurement_insert(overrides: dict[str, str] | None = None) -> str:
    values = {
        "indoor_co2": "650",
        "indoor_temperature": "23",
        "indoor_humidity": "45",
        "indoor_pm25": "5",
        "outdoor_temperature": "18",
        "outdoor_humidity": "60",
        "outdoor_pm25": "8",
    }
    values.update(overrides or {})
    columns = ["\"timestamp\"", *MEASUREMENT_FIELDS, "window_open"]
    literal_values = ["TIMESTAMPTZ '2026-01-01 00:00:00+00'", *(values[field] for field in MEASUREMENT_FIELDS), "FALSE"]
    return (
        f"INSERT INTO measurements ({', '.join(columns)}) "
        f"VALUES ({', '.join(literal_values)});"
    )


def _expect_sql_rejection(db: IsolatedPostgres, sql: str, expected: str) -> None:
    result = db.psql(sql, check=False)
    assert result.returncode != 0, f"Expected PostgreSQL to reject statement:\n{sql}"
    assert expected.lower() in result.stderr.lower(), result.stderr


def test_migration_files_are_ordered_and_complete() -> None:
    migration_names = [path.name for path in sorted(MIGRATIONS.glob("*.sql"))]
    assert migration_names == [
        "001_init.sql",
        "002_controls.sql",
        "003_retention_indexes.sql",
        "004_node_settings.sql",
        "005_auth.sql",
    ]


def test_all_migrations_run_twice_without_losing_existing_rows(postgres_db: IsolatedPostgres) -> None:
    marker = "2098-01-01 00:00:00+00"
    postgres_db.psql(_measurement_insert().replace("2026-01-01 00:00:00+00", marker))
    before = postgres_db.psql(
        "SELECT count(*) FROM measurements WHERE \"timestamp\" = TIMESTAMPTZ '2098-01-01 00:00:00+00';"
    ).stdout.strip()

    for migration in sorted(MIGRATIONS.glob("*.sql")):
        postgres_db.psql(migration.read_text(encoding="utf-8"))

    after = postgres_db.psql(
        "SELECT count(*) FROM measurements WHERE \"timestamp\" = TIMESTAMPTZ '2098-01-01 00:00:00+00';"
    ).stdout.strip()
    assert before == "1"
    assert after == before


def test_migrations_create_all_persistent_domains(postgres_db: IsolatedPostgres) -> None:
    rows = postgres_db.psql(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"
    ).stdout.splitlines()
    assert {
        "measurements",
        "predictions",
        "recommendations",
        "actuator_states",
        "actuator_commands",
        "node_settings",
        "user",
        "session",
        "account",
        "verification",
        "aircheck_access_roles",
        "aircheck_access_audit",
    } <= set(rows)


def test_postgres_16_is_used(postgres_db: IsolatedPostgres) -> None:
    version = postgres_db.psql("SHOW server_version_num;").stdout.strip()
    assert version.startswith("16")


def test_history_pending_and_retention_indexes_have_expected_definitions(
    postgres_db: IsolatedPostgres,
) -> None:
    raw = postgres_db.psql(
        "SELECT json_object_agg(indexname, indexdef)::text "
        "FROM pg_indexes WHERE schemaname = 'public';"
    ).stdout.strip()
    indexes = json.loads(raw)
    expected_names = {
        "idx_measurements_timestamp",
        "idx_predictions_target_created",
        "idx_recommendations_created",
        "idx_actuator_commands_pending",
        "idx_actuator_commands_created",
        "idx_predictions_created",
        "idx_actuator_commands_retention",
        "idx_better_auth_session_user",
        "idx_better_auth_account_provider",
        "idx_better_auth_account_user",
        "idx_better_auth_verification_identifier",
        "idx_aircheck_single_owner",
        "idx_aircheck_access_audit_created",
    }
    assert expected_names <= indexes.keys()
    assert '"timestamp", id' in indexes["idx_measurements_timestamp"]
    assert "device_id, status, id" in indexes["idx_actuator_commands_pending"]
    assert "created_at" in indexes["idx_predictions_created"]

    predicate = postgres_db.psql(
        "SELECT pg_get_expr(indpred, indrelid) FROM pg_index "
        "WHERE indexrelid = 'idx_actuator_commands_retention'::regclass;"
    ).stdout.strip()
    assert "status" in predicate and "applied" in predicate


@pytest.mark.parametrize(
    ("field", "invalid_value"),
    [
        ("indoor_co2", "-0.01"),
        ("indoor_co2", "20000.01"),
        ("indoor_temperature", "-80.01"),
        ("indoor_temperature", "100.01"),
        ("indoor_humidity", "-0.01"),
        ("indoor_humidity", "100.01"),
        ("indoor_pm25", "-0.01"),
        ("indoor_pm25", "5000.01"),
        ("outdoor_temperature", "-100.01"),
        ("outdoor_temperature", "100.01"),
        ("outdoor_humidity", "-0.01"),
        ("outdoor_humidity", "100.01"),
        ("outdoor_pm25", "-0.01"),
        ("outdoor_pm25", "5000.01"),
    ],
)
def test_measurement_range_checks_reject_out_of_range_values(
    postgres_db: IsolatedPostgres,
    field: str,
    invalid_value: str,
) -> None:
    assert field in MEASUREMENT_FIELDS
    _expect_sql_rejection(
        postgres_db,
        _measurement_insert({field: invalid_value}),
        "check constraint",
    )


def test_measurement_range_checks_accept_documented_boundaries(postgres_db: IsolatedPostgres) -> None:
    before = int(postgres_db.psql("SELECT count(*) FROM measurements;").stdout.strip())
    minimums = {
        "indoor_co2": "0",
        "indoor_temperature": "-80",
        "indoor_humidity": "0",
        "indoor_pm25": "0",
        "outdoor_temperature": "-100",
        "outdoor_humidity": "0",
        "outdoor_pm25": "0",
    }
    maximums = {
        "indoor_co2": "20000",
        "indoor_temperature": "100",
        "indoor_humidity": "100",
        "indoor_pm25": "5000",
        "outdoor_temperature": "100",
        "outdoor_humidity": "100",
        "outdoor_pm25": "5000",
    }
    postgres_db.psql(_measurement_insert(minimums))
    postgres_db.psql(_measurement_insert(maximums))
    after = int(postgres_db.psql("SELECT count(*) FROM measurements;").stdout.strip())
    assert after == before + 2


@pytest.mark.parametrize(
    ("statement", "expected"),
    [
        (
            "INSERT INTO actuator_states (device_id, window_mode) VALUES ('invalid-window-mode', 'remote');",
            "check constraint",
        ),
        (
            "INSERT INTO actuator_commands (device_id, target, desired_state, source, reason, batch_id) "
            "VALUES ('missing-device', 'window', TRUE, 'manual', 'test', 'batch');",
            "foreign key constraint",
        ),
        (
            "INSERT INTO actuator_states (device_id) VALUES ('command-checks'); "
            "INSERT INTO actuator_commands (device_id, target, desired_state, source, reason, batch_id) "
            "VALUES ('command-checks', 'fan', TRUE, 'manual', 'test', 'batch');",
            "check constraint",
        ),
        (
            "INSERT INTO actuator_states (device_id) VALUES ('command-source-check'); "
            "INSERT INTO actuator_commands (device_id, target, desired_state, source, reason, batch_id) "
            "VALUES ('command-source-check', 'window', TRUE, 'system', 'test', 'batch');",
            "check constraint",
        ),
        (
            "INSERT INTO actuator_states (device_id) VALUES ('command-status-check'); "
            "INSERT INTO actuator_commands (device_id, target, desired_state, source, reason, batch_id, status) "
            "VALUES ('command-status-check', 'window', TRUE, 'manual', 'test', 'batch', 'done');",
            "check constraint",
        ),
    ],
)
def test_actuator_schema_checks_reject_invalid_values(
    postgres_db: IsolatedPostgres,
    statement: str,
    expected: str,
) -> None:
    _expect_sql_rejection(postgres_db, statement, expected)


@pytest.mark.parametrize(
    ("columns", "values"),
    [
        ("manual_override_minutes", "0"),
        ("manual_override_minutes", "241"),
        ("auto_ventilation_minimum_minutes", "121"),
        ("co2_critical_threshold", "800"),
        ("pm25_elevated_limit", "15"),
    ],
)
def test_node_settings_checks_enforce_ranges_and_threshold_order(
    postgres_db: IsolatedPostgres,
    columns: str,
    values: str,
) -> None:
    device_id = f"invalid-setting-{columns}-{values}"
    overrides = {
        "co2_critical_threshold": "1000",
        "pm25_elevated_limit": "35",
    }
    if columns in overrides:
        overrides[columns] = values
        selected = "co2_normal_threshold, co2_critical_threshold, pm25_good_limit, pm25_elevated_limit"
        row = f"800, {overrides['co2_critical_threshold']}, 15, {overrides['pm25_elevated_limit']}"
    elif columns == "manual_override_minutes":
        selected, row = "manual_override_minutes", values
    else:
        selected, row = "auto_ventilation_minimum_minutes", values
    _expect_sql_rejection(
        postgres_db,
        f"INSERT INTO node_settings (device_id, {selected}) VALUES ('{device_id}', {row});",
        "check constraint",
    )


def test_auth_roles_enforce_role_validity_single_owner_and_expiry_shape(
    postgres_db: IsolatedPostgres,
) -> None:
    postgres_db.psql(
        "INSERT INTO \"user\" (id, name, email) VALUES "
        "('owner-1', 'Owner One', 'owner1@example.test'), "
        "('owner-2', 'Owner Two', 'owner2@example.test'), "
        "('operator-expiry', 'Operator', 'operator@example.test');"
    )
    postgres_db.psql(
        "INSERT INTO aircheck_access_roles (user_id, role) VALUES ('owner-1', 'owner');"
    )
    _expect_sql_rejection(
        postgres_db,
        "INSERT INTO aircheck_access_roles (user_id, role) VALUES ('owner-2', 'owner');",
        "unique constraint",
    )
    _expect_sql_rejection(
        postgres_db,
        "INSERT INTO aircheck_access_roles (user_id, role, operator_expires_at) "
        "VALUES ('operator-expiry', 'user', NOW());",
        "check constraint",
    )
    _expect_sql_rejection(
        postgres_db,
        "INSERT INTO aircheck_access_roles (user_id, role) "
        "VALUES ('operator-expiry', 'superadmin');",
        "check constraint",
    )


def test_auth_schema_foreign_keys_and_unique_email_are_enforced(
    postgres_db: IsolatedPostgres,
) -> None:
    postgres_db.psql(
        "INSERT INTO \"user\" (id, name, email) VALUES ('auth-user', 'User', 'unique@example.test');"
    )
    _expect_sql_rejection(
        postgres_db,
        "INSERT INTO \"user\" (id, name, email) VALUES ('auth-user-2', 'Other', 'unique@example.test');",
        "unique constraint",
    )
    _expect_sql_rejection(
        postgres_db,
        "INSERT INTO \"session\" (id, \"expiresAt\", token, \"userId\") "
        "VALUES ('session-orphan', NOW() + INTERVAL '1 hour', 'token-orphan', 'missing-user');",
        "foreign key constraint",
    )


def test_actuator_state_delete_cascades_commands_but_audit_keeps_nullable_actor(
    postgres_db: IsolatedPostgres,
) -> None:
    postgres_db.psql(
        "INSERT INTO \"user\" (id, name, email) VALUES ('audit-actor', 'Actor', 'actor@example.test'); "
        "INSERT INTO \"user\" (id, name, email) VALUES ('audit-subject', 'Subject', 'subject@example.test'); "
        "INSERT INTO aircheck_access_audit (actor_user_id, subject_user_id, action) "
        "VALUES ('audit-actor', 'audit-subject', 'role.update'); "
        "INSERT INTO actuator_states (device_id) VALUES ('cascade-node'); "
        "INSERT INTO actuator_commands (device_id, target, desired_state, source, reason, batch_id) "
        "VALUES ('cascade-node', 'window', TRUE, 'manual', 'test', 'cascade-batch');"
    )
    postgres_db.psql("DELETE FROM actuator_states WHERE device_id = 'cascade-node';")
    assert (
        postgres_db.psql(
            "SELECT count(*) FROM actuator_commands WHERE device_id = 'cascade-node';"
        ).stdout.strip()
        == "0"
    )
    postgres_db.psql("DELETE FROM \"user\" WHERE id = 'audit-actor';")
    nullable_actor = postgres_db.psql(
        "SELECT actor_user_id IS NULL FROM aircheck_access_audit WHERE action = 'role.update';"
    ).stdout.strip()
    assert nullable_actor == "t"
