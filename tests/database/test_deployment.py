import os
from pathlib import Path
import subprocess

from conftest import ROOT, MIGRATIONS, IsolatedPostgres

def test_migration_runner_tracks_existing_schema_repeats_and_rejects_changed_history(postgres_db: IsolatedPostgres, tmp_path):
    env={**os.environ,'DATABASE_URL':postgres_db.database_url,'MIGRATIONS_DIR':str(MIGRATIONS)}
    args=['node',str(ROOT/'frontend/scripts/migrate.mjs')]
    for _ in range(2):
        result=subprocess.run(args,env=env,capture_output=True,text=True,timeout=30)
        assert result.returncode==0,result.stdout+result.stderr
    assert postgres_db.psql('SELECT count(*) FROM schema_migrations;').stdout.strip()=='15'
    for path in MIGRATIONS.glob('*.sql'): (tmp_path/path.name).write_bytes(path.read_bytes())
    path=tmp_path/'001_init.sql';path.write_text(path.read_text()+'\n-- unexpected edit\n')
    result=subprocess.run(args,env={**env,'MIGRATIONS_DIR':str(tmp_path)},capture_output=True,text=True,timeout=30)
    assert result.returncode!=0 and 'not declared ready' in result.stderr
    assert postgres_db.psql('SELECT count(*) FROM schema_migrations;').stdout.strip()=='15'
