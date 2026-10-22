import json
from pathlib import Path

import openpyxl
import pytest

from worker.engine import ModelError, extract, inject_inputs, payout_year, run_model, validate_inputs


def manifest():
    return {"fields": [
        {"id": "rate", "label": "Rate", "type": "number", "required": True, "min": 0, "exclusiveMin": 0},
        {"id": "note", "label": "Note", "type": "text", "required": False},
        {"id": "m1", "label": "Completion 1", "type": "milestone", "required": False},
        {"id": "m2", "label": "Completion 2", "type": "milestone", "required": False},
    ]}


@pytest.mark.parametrize(("flows", "expected"), [
    ([-10, -2, -1], None),                 # never recovers
    ([5, -8, 1, 2], 4),                    # initially positive, then deficit
    ([-3, 3], 2),                          # recovery boundary
    ([0, 0, 2], 0),                        # no deficit means no payout period
])
def test_payout_year_edges(flows, expected):
    assert payout_year(flows) == expected


def test_validate_required_zero_and_injection_inputs():
    m = manifest()
    with pytest.raises(ModelError):
        validate_inputs({"rate": 0, "m1": "X", "m2": ""}, m)
    with pytest.raises(ModelError):
        validate_inputs({"rate": 1, "m1": "X", "m2": "", "unknown": 2}, m)
    result = validate_inputs({"rate": 1, "note": "=HYPERLINK(\"https://evil\")", "m1": "X", "m2": ""}, m)
    assert result["note"].startswith("=")


def test_manifest_cross_field_rules_require_matching_units_and_ordered_capacities():
    fields = [
        {"id": "fluid", "label": "Fluid", "type": "select", "required": True, "options": ["Oil", "NG"]},
        {"id": "volume", "label": "Volume unit", "type": "select", "required": True, "options": ["barrels(oil)", "m3(gas)"]},
        {"id": "rate", "label": "Rate unit", "type": "select", "required": True, "options": ["tonnes(oil)", "scf(gas)"]},
        {"id": "gas1", "label": "Gas tier 1", "type": "number", "required": True, "min": 0},
        {"id": "gas2", "label": "Gas tier 2", "type": "number", "required": True, "min": 0},
        {"id": "oil1", "label": "Oil tier 1", "type": "number", "required": True, "min": 0},
        {"id": "oil2", "label": "Oil tier 2", "type": "number", "required": True, "min": 0},
    ]
    m = {"fields": fields, "inputRules": {
        "fluid": {"field": "fluid", "units": ["volume", "rate"]},
        "ascending": [
            {"label": "Gas capacity", "fields": ["gas1", "gas2"]},
            {"label": "Oil capacity", "fields": ["oil1", "oil2"]},
        ],
    }}
    valid = {"fluid": "Oil", "volume": "barrels(oil)", "rate": "tonnes(oil)",
             "gas1": 10, "gas2": 20, "oil1": 30, "oil2": 40}
    assert validate_inputs(valid, m) == valid
    with pytest.raises(ModelError, match="Unit selection"):
        validate_inputs({**valid, "rate": "scf(gas)"}, m)
    with pytest.raises(ModelError, match="strictly increasing"):
        validate_inputs({**valid, "gas2": 10}, m)


def test_new_output_view_manifest_dispatches_to_mapped_saved_run(tmp_path, monkeypatch):
    expected = {"calculatorId": "new-model", "outputSheets": []}
    called = {}

    def fake_saved(template, model_manifest, inputs, output):
        called.update(template=template, manifest=model_manifest, inputs=inputs, output=output)
        return expected

    monkeypatch.setattr("worker.model_preview.run_saved_model", fake_saved)
    model_manifest = {"inputSheet": "UI", "outputs": {"views": [{"sheet": "Visible OUTPUT"}]}}
    result = run_model(tmp_path / "private.xlsx", model_manifest, {"field": 7}, tmp_path / "result.xlsx")
    assert result is expected
    assert called == {
        "template": tmp_path / "private.xlsx", "manifest": model_manifest,
        "inputs": {"field": 7}, "output": tmp_path / "result.xlsx",
    }


def test_inject_inputs_never_overwrites_formula(tmp_path):
    source = tmp_path / "template.xlsx"
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Inputs"
    ws["A1"] = "safe"
    ws["B1"] = "=1+1"
    wb.save(source)
    with pytest.raises(ModelError, match="formula"):
        inject_inputs(source, tmp_path / "out.xlsx", {"A1": "=literal", "B1": 4})
    inject_inputs(source, tmp_path / "out.xlsx", {"A1": "=literal"})
    check = openpyxl.load_workbook(tmp_path / "out.xlsx", data_only=False)
    assert check["Inputs"]["A1"].value == "=literal"
    assert check["Inputs"]["A1"].data_type == "s"


def test_extract_normalizes_blank_late_capex_only():
    class Cell:
        def __init__(self, value=1):
            self.value, self.data_type = value, 'n'
    class Sheet:
        def __init__(self, cash=False):
            self.cash = cash; self.cells = {}
        def __getitem__(self, address):
            if address not in self.cells:
                col=''.join(x for x in address if x.isalpha()); row=int(''.join(x for x in address if x.isdigit()))
                value=1
                if self.cash and col == 'W' and row >= 35: value=None
                if self.cash and address == 'AL44': value=10
                if self.cash and address == 'AN44': value=20
                if self.cash and address == 'AL41': value=5
                if self.cash and address == 'W41': value=100
                if self.cash and address == 'AL52': value=.1
                self.cells[address]=Cell(value)
            return self.cells[address]
        def __setitem__(self, address, value): self.cells[address] = value if isinstance(value, Cell) else Cell(value)
        def __iter__(self): return iter(())
    class Book:
        def __init__(self): self.sheets={'CashFlowSummStRnt':Sheet(True),'DashboardStRnt':Sheet()}
        def __getitem__(self, name): return self.sheets[name]
    result=extract(Book())
    assert result['annual'][-1]['capex'] == 0
