import json
from http.client import HTTPConnection

from app import RequestHandler


def test_error_payload_is_serializable():
    payload = {"error": {"code": "model_unavailable", "message": "not ready"}}

    assert json.loads(json.dumps(payload)) == payload
    assert RequestHandler.server_version == "AirQualityML/1.0"

