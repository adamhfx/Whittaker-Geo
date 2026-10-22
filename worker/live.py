"""Authenticated HTTP entrypoint for stateless transient spreadsheet previews.

Each request reloads a fresh approval record and immutable private template from
Supabase, verifies the workbook checksum, recalculates it in a temporary
LibreOffice profile, and returns only explicitly mapped visible output ranges.
"""
from __future__ import annotations

from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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
    def __init__(self, status: int, code: str):
        super().__init__(code)
        self.status = status
        self.code = code


class SlidingWindowLimiter:
    def __init__(self, limit: int = RATE_LIMIT_PER_USER, window: float = RATE_WINDOW_SECONDS):
        self.limit = limit
        self.window = window
        self._calls: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def allow(self, requester_id: str, now: float | None = None) -> bool:
        now = time.monotonic() if now is None else now
        with self._lock:
            calls = self._calls.setdefault(requester_id, deque())
            while calls and now - calls[0] >= self.window:
                calls.popleft()
            if len(calls) >= self.limit:
                return False
            calls.append(now)
            if len(self._calls) > MAX_TRACKED_USERS:
                for key in list(self._calls):
                    if not self._calls[key]:
                        del self._calls[key]
                        if len(self._calls) <= MAX_TRACKED_USERS:
                            break
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

    def evaluate(self, raw: bytes) -> dict[str, Any]:
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
                        timeout=self.timeout,
                        workdir=temp,
                    )
                    return _validate_result(result, calculator_id, version, manifest)
                except PreviewError as exc:
                    status = 404 if exc.code == "MODEL_UNAVAILABLE" else (
                        400 if exc.code in {"INVALID_REQUEST", "OUTPUT_MAPPING_INVALID"} else 422
                    )
                    raise LiveError(status, exc.code) from None
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
        self._respond(404, {"error": "NOT_FOUND"})

    def do_POST(self) -> None:
        if self.path != "/evaluate":
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
            result = self.server.service.evaluate(raw)
            body = json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")
            if len(body) > MAX_RESPONSE_BYTES:
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
            self._respond(exc.status, {"error": exc.code})
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
        service = PreviewService(
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


if __name__ == "__main__":
    main()
