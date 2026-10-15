"""Exercise production controller/protocol code, including memory-safety checks."""
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'firmware/esp32'


def test_generated_resources_are_current():
    import sys
    subprocess.run([sys.executable, str(SOURCE / 'generate_board.py'), '--check'], check=True, timeout=10)


def test_controller_and_wire_protocols():
    compiler = shutil.which('g++')
    if compiler:
        with tempfile.TemporaryDirectory(prefix='aircheck-native-') as folder:
            binary = str(Path(folder) / 'core-test')
            result = subprocess.run([compiler, '-std=c++17', '-Wall', '-Wextra', '-Werror', '-fsanitize=address,undefined', '-I'+str(SOURCE / 'src'), str(SOURCE / 'src/core.cpp'), str(SOURCE / 'src/sensor_protocol.cpp'), str(SOURCE / 'tests/core_test.cpp'), '-o', binary], capture_output=True, text=True, timeout=60)
            assert result.returncode == 0, result.stderr
            result = subprocess.run([binary], capture_output=True, text=True, timeout=30)
    elif shutil.which('docker'):
        result = subprocess.run(['docker', 'run', '--rm', '--mount', f'type=bind,source={SOURCE},target=/src,readonly', 'gcc:14', 'sh', '-c', 'g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=address,undefined -I/src/src /src/src/core.cpp /src/src/sensor_protocol.cpp /src/tests/core_test.cpp -o /tmp/test && /tmp/test'], capture_output=True, text=True, timeout=120)
    else:
        pytest.skip('g++ or Docker gcc:14 is required for firmware tests')
    assert result.returncode == 0, result.stdout + result.stderr
    assert result.stdout.count('PASS ') == 4
