from __future__ import annotations

import hmac
import json
import logging
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from feature_schema import FeatureError
from predict import ModelUnavailableError, Predictor
from jobs import ModelJobs, BusyError


LOGGER = logging.getLogger("ml-service")
MODEL_PATH = os.environ.get("MODEL_PATH", "model/model.joblib")
MODEL_VERSION = os.environ.get("MODEL_VERSION", "1.0")
MAX_BODY_BYTES = 1_048_576
JOBS = None

def model_jobs():
    global JOBS
    if JOBS is None:
        JOBS = ModelJobs(MODEL_PATH, int(os.environ.get("MIN_TRAINING_ROWS", "30")))
    return JOBS
PREDICTOR = Predictor(MODEL_PATH, MODEL_VERSION)


def error_payload(code: str, message: str) -> dict[str, Any]:
    return {"error": {"code": code, "message": message}}


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "AirQualityML/1.0"

    def _write_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def _management_auth(self):
        expected = os.environ.get('ML_MANAGEMENT_TOKEN','').strip()
        actual = self.headers.get('Authorization','').removeprefix('Bearer ')
        if len(expected)<32 or not hmac.compare_digest(actual,expected):
            self._write_json(HTTPStatus.UNAUTHORIZED,error_payload('unauthorized','Management authorization required'))
            return False
        return True

    def do_GET(self) -> None:
        if self.path == '/management/status':
            if self._management_auth():
                self._write_json(HTTPStatus.OK,{'model':PREDICTOR.info(),**model_jobs().status()})
            return
        if self.path == "/healthz":
            self._write_json(HTTPStatus.OK, {"status": "ok", "model": PREDICTOR.info()})
            return
        if self.path == "/model/info":
            self._write_json(HTTPStatus.OK, PREDICTOR.info())
            return
        self._write_json(
            HTTPStatus.NOT_FOUND,
            error_payload("not_found", "Route not found"),
        )

    def do_POST(self) -> None:
        if self.path in ('/management/train','/management/rollback','/management/readiness'):
            if not self._management_auth(): return
            try:
                if self.path.endswith('/rollback'):
                    self._write_json(HTTPStatus.OK,model_jobs().rollback()); return
                length = int(self.headers.get('Content-Length','0'))
                if not 0<length<=10_485_760: raise ValueError('Request too large or empty')
                payload = json.loads(self.rfile.read(length))
                if self.path.endswith('/readiness'):
                    from readiness import dataset_readiness
                    self._write_json(HTTPStatus.OK, dataset_readiness(payload.get('measurements', []), payload.get('source'), payload.get('horizon_minutes', 15))); return
                job = model_jobs().submit(payload.get('measurements'),payload.get('source'),horizon_minutes=payload.get('horizon_minutes',15))
                self._write_json(HTTPStatus.ACCEPTED,job)
            except BusyError as exc:
                self._write_json(HTTPStatus.CONFLICT,error_payload('training_busy',str(exc)))
            except (ValueError,TypeError,AttributeError) as exc:
                self._write_json(HTTPStatus.BAD_REQUEST,error_payload('invalid_training_request',str(exc)))
            except Exception:
                LOGGER.exception('model management failed')
                self._write_json(HTTPStatus.INTERNAL_SERVER_ERROR,error_payload('management_error','Не удалось изменить модель; действующая модель сохранена'))
            return
        if self.path != "/predict":
            self._write_json(
                HTTPStatus.NOT_FOUND,
                error_payload("not_found", "Route not found"),
            )
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY_BYTES:
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                error_payload("invalid_request", "Request body is empty or too large"),
            )
            return
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                error_payload("invalid_json", "Request body must be valid JSON"),
            )
            return
        try:
            result = PREDICTOR.predict(payload)
        except FeatureError as exc:
            self._write_json(
                HTTPStatus.BAD_REQUEST,
                error_payload("validation_error", str(exc)),
            )
            return
        except ModelUnavailableError as exc:
            self._write_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                error_payload("model_unavailable", str(exc)),
            )
            return
        except Exception:
            LOGGER.exception("prediction failed")
            self._write_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                error_payload("prediction_error", "Не удалось построить прогноз"),
            )
            return
        self._write_json(HTTPStatus.OK, result)

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.address_string(), format % args)


def main() -> None:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    port = int(os.environ.get("ML_PORT", "8000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), RequestHandler)
    LOGGER.info("ML service listening on 0.0.0.0:%s; model=%s", port, MODEL_PATH)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOGGER.info("stopping ML service")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

