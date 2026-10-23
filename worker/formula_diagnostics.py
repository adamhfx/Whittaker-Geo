"""Allowlisted mathematical categories; never serialize formula text or addresses."""
import re

_DIRECT_IRR = re.compile(r"^\s*=\s*(?:(?:_xlfn|COM\.MICROSOFT)\.)?(?:IRR|XIRR)\s*\(", re.I)


def formula_failure_reason(formulas):
    # A direct failed IRR call is evidence of an undefined IRR. Merely finding
    # IRR inside an unselected IF branch would not establish that cause.
    return "IRR_UNDEFINED" if any(isinstance(f, str) and _DIRECT_IRR.match(f) for f in formulas) else None
