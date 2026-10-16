"""Ambiguous transport retries preserve telemetry identity and do not hide rejection."""
import importlib.util
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError
from urllib.request import Request

import pytest

spec = importlib.util.spec_from_file_location('browser_fixture', Path(__file__).resolve().parents[1] / 'browser/device_fixture.py')
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


def test_timeout_retries_identical_request():
    request = Request('http://127.0.0.1/telemetry', data=b'{"sequence":3}')
    response = MagicMock()
    response.__enter__.return_value.status = 201
    with patch.object(fixture, 'urlopen', side_effect=[TimeoutError(), response]) as send:
        fixture.deliver(request)
    assert send.call_count == 2
    assert all(call.args[0] is request for call in send.call_args_list)


def test_http_rejection_is_not_retried():
    with patch.object(fixture, 'urlopen', side_effect=HTTPError('http://127.0.0.1', 422, 'Rejected', {}, None)) as send:
        with pytest.raises(HTTPError): fixture.deliver(Request('http://127.0.0.1'))
    assert send.call_count == 1


def test_transport_failure_remains_bounded():
    with patch.object(fixture, 'urlopen', side_effect=TimeoutError()) as send:
        with pytest.raises(TimeoutError): fixture.deliver(Request('http://127.0.0.1'))
    assert send.call_count == 3
