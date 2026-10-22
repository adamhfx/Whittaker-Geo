import json
import threading
import urllib.error
import urllib.request
import uuid

import pytest

from worker.live import (
    LiveError,
    PreviewHTTPServer,
    PreviewService,
    SlidingWindowLimiter,
    _parse_body,
)
from worker.model_preview import PreviewError


SECRET = "local-test-engine-secret-that-is-long-enough"
CALCULATOR = "state-rent"
VERSION = "2.0.0-candidate.1"
SHEET = "Summary OUTPUT"


def manifest():
    return {
        "id": CALCULATOR,
        "version": VERSION,
        "outputs": {"views": [{
            "id": "summary", "label": "Summary", "sheet": SHEET, "sourceRange": "A1:B2",
        }]},
    }


def fake_loader(calculator_id, version, template_path, **kwargs):
    assert calculator_id == CALCULATOR and version == VERSION
    assert kwargs["supabase_url"] == "https://supabase.test"
    assert kwargs["service_key"] == "private-key"
    template_path.write_bytes(b"synthetic template")
    return manifest()


def fake_evaluator(template, model_manifest, inputs, *, timeout, workdir):
    assert template.read_bytes() == b"synthetic template"
    assert inputs == {"field": 42}
    return {
        "calculatorId": CALCULATOR,
        "calculatorVersion": VERSION,
        "outputSheets": [{"name": SHEET, "rows": [{"cells": [
            {"column": 1, "value": "NPV", "format": "General"},
            {"column": 2, "value": 125.5, "format": "$#,##0.0"},
        ]}]}],
        "durationSeconds": 0.025,
    }


def service(**overrides):
    args = dict(
        engine_secret=SECRET,
        supabase_url="https://supabase.test",
        service_key="private-key",
        model_loader=fake_loader,
        evaluator=fake_evaluator,
    )
    args.update(overrides)
    return PreviewService(**args)


def body(requester_id=None):
    return json.dumps({
        "calculatorId": CALCULATOR,
        "version": VERSION,
        "inputs": {"field": 42},
        "requesterId": requester_id or str(uuid.uuid4()),
    }).encode()


def test_request_body_is_exact_and_server_identity_must_be_uuid():
    with pytest.raises(LiveError, match="INVALID_REQUEST"):
        _parse_body(json.dumps({"calculatorId": CALCULATOR, "version": VERSION, "inputs": {}}).encode())
    with pytest.raises(LiveError, match="INVALID_REQUEST"):
        _parse_body(json.dumps({
            "calculatorId": CALCULATOR, "version": VERSION, "inputs": {}, "requesterId": "user-1",
        }).encode())
    with pytest.raises(LiveError, match="REQUEST_TOO_LARGE"):
        _parse_body(b"x" * (64 * 1024 + 1))


def test_service_returns_only_allowlisted_contract_and_rejects_unapproved():
    result = service().evaluate(body())
    assert result == {
        "calculatorId": CALCULATOR,
        "calculatorVersion": VERSION,
        "outputSheets": [{"name": SHEET, "rows": [{"cells": [
            {"column": 1, "value": "NPV", "format": "General"},
            {"column": 2, "value": 125.5, "format": "$#,##0.0"},
        ]}]}],
        "durationSeconds": 0.025,
    }

    def unapproved(*args, **kwargs):
        raise PreviewError("MODEL_UNAVAILABLE")

    with pytest.raises(LiveError) as caught:
        service(model_loader=unapproved).evaluate(body())
    assert (caught.value.status, caught.value.code) == (404, "MODEL_UNAVAILABLE")


def test_service_rejects_unknown_output_mapping_and_bad_result_values():
    def wrong_sheet(*args, **kwargs):
        return {**fake_evaluator(*args, **kwargs), "outputSheets": [{"name": "Internal", "rows": []}]}

    with pytest.raises(LiveError) as caught:
        service(evaluator=wrong_sheet).evaluate(body())
    assert (caught.value.status, caught.value.code) == (502, "CALCULATION_FAILED")

    def nonfinite(*args, **kwargs):
        result = fake_evaluator(*args, **kwargs)
        result["outputSheets"][0]["rows"][0]["cells"][1]["value"] = float("nan")
        return result

    with pytest.raises(LiveError) as caught:
        service(evaluator=nonfinite).evaluate(body())
    assert (caught.value.status, caught.value.code) == (502, "CALCULATION_FAILED")


def test_sliding_window_rate_limit_is_per_requester():
    limiter = SlidingWindowLimiter(limit=2, window=10)
    assert limiter.allow("first", now=100)
    assert limiter.allow("first", now=101)
    assert not limiter.allow("first", now=102)
    assert limiter.allow("second", now=102)
    assert limiter.allow("first", now=111)


def test_http_entrypoint_requires_secret_and_marks_responses_private():
    svc = service()
    server = PreviewHTTPServer(("127.0.0.1", 0), svc)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    url = f"http://127.0.0.1:{server.server_address[1]}/evaluate"
    try:
        bad = urllib.request.Request(url, data=body(), method="POST", headers={"Content-Type": "application/json"})
        with pytest.raises(urllib.error.HTTPError) as caught:
            urllib.request.urlopen(bad, timeout=2)
        assert caught.value.code == 401

        good = urllib.request.Request(url, data=body(), method="POST", headers={
            "Content-Type": "application/json", "X-GeoFlow-Engine-Secret": SECRET,
        })
        with urllib.request.urlopen(good, timeout=2) as response:
            payload = json.loads(response.read())
            assert response.status == 200
            assert response.headers["Cache-Control"] == "no-store, private"
            assert payload["calculatorVersion"] == VERSION
            assert payload["outputSheets"][0]["name"] == SHEET
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
