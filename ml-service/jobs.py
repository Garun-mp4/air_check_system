"""Single-writer background training; only validated artifacts replace the active file."""
from __future__ import annotations
import json, math, os, shutil, tempfile, threading, uuid
from file_lock import acquire
from readiness import dataset_readiness
from datetime import datetime, timezone
from pathlib import Path
import joblib
from feature_schema import FEATURE_NAMES, build_training_rows, rows_to_matrix
from modeling import train_and_evaluate
from predict import Predictor

class BusyError(RuntimeError): pass

def now(): return datetime.now(timezone.utc).isoformat()

class ModelJobs:
    def __init__(self, model_path, min_rows=30):
        self.path = Path(model_path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.previous = self.path.with_name('previous.joblib')
        self.state_path = self.path.with_name('training-job.json')
        self.min_rows = min_rows
        # Recover abandoned tasks, but do not interfere with another live process.
        try:
            lease = self._lease()
        except BusyError: return
        try:
            state = self.status()['job']
            if state and state['status'] in ('queued','running'):
                self._save({**state,'status':'failed','error':'Обучение прервано перезапуском сервиса','finished_at':now()})
        finally: lease.close()

    def _lease(self):
        try: return acquire(self.path.with_name('training.lock'))
        except BlockingIOError:
            raise BusyError('Обучение или смена модели уже выполняется')

    def _save(self, state):
        temporary = self.state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state,ensure_ascii=False)); temporary.chmod(0o600)
        with temporary.open('r+b') as file: os.fsync(file.fileno())
        os.replace(temporary,self.state_path)

    def status(self):
        try: state = json.loads(self.state_path.read_text())
        except FileNotFoundError: state = None
        return {'job':state,'rollback_available':self.previous.exists()}

    def submit(self, records, source, model_version=None, horizon_minutes=15):
        if source not in ('real','simulator','unknown'): raise ValueError('Неверный источник данных')
        if not isinstance(records,list) or len(records)>20000: raise ValueError('Нужен массив до 20000 измерений')
        if horizon_minutes not in (15, 20): raise ValueError('Горизонт должен быть 15 или 20 минут')
        # Unknown legacy data is never implicitly labelled real.
        selected = [r for r in records if isinstance(r,dict) and r.get('data_source','unknown')==source]
        lease = self._lease()
        identifier = uuid.uuid4().hex
        state = {'id':identifier,'model_version':model_version or identifier,'status':'queued','source':source,'horizon_minutes':horizon_minutes,'measurement_count':len(selected),'created_at':now(),'error':None}
        try:
            self._save(state)
            thread = threading.Thread(target=self._train,args=(selected,state,lease),daemon=True)
            thread.start()
        except BaseException: lease.close(); raise
        return state

    def _train(self, records, state, lease):
        try:
            state = {**state,'started_at':now()}
            self._save({**state,'status':'running'})
            readiness = dataset_readiness(records, state['source'], state['horizon_minutes'])
            if state['source'] == 'real' and not readiness['ready']:
                raise ValueError('; '.join(readiness['reasons']))
            rows = build_training_rows(records, state['horizon_minutes'])
            with tempfile.TemporaryDirectory(prefix='candidate-',dir=self.path.parent) as folder:
                report = train_and_evaluate(rows,folder,self.min_rows,state['model_version'],state['source'],state['horizon_minutes'])
                if state['source'] == 'real' and not report['beats_baseline']:
                    raise ValueError('Кандидат не улучшает RMSE базового прогноза минимум на 5%; действующая модель сохранена')
                candidate = Path(folder)/'model.joblib'
                artifact = joblib.load(candidate)
                predicted = artifact['model'].predict(rows_to_matrix(rows)[0][:2])
                if artifact['feature_names'] != FEATURE_NAMES or any(not math.isfinite(float(v)) or not 0<=float(v)<=20000 for v in predicted):
                    raise ValueError('Новая модель не прошла проверку прогнозов')
                artifact['training_report'] = {**report,'source':state['source'],'measurement_count':len(records),'readiness':readiness}
                joblib.dump(artifact,candidate)
                with candidate.open('r+b') as file: os.fsync(file.fileno())
                if self.path.exists():
                    backup = self.previous.with_suffix('.tmp')
                    shutil.copyfile(self.path,backup)
                    with backup.open('r+b') as file: os.fsync(file.fileno())
                    os.replace(backup,self.previous)
                export_dir = self.path.parent / ('edge-' + state['id'])
                export_dir.mkdir(exist_ok=True)
                for name in ('edge-model.json', 'edge_model.hpp', 'edge-golden.json'):
                    shutil.copyfile(Path(folder)/name, export_dir/name)
                os.replace(candidate,self.path)
                self._save({**state,'status':'succeeded','finished_at':now(),'report':artifact['training_report']})
        except Exception as exc:
            # Input/model errors are safe to surface; no request credentials are accepted here.
            message = str(exc)
            if 'insufficient' in message:
                message = 'Недостаточно истории для обучения: '+message
            self._save({**state,'status':'failed','finished_at':now(),'error':message[:500]})
        finally: lease.close()

    def rollback(self):
        lease = self._lease()
        try:
            if not self.previous.exists(): raise ValueError('Предыдущая модель отсутствует')
            # Validate before touching the working artifact.
            Predictor(self.previous)._load_if_needed()
            temporary = self.path.with_suffix('.rollback')
            shutil.copyfile(self.path,temporary)
            staged = self.path.with_suffix('.restore')
            shutil.copyfile(self.previous,staged)
            os.replace(temporary,self.previous)
            os.replace(staged,self.path)
            return {'status':'ready','model':Predictor(self.path).info()}
        finally: lease.close()
