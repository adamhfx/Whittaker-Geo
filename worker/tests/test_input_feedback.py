import copy

import openpyxl
import pytest

from worker.input_feedback import feedback_geometry, feedback_specs, serialize_input_feedback, validate_feedback_result
from worker.model_preview import PreviewError


def fixture():
    model = {"inputSheet": "UI", "groups": [{"id": "reservoir"}],
             "fields": [{"id": "volume", "cell": "B2"}],
             "inputFeedback": [{"id": "recoverable", "group": "reservoir",
                                "label": "Recoverable volume", "cell": "C2", "unit": "m³"}]}
    book = openpyxl.Workbook()
    book.active.title = "UI"
    book.active["C2"] = 42
    book.active["C2"].number_format = "#,##0.0"
    return model, book


def test_feedback_is_explicit_values_only_and_does_not_leak_model_geometry():
    model, book = fixture()
    book.active["D2"] = "private-unmapped-value"
    assert serialize_input_feedback(book, model) == [{"id": "recoverable", "group": "reservoir",
        "label": "Recoverable volume", "unit": "m³", "format": "#,##0.0", "value": 42}]
    book.active["C2"] = 84
    assert serialize_input_feedback(book, model)[0]["value"] == 84
    book.active["C2"] = None
    assert serialize_input_feedback(book, model)[0]["value"] is None


@pytest.mark.parametrize("override", [{"cell": "B2"}, {"cell": "MODEL Private!C2"}, {"group": "unknown"},
                                       {"cell": "C1001"}, {"cell": "A0"}, {"label": "x" * 161}])
def test_feedback_rejects_inputs_or_unbounded_and_unknown_mappings(override):
    model, _ = fixture()
    model["inputFeedback"][0].update(override)
    with pytest.raises(PreviewError, match="OUTPUT_MAPPING_INVALID"):
        feedback_specs(model)


def test_hidden_feedback_and_formula_errors_cannot_look_like_healthy_results():
    model, book = fixture()
    book.active.column_dimensions["C"].hidden = True
    with pytest.raises(PreviewError, match="OUTPUT_MAPPING_INVALID"):
        feedback_geometry(book, model)
    book.active.column_dimensions["C"].hidden = False
    book.active["C2"] = "#DIV/0!"
    with pytest.raises(PreviewError, match="RESULT_INVALID"):
        serialize_input_feedback(book, model)
    model["inputFeedback"].append(copy.deepcopy(model["inputFeedback"][0]))
    with pytest.raises(PreviewError, match="OUTPUT_MAPPING_INVALID"):
        feedback_specs(model)


def test_legacy_manifests_have_no_interim_feedback():
    assert feedback_specs({}) == []


def test_http_feedback_is_checked_and_relabelled_using_the_manifest_allowlist():
    model, book = fixture()
    values = serialize_input_feedback(book, model)
    values[0].update({"label": "private accidental label", "cell": "SECRET", "formula": "SECRET"})
    checked = validate_feedback_result({"inputFeedback": values}, model)
    assert checked[0]["label"] == "Recoverable volume"
    assert "SECRET" not in str(checked)
    with pytest.raises(PreviewError, match="RESULT_INVALID"):
        validate_feedback_result({"inputFeedback": []}, model)
    with pytest.raises(PreviewError, match="RESULT_INVALID"):
        validate_feedback_result({"inputFeedback": values}, {})
