import os
from pathlib import Path
import shutil
import subprocess

import pytest

from conftest import ROOT, IsolatedPostgres


def test_telemetry_transaction_and_concurrent_identity(postgres_db: IsolatedPostgres):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node.js is required for the production telemetry repository')
    env = os.environ.copy()
    env['DATABASE_URL'] = postgres_db.database_url
    result = subprocess.run([node, '--experimental-strip-types', str(Path(__file__).with_name('telemetry_probe.mjs'))], cwd=ROOT, env=env, capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'telemetry: passed' in result.stdout
