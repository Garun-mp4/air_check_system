import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('aircheck_provision', ROOT / 'firmware/esp32/provision.py')
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)


def config():
    return {'ssid': 'AirCheck test', 'password': 'test-only-wifi', 'server': 'https://aircheck.example.invalid/', 'device_id': 'test-room', 'token': 'test-only-device-token-32-characters', 'ca_file': 'fixtures/root.pem', 'commissioned': False}


def test_provision_validates_without_printing_or_mutating_secrets(capsys):
    original = config()
    values = provision.validate(original, Path(__file__).parent)
    assert values['server'] == 'https://aircheck.example.invalid'
    assert values['commissioned'] == 0
    assert values['ntp_server'] == 'aircheck.example.invalid'
    assert values['root_ca'].startswith('-----BEGIN CERTIFICATE-----')
    assert original['server'].endswith('/')
    assert capsys.readouterr().out == ''


@pytest.mark.parametrize('key,value', [('ssid', 'а' * 17), ('password', 'short'), ('token', 'short'), ('device_id', '../room'), ('server', 'http://localhost'), ('server', 'https://user:pass@host'), ('server', 'https://host/api'), ('server', 'https://host/?token=x'), ('commissioned', 'false'), ('ssid', 'test\0hidden')])
def test_invalid_provisioning_is_rejected(key, value):
    private = config()
    private[key] = value
    with pytest.raises(ValueError):
        provision.validate(private, Path(__file__).parent)


def test_malformed_root_is_rejected(tmp_path):
    (tmp_path / 'invalid.pem').write_text('-----BEGIN CERTIFICATE-----\nYWJj\n-----END CERTIFICATE-----')
    private = config(); private['ca_file'] = 'invalid.pem'
    with pytest.raises(ValueError):
        provision.validate(private, tmp_path)


def test_real_nvs_image_generation(tmp_path):
    import json
    import os
    import subprocess
    import sys
    idf = os.environ.get('AIRCHECK_IDF_PATH')
    if not idf:
        pytest.skip('Set AIRCHECK_IDF_PATH and AIRCHECK_IDF_PYTHON for the SDK integration test')
    private = config(); private['ca_file'] = str(Path(__file__).parent / 'fixtures/root.pem')
    json_path = tmp_path / 'private.json'; json_path.write_text(json.dumps(private), encoding='utf-8')
    out = tmp_path / 'nvs.bin'
    executable = os.environ.get('AIRCHECK_IDF_PYTHON', sys.executable)
    result = subprocess.run([executable, str(ROOT / 'firmware/esp32/provision.py'), '--config', str(json_path), '--idf', idf, '--out', str(out)], capture_output=True, text=True, timeout=40)
    assert result.returncode == 0, result.stdout + result.stderr
    assert out.stat().st_size == 0x6000
    assert private['token'] not in result.stdout + result.stderr
    # Existing provisioning must not be overwritten by a repeated command.
    repeated = subprocess.run([executable, str(ROOT / 'firmware/esp32/provision.py'), '--config', str(json_path), '--idf', idf, '--out', str(out)], capture_output=True, text=True, timeout=40)
    assert repeated.returncode != 0
