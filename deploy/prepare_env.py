"""Create installation secrets or fill missing keys, preserving existing credentials."""
import argparse
import base64
import os
from pathlib import Path
import secrets
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[1]
SECRET_KEYS = ('BETTER_AUTH_SECRET','DEVICE_API_TOKEN','SIMULATOR_DEVICE_TOKEN','SIMULATOR_INTERNAL_TOKEN','ML_MANAGEMENT_TOKEN')

def private_text(path):
    return os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8')
def prepare(path, mode='real', fill_missing=False):
    if path.exists() and not fill_missing: raise ValueError('File exists; use --fill-missing to preserve and complete it')
    original = path.read_text(encoding='utf-8') if path.exists() else (ROOT/'.env.example').read_text(encoding='utf-8')
    lines = original.splitlines()
    values = dict(line.split('=',1) for line in lines if line and not line.startswith('#') and '=' in line)
    new_install = not path.exists()
    generated = {key: secrets.token_urlsafe(48) for key in SECRET_KEYS if not values.get(key, '').strip()}
    if new_install:
        generated['POSTGRES_PASSWORD'] = secrets.token_urlsafe(36)
        generated['DATABASE_URL'] = f"postgres://{quote(values.get('POSTGRES_USER','air_quality'),safe='')}:{generated['POSTGRES_PASSWORD']}@localhost:5432/{quote(values.get('POSTGRES_DB','air_quality'),safe='')}"
    if not values.get('NOTIFICATION_ENCRYPTION_KEY','').strip(): generated['NOTIFICATION_ENCRYPTION_KEY'] = base64.b64encode(os.urandom(32)).decode()
    if new_install: generated['AIRCHECK_MODE'] = mode
    for key, value in generated.items():
        found = False
        for index,line in enumerate(lines):
            if line.startswith(key+'='): lines[index]=key+'='+value; found=True; break
        if not found: lines.append(key+'='+value)
    text='\n'.join(lines)+'\n'
    path.parent.mkdir(parents=True,exist_ok=True)
    if new_install:
        with private_text(path) as file: file.write(text)
    else:
        # Preserve the original file alongside an atomic replacement.
        backup = path.with_name(path.name+'.before-secrets')
        with private_text(backup) as file: file.write(original)
        temporary = path.with_name(path.name+'.new')
        with private_text(temporary) as file: file.write(text)
        os.replace(temporary,path)
    if os.name!='nt': path.chmod(0o600)
    return sorted(generated)

if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--out',type=Path,default=ROOT/'deploy/real.env')
    parser.add_argument('--mode',choices=('real','simulation'),default='real'); parser.add_argument('--fill-missing',action='store_true')
    args=parser.parse_args()
    try:
        keys=prepare(args.out,args.mode,args.fill_missing)
        print('Configuration prepared; generated keys: '+', '.join(keys))
        print('Existing database credentials are preserved. Existing passwords require a separate coordinated rotation.')
    except (ValueError,OSError) as error:
        parser.exit(1, f'Configuration was not replaced: {type(error).__name__}\n')
