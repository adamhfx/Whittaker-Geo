from __future__ import annotations

from copy import deepcopy
import hashlib
import sys
import types
import unittest


try:
    import requests  # noqa: F401
except ModuleNotFoundError:
    requests_stub = types.ModuleType("requests")

    class RequestException(Exception):
        pass

    requests_stub.RequestException = RequestException
    sys.modules["requests"] = requests_stub

from scripts.register_model import RegistrationError, register_candidate


TEMPLATE = b"private workbook bytes"
CHECKSUM = hashlib.sha256(TEMPLATE).hexdigest()
MANIFEST = {
    "id": "state-rent",
    "version": "2.0.0-candidate.1",
    "name": "Resource-to-Value Economic Model",
    "description": "A reviewed model candidate.",
    "runtimeSha256": CHECKSUM,
    "fields": [{"id": "state-rent@2.0.0-candidate.1:ui!k8"}],
}
CALCULATOR = {
    "id": "state-rent",
    "current_version": "1.0.0-candidate.1",
}


class FakeResponse:
    def __init__(self, status_code=200, payload=None, content=b""):
        self.status_code = status_code
        self._payload = payload
        self.content = content

    def json(self):
        return deepcopy(self._payload)


class FakeSupabase:
    def __init__(self, *, calculators=None, versions=None, objects=None):
        self.calculators = deepcopy(calculators if calculators is not None else [CALCULATOR])
        self.versions = deepcopy(versions or [])
        self.objects = dict(objects or {})
        self.get_calls = []
        self.post_calls = []

    def get(self, url, *, params=None, headers=None, timeout=None, allow_redirects=True):
        self.get_calls.append((url, deepcopy(params), deepcopy(headers)))
        if "/rest/v1/calculators" in url:
            calculator_id = params["id"].removeprefix("eq.")
            return FakeResponse(
                payload=[row for row in self.calculators if row["id"] == calculator_id]
            )
        if "/rest/v1/calculator_versions" in url:
            calculator_id = params["calculator_id"].removeprefix("eq.")
            version = params["version"].removeprefix("eq.")
            return FakeResponse(
                payload=[
                    row for row in self.versions
                    if row["calculator_id"] == calculator_id and row["version"] == version
                ]
            )
        marker = "/storage/v1/object/authenticated/model-templates/"
        if marker in url:
            path = url.split(marker, 1)[1]
            if path not in self.objects:
                return FakeResponse(status_code=404)
            return FakeResponse(content=self.objects[path])
        raise AssertionError(f"Unexpected GET URL: {url}")

    def post(self, url, *, params=None, json=None, data=None, headers=None, timeout=None, allow_redirects=True):
        self.post_calls.append((url, deepcopy(params), deepcopy(headers)))
        marker = "/storage/v1/object/model-templates/"
        if marker in url:
            path = url.split(marker, 1)[1]
            if path in self.objects:
                return FakeResponse(status_code=409)
            self.objects[path] = data
            return FakeResponse(status_code=200)
        if "/rest/v1/calculator_versions" in url:
            if not any(
                row["calculator_id"] == json["calculator_id"]
                and row["version"] == json["version"]
                for row in self.versions
            ):
                self.versions.append(deepcopy(json))
            return FakeResponse(status_code=201)
        raise AssertionError(f"Unexpected POST URL: {url}")


class RegistrationTests(unittest.TestCase):
    def test_registers_unapproved_candidate_without_changing_current_version(self):
        supabase = FakeSupabase()

        result = register_candidate(
            MANIFEST, TEMPLATE, "https://project.supabase.co", "service-role", http=supabase
        )

        self.assertEqual(result, "registered")
        self.assertEqual(supabase.calculators, [CALCULATOR])
        self.assertEqual(len(supabase.versions), 1)
        self.assertIs(supabase.versions[0]["approved"], False)
        self.assertIsNone(supabase.versions[0]["approved_at"])
        self.assertEqual(supabase.versions[0]["manifest"], MANIFEST)
        self.assertTrue(
            any("calculator_versions" in call[0] for call in supabase.post_calls)
        )


    def test_idempotent_rerun_checks_content_and_preserves_approval(self):
        template_path = f"state-rent/{MANIFEST['version']}/{CHECKSUM}.xlsx"
        existing = {
            "calculator_id": MANIFEST["id"],
            "version": MANIFEST["version"],
            "manifest": MANIFEST,
            "template_path": template_path,
            "template_sha256": CHECKSUM,
            "approved": True,
        }
        supabase = FakeSupabase(
            versions=[existing],
            objects={template_path: TEMPLATE},
        )

        result = register_candidate(
            MANIFEST, TEMPLATE, "https://project.supabase.co", "service-role", http=supabase
        )

        self.assertEqual(result, "verified")
        self.assertEqual(supabase.versions, [existing])
        self.assertEqual(supabase.calculators, [CALCULATOR])
        self.assertFalse(
            any("calculator_versions" in call[0] for call in supabase.post_calls)
        )


    def test_same_checksum_with_changed_manifest_fails_before_storage_write(self):
        template_path = f"state-rent/{MANIFEST['version']}/{CHECKSUM}.xlsx"
        changed_manifest = {**MANIFEST, "description": "Different mappings or presentation."}
        existing = {
            "calculator_id": MANIFEST["id"],
            "version": MANIFEST["version"],
            "manifest": changed_manifest,
            "template_path": template_path,
            "template_sha256": CHECKSUM,
            "approved": False,
        }
        supabase = FakeSupabase(versions=[existing])

        with self.assertRaisesRegex(RegistrationError, "different immutable content"):
            register_candidate(
                MANIFEST,
                TEMPLATE,
                "https://project.supabase.co",
                "service-role",
                http=supabase,
            )

        self.assertEqual(supabase.post_calls, [])
        self.assertEqual(supabase.calculators, [CALCULATOR])

    def test_checksum_mismatch_fails_before_any_http_request(self):
        invalid_manifest = {**MANIFEST, "runtimeSha256": "0" * 64}
        supabase = FakeSupabase()

        with self.assertRaisesRegex(RegistrationError, "checksum does not match"):
            register_candidate(
                invalid_manifest,
                TEMPLATE,
                "https://project.supabase.co",
                "service-role",
                http=supabase,
            )

        self.assertEqual(supabase.get_calls, [])
        self.assertEqual(supabase.post_calls, [])

    def test_unknown_calculator_is_rejected_without_creating_or_uploading_it(self):
        supabase = FakeSupabase(calculators=[])

        with self.assertRaisesRegex(RegistrationError, "target calculator does not exist"):
            register_candidate(
                MANIFEST,
                TEMPLATE,
                "https://project.supabase.co",
                "service-role",
                http=supabase,
            )

        self.assertEqual(supabase.versions, [])
        self.assertEqual(supabase.objects, {})
        self.assertEqual(supabase.post_calls, [])


if __name__ == "__main__":
    unittest.main()
