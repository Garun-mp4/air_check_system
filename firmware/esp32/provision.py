"""Create an NVS image locally; never print credentials or flash a board implicitly."""
import argparse
import csv
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import sys
import tempfile
from urllib.parse import urlparse


def validate(config, folder):
    limits = {'ssid': 32, 'password': 64, 'server': 255, 'device_id': 80, 'token': 256}
    result = {}
    for key, maximum in limits.items():
        value = config.get(key)
        if not isinstance(value, str) or not value or len(value.encode('utf-8')) > maximum or '\0' in value:
            raise ValueError(f'Invalid {key}: expected a nonempty UTF-8 string up to {maximum} bytes')
        result[key] = value
    if len(result['password']) < 8 or len(result['token']) < 32:
        raise ValueError('Password must have at least 8 characters and device token at least 32')
    parsed = urlparse(result['server'])
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('', '/'):
        raise ValueError('server must be an HTTPS origin without credentials or path')
    result['server'] = result['server'].rstrip('/')
    ntp_server = config.get('ntp_server', parsed.hostname)
    if not isinstance(ntp_server, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,255}', ntp_server):
        raise ValueError('ntp_server must be a hostname or IP address')
    result['ntp_server'] = ntp_server
    if not re.fullmatch(r'[A-Za-z0-9_-]+', result['device_id']):
        raise ValueError('Invalid device_id')
    ca_file = config.get('ca_file')
    if not isinstance(ca_file, str) or not ca_file:
        raise ValueError('ca_file must point to the installation root PEM certificate')
    certificate = (folder / ca_file).resolve().read_text(encoding='ascii')
    if len(certificate.encode()) >= 4096:
        raise ValueError('Root PEM is too large')
    try:
        ssl.PEM_cert_to_DER_cert(certificate)
        ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT).load_verify_locations(cadata=certificate)
    except (ValueError, ssl.SSLError):
        raise ValueError('Root PEM is not a certificate') from None
    result['root_ca'] = certificate
    commissioned = config.get('commissioned', False)
    if not isinstance(commissioned, bool):
        raise ValueError('commissioned must be a boolean')
    result['commissioned'] = int(commissioned)
    sd_enabled = config.get('sd_enabled', False)
    if not isinstance(sd_enabled, bool): raise ValueError('sd_enabled must be a boolean')
    result['sd_enabled'] = int(sd_enabled)
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True, help='Private local JSON, kept outside Git')
    parser.add_argument('--idf', type=Path, required=True, help='ESP-IDF framework directory')
    parser.add_argument('--out', type=Path, default=Path(__file__).parent / '.pio/provision/nvs.bin')
    args = parser.parse_args()
    try:
        values = validate(json.loads(args.config.read_text(encoding='utf-8')), args.config.parent)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        if args.out.exists():
            raise ValueError('Output already exists; choose a new path')
        generator = args.idf / 'components/nvs_flash/nvs_partition_generator/nvs_partition_gen.py'
        if not generator.is_file():
            raise ValueError('NVS generator not found in --idf')
        with tempfile.TemporaryDirectory(prefix='aircheck-provision-') as folder:
            csv_path = Path(folder) / 'nvs.csv'
            with csv_path.open('w', encoding='utf-8', newline='') as stream:
                writer = csv.writer(stream)
                writer.writerow(['key', 'type', 'encoding', 'value'])
                writer.writerow(['aircheck', 'namespace', '', ''])
                for key, value in values.items():
                    writer.writerow([key, 'data', 'u8' if key in ('commissioned', 'sd_enabled') else 'string', value])
            # The IDF environment supplies cryptography used by its NVS generator.
            run = subprocess.run([sys.executable, str(generator), 'generate', str(csv_path), str(args.out.resolve()), '0x6000'], capture_output=True, text=True, timeout=30)
            if run.returncode:
                args.out.unlink(missing_ok=True)
                raise ValueError('NVS generation failed; use the ESP-IDF Python environment')
        if args.out.stat().st_size != 0x6000:
            args.out.unlink(missing_ok=True)
            raise ValueError('Unexpected NVS image size')
        if os.name != 'nt':
            args.out.chmod(0o600)
        print(f'NVS image created: {args.out.resolve()} (contains private configuration)')
    except (ValueError, OSError, subprocess.SubprocessError):
        # Parser/SDK exceptions can contain input values. Keep credentials out of logs.
        print('Provisioning failed: check private JSON fields, PEM, output path and ESP-IDF Python environment.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
