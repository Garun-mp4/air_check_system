"""Admission checks for model deployment; fixtures are synthetic and never flashed."""
import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

path = Path(__file__).resolve().parents[2] / 'firmware/esp32/prepare_model.py'
spec = importlib.util.spec_from_file_location('edge_prepare', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def fixture(tmp_path, **changes):
    model = dict(schema_version=1, feature_names=module.FEATURE_NAMES, model='linear_regression',
                 data_source='real', qualified=True, horizon_minutes=20, coefficients=[0.] * 11,
                 intercept=800., model_version='synthetic-admission-test')
    model.update(changes)
    model['sha256'] = hashlib.sha256(json.dumps(model, sort_keys=True).encode()).hexdigest()
    source = tmp_path / 'candidate.json'
    source.write_text(json.dumps(model))
    return source


def test_export_header_preserves_hash_and_horizon(tmp_path):
    source = fixture(tmp_path)
    output = tmp_path / 'edge_model.hpp'
    checksum = module.prepare(source, output)
    header = output.read_text()
    assert checksum in header and 'horizon_minutes=20' in header
    assert 'enabled=true' in header and 'std::array<float,11>' in header


@pytest.mark.parametrize('changes', [dict(data_source='simulator'), dict(qualified=False),
    dict(horizon_minutes=16), dict(feature_names=['wrong']), dict(coefficients=[0.] * 10),
    dict(intercept=float('inf')), dict(coefficients=[1e10] * 11)])
def test_invalid_candidate_never_writes_deployable_header(tmp_path, changes):
    output = tmp_path / 'edge_model.hpp'
    with pytest.raises(ValueError):
        module.prepare(fixture(tmp_path, **changes), output)
    assert not output.exists()


def test_modified_export_fails_checksum(tmp_path):
    source = fixture(tmp_path)
    body = json.loads(source.read_text()); body['intercept'] = 901.
    source.write_text(json.dumps(body))
    with pytest.raises(ValueError, match='checksum'):
        module.prepare(source, tmp_path / 'edge_model.hpp')
