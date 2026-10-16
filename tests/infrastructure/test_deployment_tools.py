import importlib.util
from pathlib import Path
import struct

import pytest

ROOT=Path(__file__).resolve().parents[2]
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,ROOT/path); module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

def test_generated_installation_secrets_are_independent_and_existing_values_preserved(tmp_path):
    prepare=load('prepare_env','deploy/prepare_env.py').prepare
    path=tmp_path/'real.env'; prepare(path)
    values=dict(line.split('=',1) for line in path.read_text().splitlines() if line and not line.startswith('#'))
    keys=['BETTER_AUTH_SECRET','DEVICE_API_TOKEN','SIMULATOR_DEVICE_TOKEN','SIMULATOR_INTERNAL_TOKEN','ML_MANAGEMENT_TOKEN']
    assert len({values[key] for key in keys})==5 and all(len(values[key])>=32 for key in keys)
    assert values['POSTGRES_PASSWORD']!='air_quality_dev'
    assert values['POSTGRES_PASSWORD'] in values['DATABASE_URL']
    original=path.read_bytes()
    with pytest.raises(ValueError): prepare(path)
    assert path.read_bytes()==original
    path.write_text(path.read_text().replace('ML_MANAGEMENT_TOKEN='+values['ML_MANAGEMENT_TOKEN'],'ML_MANAGEMENT_TOKEN='))
    prepare(path,fill_missing=True)
    updated=dict(line.split('=',1) for line in path.read_text().splitlines() if line and not line.startswith('#'))
    assert updated['POSTGRES_PASSWORD']==values['POSTGRES_PASSWORD'] and updated['DEVICE_API_TOKEN']==values['DEVICE_API_TOKEN']
    assert len(updated['ML_MANAGEMENT_TOKEN'])>=32 and path.with_name('real.env.before-secrets').exists()

def test_local_ntp_preserves_origin_and_server_clock_and_rejects_other_modes():
    ntp=load('ntp_server','deploy/ntp/server.py')
    packet=bytearray(48); packet[0]=4<<3|3; packet[40:48]=b'abcdefgh'
    result=ntp.response(packet,1800000000.25,1800000000.5)
    assert len(result)==48 and result[0]&7==4 and result[24:32]==b'abcdefgh'
    seconds,fraction=struct.unpack('!II',result[40:48])
    assert seconds-ntp.EPOCH==1800000000 and fraction==1<<31
    packet[0]=4<<3|6
    assert ntp.response(packet,1800000000,1800000000) is None
    assert ntp.response(b'',1800000000,1800000000) is None

def test_restore_refuses_tampered_backup_and_unsafe_archive_paths(tmp_path):
    import io,tarfile,zipfile,json,hashlib
    backup=load('backup_tools','deploy/backup.py')
    members={'database.dump':b'not a database','installation.env':b'private test fixture'}
    for name in backup.ARCHIVES:
        stream=io.BytesIO()
        with tarfile.open(fileobj=stream,mode='w:gz') as tar:
            entry=tarfile.TarInfo('../escape');entry.size=1;tar.addfile(entry,io.BytesIO(b'x'))
        members[name]=stream.getvalue()
    path=tmp_path/'backup.zip'
    with zipfile.ZipFile(path,'w') as zip:
        for name,data in members.items(): zip.writestr(name,data)
        zip.writestr('manifest.json',json.dumps({'format':1,'members':{name:hashlib.sha256(data).hexdigest() for name,data in members.items()}}))
    with pytest.raises(ValueError,match='Unsafe'): backup.restore_files(backup.read_backup(path),tmp_path/'restore')
