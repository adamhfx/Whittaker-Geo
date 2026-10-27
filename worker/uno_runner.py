"""Private stdio worker. Run only with a Python runtime that can import UNO.

No HTTP endpoint and no credentials. The parent owns the isolated office process.
"""
from pathlib import Path
import hashlib
import json
import math
import sys
import time
import traceback
from formula_diagnostics import formula_failure_reason

import uno
from com.sun.star.beans import PropertyValue


def property_value(name, value):
    prop = PropertyValue()
    prop.Name, prop.Value = name, value
    return prop


def presentation_values(document, mapping):
    """Extract only summary cells and explicit numeric chart series ranges."""
    if mapping is None:
        return None
    summary = []
    for item in mapping['summary']:
        source = document.Sheets.getByName(item['sheet'])
        value = source.getCellRangeByName(item['address']).getDataArray()[0][0]
        if value == '' or value is None:
            value = None
        elif isinstance(value, bool):
            value = 'TRUE' if value else 'FALSE'
        elif isinstance(value, float) and not math.isfinite(value):
            raise ArithmeticError('Non-finite summary value')
        elif isinstance(value, (str, int, float)):
            if isinstance(value, str) and len(value) > 500:
                raise ValueError('Summary value too large')
        else:
            raise ValueError('Unsupported summary value type')
        result_item = {'label': item['label'], 'value': value}
        if item.get('section') is not None:
            result_item['section'] = item['section']
        if isinstance(item.get('format'), str) and len(item['format']) <= 200:
            result_item['format'] = item['format']
        if item.get('unit') is not None:
            result_item['unit'] = item['unit']
        summary.append(result_item)

    charts = []
    for chart in mapping['charts']:
        series_results = []
        for item in chart['series']:
            source = document.Sheets.getByName(item['sheet'])
            left, top, right, bottom = item['bounds']
            matrix = source.getCellRangeByPosition(left - 1, top - 1, right - 1, bottom - 1).getDataArray()
            values = []
            for row in matrix:
                for value in row:
                    if value == '' or value is None:
                        values.append(None)
                    elif isinstance(value, bool):
                        raise ArithmeticError('Non-numeric chart value')
                    elif isinstance(value, float) and not math.isfinite(value):
                        raise ArithmeticError('Non-finite chart value')
                    elif isinstance(value, (int, float)):
                        values.append(value)
                    else:
                        raise ArithmeticError('Non-numeric chart value')
            if len(values) != item['length']:
                raise ArithmeticError('Chart range length changed')
            series_results.append({'name': item['name'], 'values': values})
        charts.append({
            'title': chart['title'], 'kind': chart['kind'],
            'categories': list(range(1, chart['pointCount'] + 1)),
            'series': series_results,
        })
    return {'summary': summary, 'charts': charts}


def connect(pipe):
    local = uno.getComponentContext()
    resolver = local.ServiceManager.createInstanceWithContext(
        'com.sun.star.bridge.UnoUrlResolver', local)
    deadline = time.monotonic() + 30
    while True:
        try:
            context = resolver.resolve(f'uno:pipe,name={pipe};urp;StarOffice.ComponentContext')
            return context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', context)
        except Exception:
            if time.monotonic() >= deadline:
                raise
            time.sleep(.05)


def input_feedback_values(document, mapping):
    results = []
    for item in mapping:
        source = document.Sheets.getByName(item['sheet'])
        cell = source.getCellRangeByName(item['cell'])
        if cell.getError():
            raise ArithmeticError('Interim calculation error')
        value = cell.getDataArray()[0][0]
        if value == '' or value is None:
            value = None
        elif isinstance(value, bool):
            value = 'TRUE' if value else 'FALSE'
        elif isinstance(value, float) and not math.isfinite(value):
            raise ArithmeticError('Non-finite interim result')
        elif not isinstance(value, (str, int, float)) or (isinstance(value, str) and len(value) > 500):
            raise ValueError('Invalid interim result')
        results.append({key: item[key] for key in ('id', 'group', 'label', 'format', 'unit') if key in item}
                       | {'value': value})
    return results


def main():
    # This helper switch is set only by WarmOffice's explicit build-smoke
    # option. It is never derived from HTTP/request data.
    diagnostic_synthetic = len(sys.argv) > 2 and sys.argv[2] == '--diagnostic-synthetic'
    desktop = connect(sys.argv[1])
    document = None
    loaded_hash = None
    try:
        for line in sys.stdin:
            if len(line) > 2_000_000:
                raise ValueError('Request too large')
            request = json.loads(line)
            try:
                if loaded_hash != request['cacheKey']:
                    if document:
                        document.close(True)
                    template = Path(request['template'])
                    if hashlib.sha256(template.read_bytes()).hexdigest() != request['sha256']:
                        raise ValueError('Checksum mismatch')
                    document = desktop.loadComponentFromURL(template.resolve().as_uri(), '_blank', 0, (
                        property_value('Hidden', True), property_value('ReadOnly', True),
                        property_value('MacroExecutionMode', 0),  # NEVER_EXECUTE
                        property_value('UpdateDocMode', 0),  # NO_UPDATE: external links never refresh
                    ))
                    if document is None:
                        raise ValueError('Cannot load model')
                    document.enableAutomaticCalculation(False)
                    loaded_hash = request['cacheKey']

                sheet = document.Sheets.getByName(request['inputSheet'])
                # Every request replaces the complete allowed input set. No prior
                # customer's editable values can survive into another evaluation.
                for address, value in request['cells'].items():
                    cell = sheet.getCellRangeByName(address)
                    if cell.getType().value == 'FORMULA':
                        raise ValueError('Input would overwrite a formula')
                    if value is None or value == '':
                        cell.setString('')
                    elif isinstance(value, str):
                        cell.setString(value)
                    elif isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value):
                        # PyUNO's bridge converts Python integers through a C
                        # long, which overflows for valid spreadsheet values
                        # such as 5,000,000,000. Calc stores numeric cell values
                        # as doubles, so pass the same numeric value as float.
                        cell.setValue(float(value))
                    else:
                        raise ValueError('Invalid input')
                document.calculateAll()
                # IFERROR can conceal dependency failures in visible outputs.
                # Query all formula-result errors before accepting any result.
                has_formula_errors = False
                error_formulas = []
                for index in range(document.Sheets.getCount()):
                    error_sheet = document.Sheets.getByIndex(index)
                    failures = error_sheet.queryFormulaCells(4)
                    if failures.getCount():
                        has_formula_errors = True
                        for address in failures.getRangeAddresses():
                            if len(error_formulas) >= 256:
                                break
                            for row in range(address.StartRow, address.EndRow + 1):
                                if len(error_formulas) >= 256:
                                    break
                                for column in range(address.StartColumn, address.EndColumn + 1):
                                    if len(error_formulas) >= 256:
                                        break
                                    error_formulas.append(error_sheet.getCellByPosition(column, row).getFormula())
                if has_formula_errors:
                    failure = ArithmeticError('Formula result error')
                    failure.reason = formula_failure_reason(error_formulas)
                    raise failure

                outputs = []
                for view in request['views']:
                    source = document.Sheets.getByName(view['name'])
                    left, top, right, bottom = view['bounds']
                    values = source.getCellRangeByPosition(left-1, top-1, right-1, bottom-1).getDataArray()
                    rows = []
                    for row in view['rows']:
                        cells = []
                        for info in row['cells']:
                            value = values[row['row']-top][info['column']-left]
                            if value == '' or value is None:
                                continue
                            if isinstance(value, float) and not math.isfinite(value):
                                raise ArithmeticError('Non-finite result')
                            if isinstance(value, bool):
                                value = 'TRUE' if value else 'FALSE'
                            elif not isinstance(value, (str, int, float)):
                                raise ValueError('Unsupported result type')
                            if isinstance(value, str) and len(value) > 10000:
                                raise ValueError('Result too large')
                            cells.append({'column': info['column'], 'value': value, 'format': info['format']})
                        rows.append({'cells': cells})
                    outputs.append({'name': view['name'], 'rows': rows})
                response = {'ok': True, 'outputSheets': outputs}
                if request.get('inputFeedback'):
                    response['inputFeedback'] = input_feedback_values(document, request['inputFeedback'])
                display = presentation_values(document, request.get('presentation'))
                if display is not None:
                    response.update(display)
            except ArithmeticError as error:
                response = {'ok': False, 'code': 'RESULT_INVALID'}
                if getattr(error, 'reason', None) == 'IRR_UNDEFINED':
                    response['reason'] = 'IRR_UNDEFINED'
            except Exception:
                if diagnostic_synthetic:
                    traceback.print_exc(file=sys.stderr)
                if document:
                    try:
                        document.close(True)
                    except Exception:
                        pass
                document, loaded_hash = None, None
                response = {'ok': False, 'code': 'CALCULATION_FAILED'}
            print(json.dumps(response, allow_nan=False, separators=(',', ':')), flush=True)
    finally:
        if document:
            try:
                document.close(True)
            except Exception:
                pass
        try:
            desktop.terminate()
        except Exception:
            pass


if __name__ == '__main__':
    main()
