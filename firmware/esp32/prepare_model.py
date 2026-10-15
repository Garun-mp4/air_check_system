"""Validate a qualified real linear export and generate bounded C++ constants."""
import hashlib
import json
import math
from pathlib import Path

FEATURE_NAMES = ['current_co2','indoor_temperature','indoor_humidity','indoor_pm25','outdoor_temperature','outdoor_humidity','outdoor_pm25','window_open','co2_change_5min','co2_change_10min','hour']

def prepare(path: Path, destination: Path):
    model = json.loads(path.read_text(encoding='utf-8'))
    checksum = model.pop('sha256', None)
    if checksum != hashlib.sha256(json.dumps(model, sort_keys=True).encode()).hexdigest():
        raise ValueError('Edge model checksum mismatch')
    if model.get('schema_version') != 1 or model.get('feature_names') != FEATURE_NAMES or model.get('model') != 'linear_regression':
        raise ValueError('Edge model feature schema mismatch')
    if model.get('data_source') != 'real' or model.get('qualified') is not True or model.get('horizon_minutes') not in (15,20):
        raise ValueError('Only a qualified real model with a 15/20 minute horizon can be deployed')
    weights = model.get('coefficients')
    if not isinstance(weights,list) or len(weights)!=11:
        raise ValueError('Expected 11 linear coefficients')
    if any(type(value) not in (int,float) or not math.isfinite(value) or abs(value)>1e9 for value in weights+[model.get('intercept')]):
        raise ValueError('Invalid linear model coefficients')
    def f(value): return f'{value:.9e}f'
    header='#pragma once\n#include <array>\nnamespace aircheck::edge_model {\nconstexpr bool enabled=true;\n'
    header+=f'constexpr unsigned horizon_minutes={model["horizon_minutes"]};\nconstexpr const char* sha256="{checksum}";\n'
    header+='constexpr std::array<float,11> weights={'+','.join(map(f,weights))+'};\nconstexpr float bias='+f(model['intercept'])+';\n}\n'
    destination.write_text(header,encoding='utf-8')
    return checksum
