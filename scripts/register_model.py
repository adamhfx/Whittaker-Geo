"""Register a private, immutable calculator candidate through Supabase REST.

Registration never approves a version or changes the active calculator pointer.
Approval and activation are separate, reviewed administrator actions.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit

import requests

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_VERSION = "2.0.0-candidate.1"
MAX_TEMPLATE_BYTES = 20 * 1024 * 1024
IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


class RegistrationError(Exception):
    """A safe-to-display registration failure."""


def _canonical(value: object) -> str:
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError):
        raise RegistrationError("manifest is not valid canonical JSON") from None


def _validate(manifest: object, template: bytes) -> tuple[dict, str, str]:
    if not isinstance(manifest, dict):
        raise RegistrationError("manifest must be a JSON object")
    calculator_id, version = manifest.get("id"), manifest.get("version")
    if not isinstance(calculator_id, str) or not IDENTIFIER.fullmatch(calculator_id):
        raise RegistrationError("manifest calculator identity is invalid")
    if not isinstance(version, str) or not IDENTIFIER.fullmatch(version):
        raise RegistrationError("manifest version is invalid")
    for key in ("name", "description"):
        if not isinstance(manifest.get(key), str) or not manifest[key].strip():
            raise RegistrationError(f"manifest {key} is required")
    digest = hashlib.sha256(template).hexdigest()
    if len(template) > MAX_TEMPLATE_BYTES:
        raise RegistrationError("template exceeds the private storage size limit")
    if manifest.get("runtimeSha256") != digest:
        raise RegistrationError("template checksum does not match manifest")
    _canonical(manifest)
    return manifest, calculator_id, digest


def _base_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        loopback = parsed.hostname in {"localhost", "127.0.0.1", "::1"}
        if (
            parsed.scheme != "https" and not (parsed.scheme == "http" and loopback)
        ) or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError
        if parsed.path not in ("", "/"):
            raise ValueError
    except (TypeError, ValueError):
        raise RegistrationError("SUPABASE_URL must be a bare HTTPS project URL") from None
    return value.rstrip("/")


def _json(response: requests.Response, expected: tuple[int, ...]) -> object:
    if response.status_code not in expected:
        raise RegistrationError("Supabase REST request failed; verify project and service-role configuration")
    try:
        return response.json()
    except ValueError:
        raise RegistrationError("Supabase returned an invalid response") from None


def _rows(response: requests.Response) -> list[dict]:
    payload = _json(response, (200,))
    if not isinstance(payload, list) or any(not isinstance(row, dict) for row in payload):
        raise RegistrationError("Supabase returned an invalid record list")
    return payload


def _headers(service_key: str) -> dict[str, str]:
    result = {"apikey": service_key, "Accept": "application/json"}
    if not service_key.startswith("sb_secret_"):
        result["Authorization"] = f"Bearer {service_key}"
    return result


def _get_version(http, base: str, headers: dict[str, str], calculator_id: str, version: str) -> dict | None:
    rows = _rows(http.get(
        f"{base}/rest/v1/calculator_versions",
        params={
            "select": "calculator_id,version,manifest,template_path,template_sha256,approved",
            "calculator_id": f"eq.{calculator_id}",
            "version": f"eq.{version}",
            "limit": "2",
        }, headers=headers, timeout=(5, 20), allow_redirects=False,
    ))
    if len(rows) > 1:
        raise RegistrationError("version identity is ambiguous in Supabase")
    return rows[0] if rows else None


def _verify_version(row: dict, manifest: dict, template_path: str, digest: str) -> None:
    if (
        row.get("calculator_id") != manifest["id"]
        or row.get("version") != manifest["version"]
        or _canonical(row.get("manifest")) != _canonical(manifest)
        or row.get("template_path") != template_path
        or row.get("template_sha256") != digest
        or not isinstance(row.get("approved"), bool)
    ):
        raise RegistrationError("version already exists with different immutable content")


def _verify_storage(http, base: str, headers: dict[str, str], template_path: str, digest: str) -> None:
    encoded = quote(template_path, safe="/")
    response = http.get(
        f"{base}/storage/v1/object/authenticated/model-templates/{encoded}",
        headers=headers, timeout=(5, 30), allow_redirects=False,
    )
    if response.status_code != 200 or hashlib.sha256(response.content).hexdigest() != digest:
        raise RegistrationError("private template path already contains different or unavailable content")


def storage_conflict(response) -> bool:
    if response.status_code in (409, 412): return True
    if response.status_code != 400: return False
    try:
        payload = response.json()
        return isinstance(payload, dict) and str(payload.get('statusCode')) == '409'
    except (ValueError, TypeError): return False


def register_candidate(
    manifest: object,
    template: bytes,
    supabase_url: str,
    service_key: str,
    *,
    http=requests,
) -> str:
    manifest, calculator_id, digest = _validate(manifest, template)
    if not isinstance(service_key, str) or not service_key.strip():
        raise RegistrationError("SUPABASE_SERVICE_ROLE_KEY is required")
    base = _base_url(supabase_url)
    headers = _headers(service_key)
    template_path = f"{calculator_id}/{manifest['version']}/{digest}.xlsx"

    try:
        calculators = _rows(http.get(
            f"{base}/rest/v1/calculators",
            params={"select": "id,current_version", "id": f"eq.{calculator_id}", "limit": "2"},
            headers=headers, timeout=(5, 20), allow_redirects=False,
        ))
        if len(calculators) != 1:
            raise RegistrationError("target calculator does not exist uniquely; registration will not create or activate it")

        existing = _get_version(http, base, headers, calculator_id, manifest["version"])
        if existing is not None:
            _verify_version(existing, manifest, template_path, digest)
            _verify_storage(http, base, headers, template_path, digest)
            return "verified"

        encoded = quote(template_path, safe="/")
        upload_headers = {
            **headers,
            "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "x-upsert": "false",
        }
        uploaded = http.post(
            f"{base}/storage/v1/object/model-templates/{encoded}",
            data=template, headers=upload_headers, timeout=(5, 60), allow_redirects=False,
        )
        if storage_conflict(uploaded):
            _verify_storage(http, base, headers, template_path, digest)
        elif uploaded.status_code not in (200, 201):
            raise RegistrationError("private template upload failed; verify storage configuration")

        record = {
            "calculator_id": calculator_id,
            "version": manifest["version"],
            "manifest": manifest,
            "template_path": template_path,
            "template_sha256": digest,
            "approved": False,
            "approved_at": None,
        }
        inserted = http.post(
            f"{base}/rest/v1/calculator_versions",
            params={"on_conflict": "calculator_id,version"}, json=record,
            headers={**headers, "Content-Type": "application/json",
                     "Prefer": "resolution=ignore-duplicates,return=minimal"},
            timeout=(5, 20), allow_redirects=False,
        )
        if inserted.status_code not in (200, 201, 204):
            raise RegistrationError("candidate record insert failed; verify database configuration")

        registered = _get_version(http, base, headers, calculator_id, manifest["version"])
        if registered is None:
            raise RegistrationError("candidate registration could not be verified")
        _verify_version(registered, manifest, template_path, digest)
        return "registered"
    except requests.RequestException:
        raise RegistrationError("Supabase REST request failed; verify project connectivity") from None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Register an unapproved private calculator candidate.")
    parser.add_argument("--manifest", type=Path, default=ROOT / "models" / "state-rent" / f"{DEFAULT_VERSION}.json")
    parser.add_argument("--template", type=Path, default=ROOT / "private" / "models" / "state-rent" / f"{DEFAULT_VERSION}.xlsx")
    args = parser.parse_args(argv)
    try:
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        template = args.template.read_bytes()
        result = register_candidate(
            manifest, template, os.environ.get("SUPABASE_URL", ""),
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY", ""),
        )
    except (OSError, json.JSONDecodeError) as error:
        print(f"Could not read candidate files: {error.__class__.__name__}.", file=sys.stderr)
        return 1
    except RegistrationError as error:
        print(str(error), file=sys.stderr)
        return 1
    print(f"Private candidate {result}. Approval and activation remain separate administrator actions.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
