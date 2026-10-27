"""Numerical evidence for a private candidate; never an automatic approval."""
from __future__ import annotations

import copy
import math
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

import openpyxl

from .engine import validate_inputs, ModelError
from .input_feedback import serialize_input_feedback
from .model_preparation import PreparationError, _scalar, NS, REL
from .model_preview import _views, _presentation_specs, serialize_output_sheets, serialize_presentation


def defaults(manifest: dict) -> dict:
    return {field['id']: field['default'] for field in manifest['fields']}


def scenario_inputs(manifest: dict, scenario: dict) -> dict:
    values = defaults(manifest)
    by_cell = {field['cell'].upper(): field['id'] for field in manifest['fields']}
    changes = scenario.get('changes')
    if not isinstance(changes, dict) or len(changes) > 500:
        raise PreparationError('A test scenario has invalid input changes.')
    for cell, value in changes.items():
        if not isinstance(cell, str) or cell.upper() not in by_cell:
            raise PreparationError('A test scenario refers to an unmapped input cell.')
        values[by_cell[cell.upper()]] = _scalar(value)
    try: validate_inputs(values, manifest)
    except ModelError as error:
        # Engine input validation contains only safe field labels, no formulas.
        raise PreparationError('Review the test scenario inputs: ' + str(error)) from None
    return values


def validation_scenarios(manifest: dict, mapping: dict) -> list[dict]:
    requested = mapping.get('testCases')
    if requested is not None:
        if not isinstance(requested, list) or not 1 <= len(requested) <= 8:
            raise PreparationError('Define between one and eight representative test scenarios.')
        cases = []
        for item in requested:
            if not isinstance(item, dict) or not isinstance(item.get('name'), str) or not 1 <= len(item['name']) <= 120:
                raise PreparationError('Each test scenario needs a short name.')
            scenario_inputs(manifest, item)
            cases.append({'name': item['name'], 'changes': copy.deepcopy(item['changes'])})
        return cases

    cases = []
    by_id = {field['id']: field for field in manifest['fields']}
    multiplier_ids = manifest.get('multipliers', [])
    for key in list(dict.fromkeys(multiplier_ids[:1] + multiplier_ids[-1:])):
        field = by_id.get(key)
        if not field or field['type'] != 'number' or not isinstance(field['default'], (float, int)) or field['default'] == 0:
            continue
        case = {'name': f"10% higher {field['label'].lower()}", 'changes': {field['cell']: field['default'] * 1.1}}
        try: scenario_inputs(manifest, case)
        except PreparationError: continue
        cases.append(case)
    for field in manifest['fields']:
        if field['type'] != 'select' or len(field.get('options', [])) != 2 or field.get('dependsOn'):
            continue
        alternative = next((value for value in field['options'] if value != field['default']), None)
        if alternative is None: continue
        changes = {field['cell']: alternative}
        for dependent in manifest['fields']:
            if dependent.get('dependsOn') == field['id']:
                options = dependent.get('optionsByDependencyValue', {}).get(str(alternative), [])
                if options: changes[dependent['cell']] = options[0]
        case = {'name': f"{field['label']}: {alternative}", 'changes': changes}
        try: scenario_inputs(manifest, case)
        except PreparationError: continue
        cases.append(case)
        if len(cases) >= 6: break
    if not cases:
        for field in manifest['fields']:
            value = field.get('default')
            if field['type'] != 'number' or field.get('integer') or not isinstance(value, (float, int)) or value == 0:
                continue
            case = {'name': f"Changed {field['label'].lower()}", 'changes': {field['cell']: value * 1.05}}
            try: scenario_inputs(manifest, case)
            except PreparationError: continue
            cases.append(case)
            break
    if not cases:
        raise PreparationError('Define at least one representative changed-input scenario before validation.')
    return cases[:8]


def compare_values(actual, expected, *, relative=1e-8, absolute=1e-5) -> dict:
    differences = []
    count = 0
    numeric = 0

    def compare(left, right, location):
        nonlocal count, numeric
        if isinstance(right, dict):
            if not isinstance(left, dict) or set(left) != set(right):
                differences.append({'location': location, 'reason': 'Result structure differs.'});return
            for key in right: compare(left[key], right[key], location + '.' + str(key))
        elif isinstance(right, list):
            if not isinstance(left, list) or len(left) != len(right):
                differences.append({'location': location, 'reason': 'Result length differs.'});return
            for index, (a, b) in enumerate(zip(left, right)): compare(a, b, location + '.' + str(index))
        else:
            count += 1
            if isinstance(left, (float, int)) and not isinstance(left, bool) and isinstance(right, (float, int)) and not isinstance(right, bool):
                numeric += 1
                same = math.isfinite(left) and math.isfinite(right) and math.isclose(left, right, rel_tol=relative, abs_tol=absolute)
            else: same = type(left) == type(right) and left == right
            if not same and len(differences) < 20:
                differences.append({'location': location, 'expected': str(right)[:200], 'actual': str(left)[:200]})

    compare(actual, expected, 'result')
    return {'passed': not differences, 'comparedValues': count, 'numericValues': numeric,
            'relativeTolerance': relative, 'absoluteTolerance': absolute, 'differences': differences[:20]}


def result_values(result: dict) -> dict:
    return {key: result[key] for key in ('outputSheets', 'summary', 'charts', 'inputFeedback') if key in result}


def source_reference(source: Path, manifest: dict) -> tuple[dict, int]:
    book = openpyxl.load_workbook(source, data_only=True, keep_links=False)
    try:
        reference = {'outputSheets': serialize_output_sheets(book, manifest), **serialize_presentation(book, manifest)}
        feedback = serialize_input_feedback(book, manifest)
        if feedback: reference['inputFeedback'] = feedback
    finally: book.close()
    views = _views(manifest)
    ranges: dict[str, list[tuple]] = {}
    for view in views: ranges.setdefault(view['sheet'], []).append(view['bounds'])
    presentation = _presentation_specs(manifest)
    if presentation:
        for item in presentation['summary']:
            row, column = openpyxl.utils.coordinate_to_tuple(item['valueCell'])
            ranges.setdefault(item['sheet'], []).append((column, row, column, row))
        for chart in presentation['charts']:
            for series in chart['series']: ranges.setdefault(series['sheet'], []).append(series['bounds'])
    for item in manifest.get('inputFeedback', []):
        row, column = openpyxl.utils.coordinate_to_tuple(item['cell'])
        ranges.setdefault(manifest['inputSheet'], []).append((column, row, column, row))
    checked = 0
    with zipfile.ZipFile(source) as archive:
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        rels = {item.attrib['Id']: item.attrib['Target'] for item in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        for sheet in workbook.find('m:sheets', NS):
            sheet_name = sheet.attrib['name']
            if sheet_name not in ranges: continue
            target = rels[sheet.attrib[REL]]
            path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            document = ET.fromstring(archive.read(path))
            for cell in document.findall('.//m:sheetData/m:row/m:c', NS):
                if cell.find('m:f', NS) is None: continue
                row, column = openpyxl.utils.coordinate_to_tuple(cell.attrib['r'])
                if not any(left <= column <= right and top <= row <= bottom for left, top, right, bottom in ranges[sheet_name]): continue
                value = cell.find('m:v', NS)
                if value is None or (value.text is None and cell.attrib.get('t') != 'str'):
                    raise PreparationError('Saved Excel results are missing. Recalculate and save the original workbook in Excel, then upload it again.')
                checked += 1
    if checked == 0:
        raise PreparationError('No saved Excel formula results were available for an independent baseline comparison.')
    return reference, checked


def baseline_comparison(source: Path, manifest: dict, result: dict) -> dict:
    expected, formula_count = source_reference(source, manifest)
    check = compare_values(result_values(result), expected)
    check.update({'name': 'Saved Excel baseline comparison', 'cachedFormulaCells': formula_count,
                  'reference': 'Values cached in the submitted Excel workbook; not a fresh Excel scenario recalculation.'})
    return check
