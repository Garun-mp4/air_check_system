"""Small, explicit float32 linear candidate with reference vectors and admission metrics."""
import hashlib
import json
from pathlib import Path
import numpy as np
from feature_schema import FEATURE_NAMES

def export_linear(model, test_x, output, source, horizon, version, metrics, baseline):
    weights = np.asarray(model.coef_, dtype=np.float32)
    bias = np.float32(model.intercept_)
    vectors = np.asarray(test_x[:16], dtype=np.float32)
    def predict(row):
        result = bias
        for value, weight in zip(row, weights): result = np.float32(result + np.float32(value * weight))
        return float(result)
    artifact = {'schema_version': 1, 'model': 'linear_regression', 'model_version': version, 'data_source': source,
        'horizon_minutes': horizon, 'feature_names': FEATURE_NAMES, 'coefficients': weights.tolist(), 'intercept': float(bias),
        'metrics': metrics, 'baseline': baseline, 'qualified': metrics['rmse'] < baseline['rmse'] * .95,
        'parameter_bytes': int(weights.nbytes + bias.nbytes), 'hardware_benchmark': None}
    artifact['sha256'] = hashlib.sha256(json.dumps(artifact, sort_keys=True).encode()).hexdigest()
    output = Path(output)
    (output/'edge-model.json').write_text(json.dumps(artifact, indent=2), encoding='utf-8')
    golden = [{'features': row.tolist(), 'expected': predict(row), 'tolerance_ppm': .25} for row in vectors]
    (output/'edge-golden.json').write_text(json.dumps(golden, indent=2), encoding='utf-8')
    def literal(value): return format(float(value), '.9e') + 'f'
    header = '#pragma once\n#include <array>\nnamespace aircheck::edge_model {\n'
    header += f'constexpr bool enabled = {str(source == "real" and artifact["qualified"]).lower()};\n'
    header += f'constexpr unsigned horizon_minutes = {horizon};\n'
    header += 'constexpr const char* sha256 = "' + artifact['sha256'] + '";\n'
    header += 'constexpr std::array<float,11> weights = {' + ','.join(map(literal,weights)) + '};\n'
    header += 'constexpr float bias = ' + literal(bias) + ';\n}\n'
    (output/'edge_model.hpp').write_text(header, encoding='utf-8')
