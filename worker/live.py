"""Authenticated HTTP entrypoint for stateless transient spreadsheet previews.

Each request reloads a fresh approval record and immutable private template from
Supabase, verifies the workbook checksum, recalculates it in a temporary
LibreOffice profile, and returns only explicitly mapped visible output ranges.
"""
from __future__ import annotations

from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import base64
import hmac
import json
import math
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

from .model_preview import (
    MAX_OUTPUT_CELLS,
    PreviewError,
    _presentation_specs,
    _views,
    evaluate_template,
    load_approved_model,
)

MAX_REQUEST_BYTES = 64 * 1024
MAX_RESPONSE_BYTES = 2_000_000
RATE_WINDOW_SECONDS = 60.0
RATE_LIMIT_PER_USER = 30
MAX_TRACKED_USERS = 4096


class LiveError(Exception):
    def __init__(self, status: int, code: str, reason: str | None = None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.reason = reason if code == "RESULT_INVALID" and reason == "IRR_UNDEFINED" else None


class SlidingWindowLimiter:
    def __init__(self, limit: int = RATE_LIMIT_PER_USER, window: float = RATE_WINDOW_SECONDS):
        self.limit = limit
        self.window = window
        self._calls: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, requester_id: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        with self._lock:
            # Prune expired users as well as expired calls. The latter alone
            # leaves one empty deque per historical requester indefinitely.
            for key, recent_calls in list(self._calls.items()):
                while recent_calls and now - recent_calls[0] >= self.window:
                    recent_calls.popleft()
                if not recent_calls:
                    del self._calls[key]
            calls = self._calls.get(requester_id)
            if calls is None:
                if len(self._calls) >= MAX_TRACKED_USERS:
                    return False
                calls = self._calls[requester_id] = deque()
            if len(calls) >= self.limit:
                return False
            calls.append(now)
            return True


def _parse_body(raw: bytes) -> tuple[str, str, dict[str, Any], str]:
    if not raw or len(raw) > MAX_REQUEST_BYTES:
        raise LiveError(413, "REQUEST_TOO_LARGE")
    try:
        body = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise LiveError(400, "INVALID_REQUEST") from None
    if not isinstance(body, dict) or set(body) != {"calculatorId", "version", "inputs", "requesterId"}:
        raise LiveError(400, "INVALID_REQUEST")
    calculator_id, version, inputs, requester_id = (
        body.get("calculatorId"), body.get("version"), body.get("inputs"), body.get("requesterId")
    )
    if (
        not isinstance(calculator_id, str) or not 1 <= len(calculator_id) <= 100
        or not isinstance(version, str) or not 1 <= len(version) <= 100
        or not isinstance(inputs, dict) or len(inputs) > 500
        or not isinstance(requester_id, str)
    ):
        raise LiveError(400, "INVALID_REQUEST")
    try:
        requester_id = str(uuid.UUID(requester_id))
    except (ValueError, AttributeError):
        raise LiveError(400, "INVALID_REQUEST") from None
    return calculator_id, version, inputs, requester_id


def _validate_result(result: Any, calculator_id: str, version: str, manifest: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(result, dict):
        raise LiveError(502, "CALCULATION_FAILED")
    sheets = result.get("outputSheets")
    views = _views(manifest)
    expected_names = [view["sheet"] for view in views]
    if (
        result.get("calculatorId") != calculator_id
        or result.get("calculatorVersion") != version
        or not isinstance(result.get("durationSeconds"), (int, float))
        or isinstance(result.get("durationSeconds"), bool)
        or not math.isfinite(result["durationSeconds"])
        or result["durationSeconds"] < 0
        or not isinstance(sheets, list)
        or [sheet.get("name") if isinstance(sheet, dict) else None for sheet in sheets] != expected_names
    ):
        raise LiveError(502, "CALCULATION_FAILED")
    total_cells = 0
    for sheet in sheets:
        rows = sheet.get("rows")
        if not isinstance(rows, list) or len(rows) > 1000:
            raise LiveError(502, "CALCULATION_FAILED")
        for row in rows:
            if not isinstance(row, dict) or not isinstance(row.get("cells"), list) or len(row["cells"]) > 500:
                raise LiveError(502, "CALCULATION_FAILED")
            total_cells += len(row["cells"])
            for cell in row["cells"]:
                if not isinstance(cell, dict):
                    raise LiveError(502, "CALCULATION_FAILED")
                column, value = cell.get("column"), cell.get("value")
                if (
                    not isinstance(column, int) or isinstance(column, bool) or not 1 <= column <= 500
                    or not (value is None or isinstance(value, str) and len(value) <= 10_000
                            or isinstance(value, (int, float)) and not isinstance(value, bool)
                            and math.isfinite(value))
                    or ("format" in cell and (not isinstance(cell["format"], str) or len(cell["format"]) > 200))
                ):
                    raise LiveError(502, "CALCULATION_FAILED")
    if total_cells > MAX_OUTPUT_CELLS:
        raise LiveError(502, "CALCULATION_FAILED")
    presentation_specs = _presentation_specs(manifest)
    presentation_result: dict[str, Any] = {}
    if presentation_specs is None:
        if "summary" in result or "charts" in result:
            raise LiveError(502, "CALCULATION_FAILED")
    else:
        summary = result.get("summary")
        charts = result.get("charts")
        if (
            not isinstance(summary, list) or len(summary) != len(presentation_specs["summary"])
            or not isinstance(charts, list) or len(charts) != len(presentation_specs["charts"])
        ):
            raise LiveError(502, "CALCULATION_FAILED")
        clean_summary = []
        for actual, expected in zip(summary, presentation_specs["summary"]):
            if not isinstance(actual, dict):
                raise LiveError(502, "CALCULATION_FAILED")
            value = actual.get("value")
            if not (
                value is None
                or isinstance(value, str) and len(value) <= 500
                or isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
            ):
                raise LiveError(502, "CALCULATION_FAILED")
            item = {"label": expected["label"], "value": value}
            if expected["section"] is not None:
                item["section"] = expected["section"]
            number_format = actual.get("format")
            if number_format is not None:
                if not isinstance(number_format, str) or len(number_format) > 200:
                    raise LiveError(502, "CALCULATION_FAILED")
                item["format"] = number_format
            if expected["unit"] is not None:
                item["unit"] = expected["unit"]
            clean_summary.append(item)

        clean_charts = []
        for actual, expected in zip(charts, presentation_specs["charts"]):
            categories = actual.get("categories") if isinstance(actual, dict) else None
            series = actual.get("series") if isinstance(actual, dict) else None
            expected_categories = list(range(1, expected["pointCount"] + 1))
            if (
                not isinstance(actual, dict) or actual.get("title") != expected["title"]
                or actual.get("kind") != expected["kind"] or categories != expected_categories
                or not isinstance(series, list) or len(series) != len(expected["series"])
            ):
                raise LiveError(502, "CALCULATION_FAILED")
            clean_series = []
            for actual_series, expected_series in zip(series, expected["series"]):
                values = actual_series.get("values") if isinstance(actual_series, dict) else None
                if (
                    not isinstance(actual_series, dict) or actual_series.get("name") != expected_series["name"]
                    or not isinstance(values, list) or len(values) != expected["pointCount"]
                    or any(value is not None and not (
                        isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
                    ) for value in values)
                ):
                    raise LiveError(502, "CALCULATION_FAILED")
                clean_series.append({"name": expected_series["name"], "values": values})
            clean_charts.append({
                "title": expected["title"],
                "kind": expected["kind"],
                "categories": expected_categories,
                "series": clean_series,
            })
        presentation_result = {"summary": clean_summary, "charts": clean_charts}
    from .input_feedback import validate_feedback_result
    feedback = validate_feedback_result(result, manifest)
    # Emit exactly the public response contract; discard any accidental fields.
    return {
        "calculatorId": calculator_id,
        "calculatorVersion": version,
        "outputSheets": [
            {"name": sheet["name"], "rows": [{"cells": [
                {key: cell[key] for key in ("column", "value", "format") if key in cell}
                for cell in row["cells"]
            ]} for row in sheet["rows"]]}
            for sheet in sheets
        ],
        **presentation_result,
        **({"inputFeedback": feedback} if feedback else {}),
        "durationSeconds": float(result["durationSeconds"]),
    }


class PreviewService:
    def __init__(
        self,
        *,
        engine_secret: str,
        supabase_url: str,
        service_key: str,
        timeout: float = 60,
        max_concurrency: int = 1,
        limiter: SlidingWindowLimiter | None = None,
        model_loader: Callable[..., dict[str, Any]] = load_approved_model,
        evaluator: Callable[..., dict[str, Any]] = evaluate_template,
    ):
        self.secret = engine_secret.encode("utf-8")
        if len(self.secret) < 32:
            raise ValueError("CALC_ENGINE_SECRET must contain at least 32 bytes.")
        if not supabase_url or not service_key:
            raise ValueError("Supabase configuration is required.")
        if not 1 <= max_concurrency <= 4 or not 1 <= timeout <= 120:
            raise ValueError("Preview capacity configuration is outside allowed bounds.")
        self.supabase_url = supabase_url
        self.service_key = service_key
        self.timeout = timeout
        self.limiter = limiter or SlidingWindowLimiter()
        self.model_loader = model_loader
        self.evaluator = evaluator
        self._capacity = threading.BoundedSemaphore(max_concurrency)

    def authenticated(self, provided: str | None) -> bool:
        if not isinstance(provided, str):
            return False
        try:
            return hmac.compare_digest(provided.encode("utf-8"), self.secret)
        except (UnicodeEncodeError, TypeError):
            return False

    def evaluate(self, raw: bytes, *, export: bool = False) -> dict[str, Any]:
        calculator_id, version, inputs, requester_id = _parse_body(raw)
        if not self.limiter.allow(requester_id):
            raise LiveError(429, "RATE_LIMITED")
        if not self._capacity.acquire(blocking=False):
            raise LiveError(503, "ENGINE_BUSY")
        try:
            with __import__("tempfile").TemporaryDirectory(prefix="geoflow-live-") as temp:
                template = Path(temp) / "template.xlsx"
                try:
                    manifest = self.model_loader(
                        calculator_id,
                        version,
                        template,
                        supabase_url=self.supabase_url,
                        service_key=self.service_key,
                    )
                    result = self.evaluator(
                        template,
                        manifest,
                        inputs,
                        timeout=90 if export else self.timeout,
                        workdir=temp,
                    )
                    validated = _validate_result(result, calculator_id, version, manifest)
                    if export:
                        from .export_evaluation import export_evaluation
                        output = Path(temp) / 'result.xlsx'
                        export_evaluation(template, manifest, validated, output)
                        data = output.read_bytes()
                        if len(data) > 1_000_000:
                            raise LiveError(502, "CALCULATION_FAILED")
                        return {"result": validated, "xlsxBase64": base64.b64encode(data).decode('ascii')}
                    return validated
                except PreviewError as exc:
                    status = 404 if exc.code == "MODEL_UNAVAILABLE" else (
                        400 if exc.code in {"INVALID_REQUEST", "OUTPUT_MAPPING_INVALID"} else 422
                    )
                    raise LiveError(status, exc.code, reason=exc.reason) from None
                except LiveError:
                    raise
                except Exception:
                    # Provider errors, formulas, private paths, and exception
                    # text must never cross the HTTP boundary.
                    raise LiveError(502, "CALCULATION_FAILED") from None
        finally:
            self._capacity.release()


class PreviewHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    request_queue_size = 16

    def __init__(self, address: tuple[str, int], service: PreviewService):
        self.service = service
        super().__init__(address, PreviewRequestHandler)


class PreviewRequestHandler(BaseHTTPRequestHandler):
    server: PreviewHTTPServer
    server_version = "GeoFlowPreview"
    sys_version = ""

    def log_message(self, format: str, *args: Any) -> None:
        # Never log request bodies, inputs, credentials, or user identifiers.
        return

    def _respond(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store, private")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._respond(200, {"status": "ok"})
            return
        self._respond(404, {"error": "NOT_FOUND"})

    def do_POST(self) -> None:
        if self.path not in {"/evaluate", "/export"}:
            self._respond(404, {"error": "NOT_FOUND"})
            return
        if not self.server.service.authenticated(self.headers.get("X-GeoFlow-Engine-Secret")):
            self._respond(401, {"error": "UNAUTHORIZED"})
            return
        if self.headers.get("Content-Encoding", "identity").lower() != "identity":
            self._respond(415, {"error": "INVALID_REQUEST"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._respond(411, {"error": "INVALID_REQUEST"})
            return
        if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
            self._respond(413, {"error": "REQUEST_TOO_LARGE"})
            return
        raw = self.rfile.read(content_length)
        if len(raw) != content_length:
            self._respond(400, {"error": "INVALID_REQUEST"})
            return
        try:
            result = self.server.service.evaluate(raw, export=self.path == "/export")
            body = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
            if len(body) > MAX_RESPONSE_BYTES + (1_400_000 if self.path == "/export" else 0):
                self._respond(502, {"error": "CALCULATION_FAILED"})
                return
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store, private")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
        except LiveError as exc:
            self._respond(exc.status, {"error": exc.code, **({"reason": exc.reason} if exc.reason else {})})
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            self._respond(502, {"error": "CALCULATION_FAILED"})


def main() -> None:
    secret = os.environ.get("CALC_ENGINE_SECRET", "")
    url = os.environ.get("SUPABASE_URL", "")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    try:
        timeout = float(os.environ.get("LIVE_EVALUATION_TIMEOUT_SECONDS", "60"))
        concurrency = int(os.environ.get("LIVE_MAX_CONCURRENCY", "1"))
        port = int(os.environ.get("PORT", "8000"))
        office = None
        evaluator = evaluate_template
        if os.environ.get("UNO_PYTHON_BIN"):
            if concurrency != 1:
                raise ValueError("The warm calculation service requires concurrency one.")
            from .warm_office import WarmOffice
            office = WarmOffice(os.environ["UNO_PYTHON_BIN"], os.environ.get("SOFFICE_BIN", "soffice"))
            evaluator = office.evaluate
        service = PreviewService(
            evaluator=evaluator,
            engine_secret=secret,
            supabase_url=url,
            service_key=service_key,
            timeout=timeout,
            max_concurrency=concurrency,
        )
    except (ValueError, TypeError):
        raise SystemExit("Live preview configuration is invalid; the service was not started.") from None
    server = PreviewHTTPServer(("0.0.0.0", port), service)
    print(json.dumps({"event": "preview_service_started", "port": port}), flush=True)
    try:
        server.serve_forever(poll_interval=0.5)
    finally:
        server.server_close()
        if office:
            office.close()


if __name__ == "__main__":
    main()
