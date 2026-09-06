from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from feature_schema import FEATURE_NAMES, build_training_rows
from modeling import train_and_evaluate


def fetch_measurements(source_url: str, timeout: float = 10.0) -> list[dict[str, Any]]:
    request = Request(source_url, headers={"Accept": "application/json"})
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot fetch history from {source_url}: {exc}") from exc
    if isinstance(payload, dict):
        measurements = payload.get("data")
    else:
        measurements = payload
    if not isinstance(measurements, list):
        raise RuntimeError("history response must contain a data array")
    return measurements


def read_measurements(path: str | Path) -> list[dict[str, Any]]:
    source = Path(path)
    try:
        payload = json.loads(source.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"cannot read input history {source}: {exc}") from exc
    if isinstance(payload, dict):
        payload = payload.get("data")
    if not isinstance(payload, list):
        raise RuntimeError("input history must be a JSON array or an object with data")
    return payload


def save_dataset(rows: list[dict[str, Any]], path: str | Path) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["timestamp", *FEATURE_NAMES, "co2_after_15min"]
    with destination.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "timestamp": row["timestamp"].isoformat(),
                    **row["features"],
                    "co2_after_15min": row["co2_after_15min"],
                }
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train the CO2 forecasting models.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-url", help="Backend history endpoint.")
    source.add_argument("--input-file", help="JSON file with measurements.")
    parser.add_argument("--output-dir", default=os.environ.get("MODEL_DIR", "model"))
    parser.add_argument("--dataset-output", default="data/training_dataset.csv")
    parser.add_argument(
        "--min-rows",
        type=int,
        default=int(os.environ.get("MIN_TRAINING_ROWS", "30")),
    )
    parser.add_argument("--model-version", default=os.environ.get("MODEL_VERSION", "1.0"))
    parser.add_argument("--timeout", type=float, default=10.0)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.min_rows < 2:
        print("--min-rows must be at least 2", file=sys.stderr)
        return 2
    try:
        measurements = (
            fetch_measurements(args.source_url, args.timeout)
            if args.source_url
            else read_measurements(args.input_file)
        )
        rows = build_training_rows(measurements)
        save_dataset(rows, args.dataset_output)
        report = train_and_evaluate(
            rows,
            args.output_dir,
            min_training_rows=args.min_rows,
            model_version=args.model_version,
        )
    except (RuntimeError, ValueError, OSError) as exc:
        print(f"training failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

