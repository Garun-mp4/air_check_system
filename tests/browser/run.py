"""Real-service E2E. Owns only its uniquely labelled, ephemeral resources."""
from __future__ import annotations
import json, os, secrets, signal, socket, subprocess, sys, tempfile, time, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import urlopen

ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS = ROOT / 'tests/browser/artifacts'

def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

def main():
    ARTIFACTS.mkdir(exist_ok=True)
    run_id = secrets.token_hex(8)
    name = f'aircheck-e2e-{run_id}'
    processes, logs = [], []
    class TelegramStub(BaseHTTPRequestHandler):
        calls = 0
        always_fail = False
        successes = 0
        valid_chat = True
        def do_GET(self):
            body=json.dumps({'calls':type(self).calls,'successes':type(self).successes,'valid_chat':type(self).valid_chat}).encode()
            self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
        def do_POST(self):
            payload=json.loads(self.rfile.read(int(self.headers.get('Content-Length','0'))))
            if self.path=='/mode':
                type(self).always_fail=bool(payload.get('always_fail'));self.send_response(200);self.end_headers();self.wfile.write(b'{"ok":true}');return
            type(self).calls+=1; type(self).valid_chat &= payload.get('chat_id')=='-10042'
            # First two attempts fail, then accept; never log the request path/token.
            ok=type(self).calls>2 and not type(self).always_fail
            if ok:type(self).successes+=1
            self.send_response(200 if ok else 503);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'ok':ok}).encode())
        def log_message(self,*args): pass
    telegram=ThreadingHTTPServer(('127.0.0.1',0),TelegramStub)
    threading.Thread(target=telegram.serve_forever,daemon=True).start()
    env = dict(os.environ)
    db, web, ml, sim = [port() for _ in range(4)]
    base = f'http://localhost:{web}'
    env.update(DATABASE_URL=f'postgres://air_quality:air_quality_dev@127.0.0.1:{db}/air_quality',
        PORT=str(web), HOSTNAME='127.0.0.1', BETTER_AUTH_URL=base, BETTER_AUTH_TRUSTED_ORIGINS=base,
        ML_MANAGEMENT_TOKEN=secrets.token_urlsafe(40), BETTER_AUTH_SECRET=secrets.token_urlsafe(40), DEVICE_API_TOKEN=secrets.token_urlsafe(40),
        SIMULATOR_INTERNAL_TOKEN=secrets.token_urlsafe(40), SIMULATOR_INTERNAL_URL=f'http://127.0.0.1:{sim}',
        ML_SERVICE_URL=f'http://127.0.0.1:{ml}', ML_PORT=str(ml), BACKEND_URL=base,
        DEVICE_ID='room-01', NEXT_TELEMETRY_DISABLED='1', AIRCHECK_E2E='1',
        AIRCHECK_TELEGRAM_TEST_URL=f'http://127.0.0.1:{telegram.server_port}', E2E_TELEGRAM_URL=f'http://127.0.0.1:{telegram.server_port}')
    def start(args, cwd, filename):
        log = (ARTIFACTS / filename).open('w'); logs.append(log)
        proc = subprocess.Popen(args, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        processes.append(proc)
        return proc
    def wait(url):
        for _ in range(120):
            if any(p.poll() is not None for p in processes):
                raise RuntimeError('A test service exited; inspect tests/browser/artifacts/*.log')
            try:
                with urlopen(url, timeout=2) as response:
                    if response.status == 200: return
            except Exception: pass
            time.sleep(.5)
        raise RuntimeError(f'Service startup timeout: {url}')
    try:
        with tempfile.TemporaryDirectory(prefix='aircheck-e2e-') as private:
            env['MODEL_PATH'] = str(Path(private) / 'model/model.joblib')
            env['SIMULATOR_LOCK_DIRECTORY'] = str(Path(private) / 'locks')
            subprocess.run(['docker', 'run', '-d', '--rm', '--name', name, '--label', f'org.aircheck.e2e={run_id}',
                '--tmpfs', '/var/lib/postgresql/data:rw,nosuid,nodev,size=512m', '-p', f'127.0.0.1:{db}:5432',
                '-e', 'POSTGRES_USER=air_quality', '-e', 'POSTGRES_DB=air_quality', '-e', 'POSTGRES_PASSWORD=air_quality_dev',
                'postgres:16-alpine'], check=True, stdout=subprocess.DEVNULL)
            for _ in range(60):
                if subprocess.run(['docker','exec',name,'pg_isready','-h','127.0.0.1','-U','air_quality','-d','air_quality'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0: break
                time.sleep(.5)
            for migration in sorted((ROOT/'database/migrations').glob('*.sql')):
                subprocess.run(['docker','exec','-i',name,'psql','-X','-v','ON_ERROR_STOP=1','-U','air_quality','-d','air_quality'], input=migration.read_bytes(), check=True, stdout=subprocess.DEVNULL)
            account = {'email':f'owner-{run_id}@e2e.test', 'password':secrets.token_urlsafe(24)}
            account_file = Path(private)/'account.json'; account_file.write_text(json.dumps(account)); account_file.chmod(0o600)
            env['E2E_ACCOUNT_FILE'] = str(account_file); env['E2E_BASE_URL'] = base
            subprocess.run(['node','frontend/scripts/manage-owner.mjs','bootstrap',account['email'],'--password-stdin'], cwd=ROOT,env=env,input=account['password']+'\n'+account['password']+'\n',text=True,check=True,stdout=subprocess.DEVNULL)
            fixture = Path(private)/'training.json'
            now = datetime.now(timezone.utc)
            fixture.write_text(json.dumps([{'timestamp':(now-timedelta(minutes=120-i)).isoformat(), 'indoor':{'co2':700+i*2,'temperature':23,'humidity':45,'pm25':5}, 'outdoor':{'temperature':18,'humidity':60,'pm25':8}, 'window_open':False} for i in range(120)]))
            subprocess.run([sys.executable,'train.py','--input-file',str(fixture),'--output-dir',str(Path(private)/'model'),'--dataset-output',str(Path(private)/'dataset.csv')],cwd=ROOT/'ml-service',env=env,check=True,stdout=subprocess.DEVNULL)
            env['E2E_ML_PID'] = str(start([sys.executable,'app.py'], ROOT/'ml-service','ml.log').pid)
            start(['node','scripts/start-standalone.mjs'],ROOT/'frontend','web.log')
            wait(base+'/healthz'); wait(env['ML_SERVICE_URL']+'/healthz')
            sim_process = start([sys.executable,'-m','uvicorn','aircheck_simulator_3d.networking.web_service:create_web_service','--factory','--host','127.0.0.1','--port',str(sim)],ROOT,'simulator.log')
            env['E2E_SIMULATOR_PID'] = str(sim_process.pid)
            wait(base+'/api/simulator/state')
            return subprocess.run(['npx','--no-install','playwright','test','--config','playwright.config.ts'], cwd=ROOT/'frontend',env=env).returncode
    finally:
        telegram.shutdown();telegram.server_close()
        for process in reversed(processes):
            if process.poll() is None:
                os.killpg(process.pid,signal.SIGTERM)
                try: process.wait(timeout=8)
                except subprocess.TimeoutExpired: os.killpg(process.pid,signal.SIGKILL); process.wait()
        for log in logs: log.close()
        check = subprocess.run(['docker','inspect','--format','{{ index .Config.Labels "org.aircheck.e2e" }}',name],capture_output=True,text=True)
        if check.returncode == 0 and check.stdout.strip() == run_id:
            subprocess.run(['docker','stop',name],stdout=subprocess.DEVNULL,check=True)

if __name__ == '__main__': raise SystemExit(main())
