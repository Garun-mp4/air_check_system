import json
import math
import shutil
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import joblib
import pytest
from feature_schema import build_training_rows
from modeling import train_and_evaluate
from predict import Predictor, ModelUnavailableError
from readiness import dataset_readiness
from test_modeling import make_measurements

def payload():
    return dict(co2=900, temperature=23, humidity=45, indoor_pm25=5, outdoor_temperature=18,
        outdoor_humidity=50, outdoor_pm25=8, window_open=False, co2_change_5min=40, co2_change_10min=80, hour=14)

def test_source_and_horizon_cannot_cross_real_simulation_or_15_20(tmp_path):
    rows=build_training_rows(make_measurements(180),20)
    train_and_evaluate(rows,tmp_path,data_source='simulator',horizon_minutes=20)
    predict=Predictor(tmp_path/'model.joblib')
    with pytest.raises(ModelUnavailableError,match='Источник'): predict.predict({**payload(),'data_source':'real','horizon_minutes':20})
    with pytest.raises(ModelUnavailableError,match='Горизонт'): predict.predict({**payload(),'data_source':'simulator','horizon_minutes':15})
    result=predict.predict({**payload(),'data_source':'simulator','horizon_minutes':20})
    assert result['horizon_minutes']==20 and result['predicted_co2_15min'] is None
    assert result['predicted_co2']>0
    assert all(row['target_timestamp']>=row['timestamp']+timedelta(minutes=20) for row in rows)

def test_legacy_unknown_model_is_not_accepted_as_real(tmp_path):
    train_and_evaluate(build_training_rows(make_measurements(160)),tmp_path)
    with pytest.raises(ModelUnavailableError,match='Источник'):
        Predictor(tmp_path/'model.joblib').predict({**payload(),'data_source':'real'})

def test_real_readiness_requires_duration_variation_and_valid_data():
    records=[{**row,'data_source':'real'} for row in make_measurements(160)]
    report=dataset_readiness(records,'real')
    assert not report['ready'] and any('24' in reason for reason in report['reasons'])
    start=datetime(2026,1,1,tzinfo=timezone.utc)
    records=[{**records[i%160], 'id':i, 'timestamp':(start+timedelta(minutes=i)).isoformat(),
        'indoor':{**records[i%160]['indoor'],'co2':650+250*math.sin(i/60)}} for i in range(1500)]
    assert dataset_readiness(records,'real')['ready']
    records.append({**records[0], 'timestamp':(start-timedelta(minutes=1)).isoformat(), 'indoor':{'co2':None}})
    assert dataset_readiness(records,'real')['rejected']==1
    assert not dataset_readiness(records,'real')['ready']

def test_export_uses_same_float32_inference_in_portable_firmware(tmp_path):
    report=train_and_evaluate(build_training_rows(make_measurements(180)),tmp_path,data_source='simulator')
    edge=json.loads((tmp_path/'edge-model.json').read_text())
    golden=json.loads((tmp_path/'edge-golden.json').read_text())
    assert edge['parameter_bytes']==48 and edge['hardware_benchmark'] is None
    assert report['baseline']['name']=='persistence' and 'beats_baseline' in report
    assert 'enabled = false' in (tmp_path/'edge_model.hpp').read_text()
    def f(value): return f'{value:.9e}f'
    source='#include "edge.hpp"\n#include "edge_model.hpp"\n#include <cstdio>\nint main(){\n'
    for row in golden:
        source+=' {std::array<float,11> x={'+','.join(map(f,row['features']))+'}; float y; if(!aircheck::linear_predict(x,aircheck::edge_model::weights,aircheck::edge_model::bias,y)) return 2; if(std::fabs(y-'+f(row['expected'])+')>0.25f) return 3;}\n'
    source+='aircheck::EdgeHistory h; float delta; if(h.change(600000,600000,900,delta)) return 4; for(unsigned i=0;i<121;++i) h.push(i*5000,500+i); if(!h.change(600000,600000,620,delta) || delta!=120) return 5; return 0;}\n'
    (tmp_path/'test.cpp').write_text(source)
    firmware=Path(__file__).resolve().parents[2]/'firmware/esp32/src'
    if shutil.which('g++'):
        subprocess.run(['g++','-std=c++17','-Wall','-Wextra','-Werror','-I'+str(firmware),'-I'+str(tmp_path),str(tmp_path/'test.cpp'),'-o',str(tmp_path/'test')],check=True,timeout=60)
        subprocess.run([str(tmp_path/'test')],check=True,timeout=10)
    else:
        subprocess.run(['docker','run','--rm','--mount',f'type=bind,source={tmp_path},target=/test,readonly','--mount',f'type=bind,source={firmware},target=/src,readonly','gcc:14','sh','-c','g++ -std=c++17 -Wall -Wextra -Werror -I/src -I/test /test/test.cpp -o /tmp/check && /tmp/check'],check=True,capture_output=True,timeout=120)

def test_edge_admission_rechecks_float32_quality_instead_of_reusing_float64_metrics(tmp_path):
    import numpy as np
    from types import SimpleNamespace
    from edge_export import export_linear
    features=np.zeros((2,11)); features[:,0]=900
    bias=-9e10+800
    model=SimpleNamespace(coef_=np.asarray([1e8]+[0.]*10),intercept_=bias,predict=lambda matrix:np.asarray(matrix)[:,0]*1e8+bias)
    result=export_linear(model,features,tmp_path,'real',15,'numeric-test',{'mae':0.,'rmse':0.},{'mae':100.,'rmse':100.},[800.,800.])
    assert result['reference_metrics']['rmse']==0
    assert result['metrics']['rmse']>10 and result['quantization_max_error_ppm']>10
    assert not result['qualified'] and 'enabled = false' in (tmp_path/'edge_model.hpp').read_text()
