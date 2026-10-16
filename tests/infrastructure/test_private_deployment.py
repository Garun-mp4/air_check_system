"""Secrets must stay private even when a write or atomic replacement fails."""
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'deploy' / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@unittest.skipIf(os.name == 'nt', 'POSIX permissions are verified on Linux')
class PrivateDeploymentTests(unittest.TestCase):
    def test_interrupted_secret_replacement_keeps_all_copies_private(self):
        prepare = load('prepare_env')
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'installation.env'
            prepare.prepare(path)
            lines = path.read_text().splitlines()
            path.write_text('\n'.join('ML_MANAGEMENT_TOKEN=' if line.startswith('ML_MANAGEMENT_TOKEN=') else line for line in lines))
            original = path.read_bytes()
            with patch.object(prepare.os, 'replace', side_effect=OSError('simulated replacement failure')):
                with self.assertRaises(OSError):
                    prepare.prepare(path, fill_missing=True)
            self.assertEqual(path.read_bytes(), original)
            for item in Path(folder).iterdir():
                self.assertEqual(stat.S_IMODE(item.stat().st_mode), 0o600, item.name)

    def test_interrupted_backup_is_private_before_any_contents_are_written(self):
        backup = load('backup')
        with tempfile.TemporaryDirectory() as folder:
            env_file = Path(folder) / 'installation.env'
            env_file.write_text('SYNTHETIC_TEST_VALUE=private-fixture\n')
            destination = Path(folder) / 'partial.zip'
            with patch.object(backup, 'run', return_value=b'synthetic dump'), patch.object(backup.zipfile.ZipFile, 'writestr', side_effect=OSError('simulated disk full')):
                with self.assertRaises(OSError):
                    backup.create(destination, env_file, 'aircheck-private-test')
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)


if __name__ == '__main__':
    unittest.main()
