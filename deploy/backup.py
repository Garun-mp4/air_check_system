"""Private complete backups and a destructive-free restore rehearsal in a new container."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile
import time
import uuid
import zipfile

ROOT=Path(__file__).resolve().parents[1]
class PrivateBytes(bytes):
    def __repr__(self): return '<private backup bytes>'
ARCHIVES={'model.tar.gz':('ml-service','/app/model'), 'avatars.tar.gz':('backend','/app/data/avatars'),
    'caddy-data.tar.gz':('https-proxy','/data'), 'caddy-config.tar.gz':('https-proxy','/config')}
def run(args, data=None, timeout=180):
    result=subprocess.run(args,input=data,capture_output=True,timeout=timeout)
    if result.returncode: raise RuntimeError(f'Backup command failed with exit code {result.returncode}')
    return result.stdout

def create(destination, env_file, project):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}',project): raise ValueError('Invalid Compose project')
    if destination.exists(): raise ValueError('Backup already exists; choose a new file')
    compose=['docker','compose','--project-directory',str(ROOT),'-f',str(ROOT/'docker-compose.yml'),'--env-file',str(env_file.resolve()),'-p',project]
    # Model changes and avatar changes must be quiescent during a consistent backup.
    # PostgreSQL pg_dump itself uses one consistent transaction snapshot.
    members={'database.dump':run(compose+['exec','-T','postgres','sh','-c','exec pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB"']),
        'installation.env':env_file.read_bytes()}
    for name,(service,folder) in ARCHIVES.items():
        members[name]=run(compose+['exec','-T',service,'tar','-C',folder,'-czf','-','.'])
    manifest={'format':1,'created_at_unix':time.time(),'members':{name:hashlib.sha256(data).hexdigest() for name,data in members.items()}}
    destination.parent.mkdir(parents=True,exist_ok=True)
    with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as private:
        with zipfile.ZipFile(private,'w',compression=zipfile.ZIP_DEFLATED) as archive:
            for name,data in members.items(): archive.writestr(name,data)
            archive.writestr('manifest.json',json.dumps(manifest,indent=2))
    if os.name!='nt': destination.chmod(0o600)
    return manifest

def read_backup(path):
    with zipfile.ZipFile(path) as archive:
        expected={'manifest.json','database.dump','installation.env',*ARCHIVES}
        if set(archive.namelist())!=expected or len(archive.namelist())!=len(expected): raise ValueError('Invalid backup members')
        if sum(info.file_size for info in archive.infolist())>512*1024*1024: raise ValueError('Backup exceeds rehearsal size limit')
        manifest=json.loads(archive.read('manifest.json'))
        if manifest.get('format')!=1: raise ValueError('Unknown backup format')
        members={name:PrivateBytes(archive.read(name)) for name in expected-{'manifest.json'}}
        for name,data in members.items():
            if hashlib.sha256(data).hexdigest()!=manifest['members'].get(name): raise ValueError('Backup checksum mismatch')
        return members

def restore_files(members, destination):
    destination.mkdir(parents=True, exist_ok=True)
    for name in ARCHIVES:
        folder=destination/name.removesuffix('.tar.gz'); folder.mkdir()
        with tarfile.open(fileobj=io.BytesIO(members[name]),mode='r:gz') as archive:
            items=archive.getmembers()
            if sum(item.size for item in items)>512*1024*1024: raise ValueError('Archive exceeds size limit')
            for item in items:
                path=PurePosixPath(item.name)
                if path.is_absolute() or '..' in path.parts or item.issym() or item.islnk() or not (item.isfile() or item.isdir()): raise ValueError('Unsafe backup path')
            archive.extractall(folder,filter='data')
    with os.fdopen(os.open(destination/'installation.env', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as private:
        private.write(members['installation.env'])

def verify(path):
    members=read_backup(path)
    name='aircheck-restore-'+uuid.uuid4().hex[:12]
    identifier=uuid.uuid4().hex
    created=False
    with tempfile.TemporaryDirectory(prefix='aircheck-restore-') as temporary:
        restore_files(members,Path(temporary))
        try:
            run(['docker','run','-d','--name',name,'--label','org.aircheck.restore='+identifier,'--tmpfs','/var/lib/postgresql/data:rw,nosuid,nodev,size=512m',
                '-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=aircheck_restore','postgres:16-alpine'])
            created=True
            for _ in range(120):
                check=subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','aircheck_restore'],capture_output=True,timeout=5)
                if check.returncode==0: break
                time.sleep(.25)
            else: raise RuntimeError('Restore PostgreSQL did not become ready')
            run(['docker','exec','-i',name,'pg_restore','--exit-on-error','--no-owner','--no-privileges','-U','postgres','-d','aircheck_restore'],members['database.dump'])
            query='''SELECT json_build_object('measurements',(SELECT count(*) FROM measurements),'telemetry',(SELECT count(*) FROM device_telemetry),'users',(SELECT count(*) FROM "user"),'schema_ready',to_regclass('runtime_device_modes') IS NOT NULL);'''
            result=json.loads(run(['docker','exec',name,'psql','-X','-A','-t','-U','postgres','-d','aircheck_restore','-c',query]))
            result['files_restored']={name:sum(item.is_file() for item in (Path(temporary)/name.removesuffix('.tar.gz')).rglob('*')) for name in ARCHIVES}
            return result
        finally:
            if created:
                label=run(['docker','inspect','--format','{{index .Config.Labels "org.aircheck.restore"}}',name]).decode().strip()
                if label==identifier: run(['docker','rm','-f',name])

def restore_new(path, env_out, project, port):
    if not re.fullmatch(r'aircheck-restored-[a-z0-9-]{1,40}',project): raise ValueError('Restore requires a new aircheck-restored-* project')
    if not 1024<=port<=65535 or env_out.exists(): raise ValueError('Choose an unused port and a new environment file')
    for args in (['ps','-a','-q'],['volume','ls','-q']):
        if run(['docker',*args,'--filter','label=com.docker.compose.project='+project]).strip(): raise ValueError('Target project already has resources')
    members=read_backup(path)
    env_out.parent.mkdir(parents=True,exist_ok=True)
    with os.fdopen(os.open(env_out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'wb') as file:
        file.write(members['installation.env'])
    if os.name!='nt': env_out.chmod(0o600)
    override=env_out.with_name(env_out.name+'.restore.yml')
    with override.open('x',encoding='utf-8') as file:
        file.write(f'''services:
  postgres:
    ports: !override []
  ml-service:
    ports: !override []
  backend:
    environment:
      PORT: "3000"
    ports: !override
      - "127.0.0.1:{port}:3000"
  https-proxy:
    ports: !override []
''')
    compose=['docker','compose','--project-directory',str(ROOT),'-f',str(ROOT/'docker-compose.yml'),'-f',str(override.resolve()),'--env-file',str(env_out.resolve()),'-p',project]
    run(compose+['build','backend','ml-service','migrations'],timeout=900)
    run(compose+['up','-d','--wait','postgres'])
    run(compose+['exec','-T','postgres','sh','-c','exec pg_restore --clean --if-exists --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],members['database.dump'])
    run(compose+['run','--rm','--no-deps','migrations'])
    # Recovered commands and unsent messages must never execute just because a backup was loaded.
    sql=b"""BEGIN;
UPDATE actuator_commands SET status='cancelled',completed_at=clock_timestamp(),failure_reason='Backup restored; new command required' WHERE status='pending';
UPDATE actuator_states SET known_targets=ARRAY[]::text[],last_reported_at=NULL,override_until=NULL,window_mode='auto',desired_exhaust_on=exhaust_on,desired_intake_on=intake_on,desired_window_open=window_open,window_open_since=NULL,ventilation_started_at=NULL;
DELETE FROM device_telemetry_heads;
UPDATE runtime_device_modes SET updated_at=clock_timestamp();
UPDATE notification_events SET delivery_status='disabled',delivery_error='Backup restored; delivery disabled',next_attempt_at=NULL WHERE delivery_status IN ('pending','sending');
UPDATE notification_settings SET enabled=false;
DELETE FROM notification_conditions;
COMMIT;"""
    run(compose+['exec','-T','postgres','sh','-c','exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],sql)
    with tempfile.TemporaryDirectory(prefix='aircheck-restore-files-') as folder:
        restore_files(members,Path(folder))
        for name,(service,target) in ARCHIVES.items():
            run(compose+['run','--rm','-T','--no-deps','--user','0','--entrypoint','sh',service,'-c',f'tar -C {target} -xzf -'],members[name])
    return {'project':project,'env_file':str(env_out),'override':str(override),'backend_started':False,'commands_cancelled':True}

if __name__=='__main__':
    parser=argparse.ArgumentParser(); sub=parser.add_subparsers(dest='action',required=True)
    backup=sub.add_parser('create'); backup.add_argument('--out',type=Path,required=True); backup.add_argument('--env-file',type=Path,required=True); backup.add_argument('--project',required=True)
    restore=sub.add_parser('verify'); restore.add_argument('backup',type=Path)
    fresh=sub.add_parser('restore-new'); fresh.add_argument('backup',type=Path); fresh.add_argument('--env-out',type=Path,required=True); fresh.add_argument('--project',required=True); fresh.add_argument('--port',type=int,required=True)
    args=parser.parse_args()
    try:
        result=create(args.out,args.env_file,args.project) if args.action=='create' else restore_new(args.backup,args.env_out,args.project,args.port) if args.action=='restore-new' else verify(args.backup)
        print(json.dumps({'created':True} if args.action=='create' else result))
    except (ValueError,RuntimeError,OSError,KeyError,zipfile.BadZipFile,tarfile.TarError,subprocess.SubprocessError) as error:
        parser.exit(1, f'Backup operation failed ({type(error).__name__}); existing deployment was not replaced\n')
