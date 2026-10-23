from worker.formula_diagnostics import formula_failure_reason
from worker.model_preview import PreviewError
from worker.live import LiveError


def test_only_a_direct_failed_irr_call_establishes_the_reason():
    assert formula_failure_reason(["=IRR(A1:A5)"]) == "IRR_UNDEFINED"
    assert formula_failure_reason(["=XIRR(A1:A5;B1:B5)"]) == "IRR_UNDEFINED"
    assert formula_failure_reason(["=IF(A1=0;1/0;IRR(A1:A5))"]) is None
    assert formula_failure_reason(["=Internal!A1", "=1/0"]) is None


def test_unknown_reasons_never_cross_the_public_error_contract():
    assert PreviewError("RESULT_INVALID", reason="private formula").reason is None
    assert LiveError(422, "RESULT_INVALID", reason="IRR_UNDEFINED").reason == "IRR_UNDEFINED"
    assert LiveError(422, "CALCULATION_FAILED", reason="IRR_UNDEFINED").reason is None
