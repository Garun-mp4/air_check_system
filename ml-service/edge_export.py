"""Small, explicit float32 linear candidate with reference vectors and admission metrics."""
import hashlib
import json
from pathlib import Path
import numpy as np
from feature_schema import FEATURE_NAMES
from sklearn.metrics import mean_absolute_error, mean_squared_error

def export_linear(model, test_x, output, source, horizon, version, metrics, baseline, test_y):
    weights = np.asarray(model.coef_, dtype=np.float32)
    bias = np.float32(model.intercept_)
    vectors = np.asarray(test_x[:16], dtype=np.float32)
    def predict(row):
        result = bias
        for value, weight in zip(row, weights): result = np.float32(result + np.float32(value * weight))
        return float(result)
    all_vectors = np.asarray(test_x, dtype=np.float32)
    with np.errstate(over='ignore', invalid='ignore'):
        predictions = np.asarray([predict(row) for row in all_vectors])
    finite = bool(np.isfinite(predictions).all() and np.isfinite(weights).all() and np.isfinite(bias))
    edge_metrics = {'mae': float(mean_absolute_error(test_y, predictions)), 'rmse': float(np.sqrt(mean_squared_error(test_y, predictions)))} if finite else {'mae': None, 'rmse': None}
    quantization_error = float(np.max(np.abs(predictions - model.predict(test_x)))) if finite else None
    deployable = finite and bool(((predictions >= 250) & (predictions <= 10000)).all()) and bool((np.abs(weights) <= 1e9).all()) and abs(float(bias)) <= 1e9
    artifact = {'schema_version': 1, 'model': 'linear_regression', 'model_version': version, 'data_source': source,
        'horizon_minutes': horizon, 'feature_names': FEATURE_NAMES, 'coefficients': [float(value) if np.isfinite(value) else None for value in weights], 'intercept': float(bias) if np.isfinite(bias) else None,
        'metrics': edge_metrics, 'reference_metrics': metrics, 'quantization_max_error_ppm': quantization_error,
        'baseline': baseline, 'qualified': bool(deployable and edge_metrics['rmse'] < baseline['rmse'] * .95),
        'parameter_bytes': int(weights.nbytes + bias.nbytes), 'hardware_benchmark': None}
    artifact['sha256'] = hashlib.sha256(json.dumps(artifact, sort_keys=True).encode()).hexdigest()
    output = Path(output)
    (output/'edge-model.json').write_text(json.dumps(artifact, indent=2), encoding='utf-8')
    golden = [{'features': row.tolist(), 'expected': predict(row), 'tolerance_ppm': .25} for row in vectors] if deployable else []
    (output/'edge-golden.json').write_text(json.dumps(golden, indent=2), encoding='utf-8')
    def literal(value): return format(float(value), '.9e') + 'f'
    header = '#pragma once\n#include <array>\nnamespace aircheck::edge_model {\n'
    header += f'constexpr bool enabled = {str(source == "real" and artifact["qualified"]).lower()};\n'
    header += f'constexpr unsigned horizon_minutes = {horizon};\n'
    header += 'constexpr const char* sha256 = "' + artifact['sha256'] + '";\n'
    header += 'constexpr std::array<float,11> weights = {' + ','.join(literal(value) if np.isfinite(value) else '0.f' for value in weights) + '};\n'
    header += 'constexpr float bias = ' + (literal(bias) if np.isfinite(bias) else '0.f') + ';\n}\n'
    (output/'edge_model.hpp').write_text(header, encoding='utf-8')
    return artifact
