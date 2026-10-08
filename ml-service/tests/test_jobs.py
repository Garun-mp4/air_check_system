import time, threading
from datetime import datetime
import pytest
import jobs
from jobs import ModelJobs, BusyError
from test_modeling import make_measurements
from feature_schema import build_training_rows
from modeling import train_and_evaluate
from predict import Predictor

def finished(manager):
    for _ in range(200):
        status=manager.status()['job']
        if status['status'] in ('failed','succeeded'): return status
        time.sleep(.05)
    pytest.fail('training did not finish')

def test_training_purges_future_labels(tmp_path):
    report=train_and_evaluate(build_training_rows(make_measurements(160)),tmp_path)
    assert report['purged_rows']>0
    assert datetime.fromisoformat(report['train_last_target'])<datetime.fromisoformat(report['test_start'])

def test_job_activation_failed_training_and_rollback(tmp_path):
    path=tmp_path/'model.joblib'; manager=ModelJobs(path)
    measurements=[{**m,'data_source':'simulator'} for m in make_measurements(160)]
    first=manager.submit(measurements,'simulator')
    assert finished(manager)['status']=='succeeded'
    assert Predictor(path).info()['model_version']==first['id']
    original=path.read_bytes()
    manager.submit(measurements,'real')
    assert finished(manager)['status']=='failed'
    assert path.read_bytes()==original
    second=manager.submit(measurements,'simulator')
    assert finished(manager)['status']=='succeeded'
    assert Predictor(path).info()['model_version']==second['id']
    manager.rollback()
    assert Predictor(path).info()['model_version']==first['id']
    assert Predictor(path).info()['training']['source']=='simulator'

def test_concurrent_submit_and_rollback_rejected_without_loss(tmp_path,monkeypatch):
    entered=threading.Event(); release=threading.Event()
    actual=jobs.train_and_evaluate
    def blocked(*args,**kwargs):
        entered.set(); release.wait(5); return actual(*args,**kwargs)
    monkeypatch.setattr(jobs,'train_and_evaluate',blocked)
    manager=ModelJobs(tmp_path/'model.joblib')
    manager.submit(make_measurements(160),'unknown'); assert entered.wait(2)
    try:
        with pytest.raises(BusyError): manager.submit([], 'real')
        with pytest.raises(BusyError): manager.rollback()
    finally: release.set()
    assert finished(manager)['status']=='succeeded'
    recovered=ModelJobs(manager.path)
    assert recovered.status()['job']['status']=='succeeded'

def test_abandoned_task_marked_failed_on_restart(tmp_path):
    manager=ModelJobs(tmp_path/'model.joblib')
    manager._save({'status':'running','id':'abandoned'})
    assert ModelJobs(manager.path).status()['job']['status']=='failed'

def test_management_routes_require_separate_token(monkeypatch):
    import app
    from http.server import ThreadingHTTPServer
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError
    token='management-secret-'+'x'*32
    monkeypatch.setenv('ML_MANAGEMENT_TOKEN',token)
    server=ThreadingHTTPServer(('127.0.0.1',0),app.RequestHandler)
    thread=threading.Thread(target=server.serve_forever,daemon=True); thread.start()
    try:
        for route in ('status','train','rollback'):
            request=Request(f'http://127.0.0.1:{server.server_port}/management/{route}',data=None if route=='status' else b'{}')
            with pytest.raises(HTTPError) as error: urlopen(request,timeout=2)
            assert error.value.code==401
    finally: server.shutdown();server.server_close();thread.join()
