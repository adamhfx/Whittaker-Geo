"""Values-only, explicitly allowlisted interim results from the input sheet."""
from __future__ import annotations

import re
import math
from typing import Any

from openpyxl.utils.cell import coordinate_to_tuple

MAX_INPUT_FEEDBACK = 150
_CELL = re.compile(r"^[A-Z]{1,3}[1-9][0-9]{0,6}$")
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$")


def feedback_specs(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    # Local import avoids the model-preview/input-feedback import cycle.
    from .model_preview import PreviewError

    raw = manifest.get("inputFeedback", [])
    if not isinstance(raw, list) or len(raw) > MAX_INPUT_FEEDBACK:
        raise PreviewError("OUTPUT_MAPPING_INVALID")
    groups = {item.get("id") for item in manifest.get("groups", []) if isinstance(item, dict)}
    input_cells = {item.get("cell", "").split("!")[-1].replace("$", "").upper()
                   for item in manifest.get("fields", []) if isinstance(item, dict)}
    seen_ids, seen_cells = set(), set()
    specs = []
    for item in raw:
        if not isinstance(item, dict):
            raise PreviewError("OUTPUT_MAPPING_INVALID")
        identity, group, label, cell, unit = (item.get(key) for key in ("id", "group", "label", "cell", "unit"))
        if (not isinstance(identity, str) or not _ID.fullmatch(identity) or identity in seen_ids
                or not isinstance(group, str) or group not in groups
                or not isinstance(label, str) or not label.strip() or len(label) > 160
                or not isinstance(cell, str) or not _CELL.fullmatch(cell) or cell in seen_cells
                or cell in input_cells
                or (unit is not None and (not isinstance(unit, str) or len(unit) > 100))):
            raise PreviewError("OUTPUT_MAPPING_INVALID")
        row, column = coordinate_to_tuple(cell)
        if row > 1000 or column > 500:
            raise PreviewError("OUTPUT_MAPPING_INVALID")
        specs.append({"id": identity, "group": group, "label": label, "cell": cell,
                      **({"unit": unit} if unit is not None else {})})
        seen_ids.add(identity)
        seen_cells.add(cell)
    return specs


def feedback_geometry(workbook: Any, manifest: dict[str, Any]) -> list[dict[str, Any]]:
    from .model_preview import PreviewError, _hidden_columns

    specs = feedback_specs(manifest)
    if not specs:
        return []
    sheet_name = manifest.get("inputSheet", "Inputs")
    if sheet_name not in workbook.sheetnames or workbook[sheet_name].sheet_state != "visible":
        raise PreviewError("OUTPUT_MAPPING_INVALID")
    sheet = workbook[sheet_name]
    hidden = _hidden_columns(sheet)
    for item in specs:
        row, column = coordinate_to_tuple(item["cell"])
        if sheet.row_dimensions[row].hidden or column in hidden:
            raise PreviewError("OUTPUT_MAPPING_INVALID")
        number_format = sheet[item["cell"]].number_format
        item.update({"sheet": sheet_name,
                     "format": number_format if isinstance(number_format, str) and len(number_format) <= 200 else "General"})
    return specs


def serialize_input_feedback(workbook: Any, manifest: dict[str, Any]) -> list[dict[str, Any]]:
    from .model_preview import PreviewError, _json_value

    result = []
    for item in feedback_geometry(workbook, manifest):
        cell = workbook[item["sheet"]][item["cell"]]
        if cell.data_type == "e":
            raise PreviewError("RESULT_INVALID")
        value = _json_value(cell.value)
        if isinstance(value, str) and len(value) > 500:
            raise PreviewError("RESULT_INVALID")
        result.append({key: item[key] for key in ("id", "group", "label", "format", "unit") if key in item}
                      | {"value": value})
    return result


def validate_feedback_result(result: dict[str, Any], manifest: dict[str, Any]) -> list[dict[str, Any]]:
    from .model_preview import PreviewError

    expected = feedback_specs(manifest)
    actual = result.get("inputFeedback", [])
    if not isinstance(actual, list) or len(actual) != len(expected):
        raise PreviewError("RESULT_INVALID")
    clean = []
    for value, spec in zip(actual, expected):
        if not isinstance(value, dict) or value.get("id") != spec["id"]:
            raise PreviewError("RESULT_INVALID")
        item = value.get("value")
        if not (item is None or isinstance(item, str) and len(item) <= 500
                or isinstance(item, (int, float)) and not isinstance(item, bool) and math.isfinite(item)):
            raise PreviewError("RESULT_INVALID")
        number_format = value.get("format")
        if number_format is not None and (not isinstance(number_format, str) or len(number_format) > 200):
            raise PreviewError("RESULT_INVALID")
        clean.append({key: spec[key] for key in ("id", "group", "label", "unit") if key in spec}
                     | {"value": item}
                     | ({"format": number_format} if number_format is not None else {}))
    return clean
