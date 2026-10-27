"""Bounded private LibreOffice process with complete-input reset per request."""
from __future__ import annotations
import atexit
import hashlib
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time
import uuid

import openpyxl

from .model_preview import (PreviewError, _hidden_columns, _input_cells,
                            _presentation_specs, _views, normalize_model_inputs)
from .input_feedback import feedback_geometry, feedback_specs


class WarmOffice:
    def __init__(self, python_bin: str, soffice_bin: str, *, diagnostic_synthetic=False):
        self.python_bin = python_bin
        self.soffice_bin = soffice_bin
        # Opt-in diagnostics are reserved for the build-time synthetic runtime
        # fixture. Production callers leave this false; request data cannot set it.
        self.diagnostic_synthetic = diagnostic_synthetic
        self._lock = threading.RLock()
        self._office = self._helper = None
        self._folder = None
        self._messages = None
        self._geometry = None
        self._geometry_hash = None
        atexit.register(self.close)

    def close(self):
        with self._lock:
            # EOF lets the UNO helper close its document and terminate Calc
            # cleanly, releasing the profile before its temporary directory is
            # removed. Force-kill only processes that do not stop in time.
            if self._helper and self._helper.poll() is None:
                try:
                    self._helper.stdin.close()
                    self._helper.wait(timeout=10)
                except (OSError, subprocess.TimeoutExpired):
                    self._terminate(self._helper)
            if self._office and self._office.poll() is None:
                try:
                    self._office.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self._terminate(self._office)
            self._helper = self._office = self._messages = None
            if self._folder:
                self._folder.cleanup()
                self._folder = None

    @staticmethod
    def _terminate(process):
        if process.poll() is not None:
            return
        if os.name == 'nt':
            subprocess.run(['taskkill.exe', '/PID', str(process.pid), '/T', '/F'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           creationflags=subprocess.CREATE_NO_WINDOW)
        else:
            import signal
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass

    def _start(self):
        if self._helper and self._helper.poll() is None and self._office and self._office.poll() is None:
            return
        self.close()
        self._folder = tempfile.TemporaryDirectory(prefix='whittaker-office-')
        pipe = 'whittaker_' + uuid.uuid4().hex
        process_options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}
        self._office = subprocess.Popen([
            self.soffice_bin, '--headless', '--nologo', '--nodefault', '--norestore',
            '-env:UserInstallation=' + Path(self._folder.name).as_uri(),
            '--accept=pipe,name=' + pipe + ';urp;StarOffice.ServiceManager',
        ], stdout=None if self.diagnostic_synthetic else subprocess.DEVNULL,
           stderr=None if self.diagnostic_synthetic else subprocess.DEVNULL,
           **process_options)
        helper_command = [
            self.python_bin, str(Path(__file__).with_name('uno_runner.py')), pipe,
        ]
        if self.diagnostic_synthetic:
            helper_command.append('--diagnostic-synthetic')
        self._helper = subprocess.Popen(
            helper_command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            stderr=None if self.diagnostic_synthetic else subprocess.DEVNULL,
           text=True, encoding='utf-8', bufsize=1, **process_options)
        messages = self._messages = queue.Queue(maxsize=2)
        stream = self._helper.stdout
        def read_messages():
            try:
                for line in stream:
                    if len(line) > 2_000_000:
                        messages.put(None)
                        return
                    messages.put(line)
            finally:
                try:
                    messages.put_nowait(None)
                except queue.Full:
                    pass
        threading.Thread(target=read_messages, daemon=True).start()

    def _output_geometry(self, template, manifest, digest):
        # Cache only immutable display geometry, never customer inputs/results.
        presentation_specs = _presentation_specs(manifest)
        geometry_key = (
            digest,
            json.dumps(_views(manifest), sort_keys=True),
            json.dumps(presentation_specs, sort_keys=True),
            json.dumps(feedback_specs(manifest), sort_keys=True),
        )
        if self._geometry_hash == geometry_key:
            return self._geometry
        workbook = openpyxl.load_workbook(template, data_only=False)
        try:
            views = []
            for view in _views(manifest):
                sheet = workbook[view['sheet']]
                if sheet.sheet_state != 'visible':
                    raise PreviewError('OUTPUT_MAPPING_INVALID')
                left, top, right, bottom = view['bounds']
                hidden = _hidden_columns(sheet)
                rows = []
                for row in range(top, bottom+1):
                    if sheet.row_dimensions[row].hidden:
                        continue
                    rows.append({'row': row, 'cells': [
                        {'column': col, 'format': sheet.cell(row, col).number_format}
                        for col in range(left, right+1) if col not in hidden
                    ]})
                views.append({'name': view['sheet'], 'bounds': view['bounds'], 'rows': rows})
            presentation = None
            if presentation_specs is not None:
                presentation = {'summary': [], 'charts': []}
                for item in presentation_specs['summary']:
                    sheet = workbook[item['sheet']]
                    row, column = openpyxl.utils.cell.coordinate_to_tuple(item['valueCell'])
                    if sheet.row_dimensions[row].hidden or column in _hidden_columns(sheet):
                        raise PreviewError('OUTPUT_MAPPING_INVALID')
                    if item['labelCell'] is not None:
                        label_row, label_column = openpyxl.utils.cell.coordinate_to_tuple(item['labelCell'])
                        if sheet.row_dimensions[label_row].hidden or label_column in _hidden_columns(sheet):
                            raise PreviewError('OUTPUT_MAPPING_INVALID')
                    presentation['summary'].append({
                        'section': item['section'], 'label': item['label'],
                        'sheet': item['sheet'], 'address': item['valueCell'],
                        'unit': item['unit'], 'format': sheet[item['valueCell']].number_format,
                    })
                for chart in presentation_specs['charts']:
                    presentation['charts'].append({
                        'title': chart['title'], 'kind': chart['kind'],
                        'sheet': chart['sheet'], 'anchor': chart['anchor'],
                        'anchorBounds': chart['anchorBounds'],
                        'pointCount': chart['pointCount'],
                        'series': [{
                            'name': series['name'], 'sheet': series['sheet'],
                            'bounds': series['bounds'], 'length': series['length'],
                        } for series in chart['series']],
                    })
            feedback = feedback_geometry(workbook, manifest)
        finally:
            workbook.close()
        geometry = {'views': views, 'presentation': presentation, 'inputFeedback': feedback}
        self._geometry_hash, self._geometry = geometry_key, geometry
        return geometry

    def evaluate(self, template, manifest, inputs, *, timeout=25, workdir=None):
        normalized = normalize_model_inputs(inputs, manifest)
        input_sheet, cells = _input_cells(manifest, normalized)
        digest = hashlib.sha256(Path(template).read_bytes()).hexdigest()
        if digest != manifest.get('runtimeSha256', '').lower():
            raise PreviewError('MODEL_UNAVAILABLE')
        started = time.monotonic()
        with self._lock:
            geometry = self._output_geometry(template, manifest, digest)
            views = geometry['views']
            self._start()
            try:
                self._helper.stdin.write(json.dumps({
                    'template': str(Path(template).resolve()), 'sha256': digest,
                    # Reuse the loaded UNO document across edits, but reload it
                    # when the immutable workbook or its model/input mapping
                    # changes. Output geometry is cached separately below.
                    'cacheKey': hashlib.sha256(json.dumps([
                        digest, manifest['id'], manifest['version'], input_sheet,
                        sorted(cells),
                    ], sort_keys=True).encode()).hexdigest(),
                    'inputSheet': input_sheet, 'cells': cells, 'views': views,
                    'presentation': geometry['presentation'],
                    'inputFeedback': geometry['inputFeedback'],
                }, allow_nan=False) + '\n')
                self._helper.stdin.flush()
                message = self._messages.get(timeout=timeout)
                if message is None:
                    raise ValueError('Engine stopped')
                result = json.loads(message)
                if result.get('ok') is not True:
                    raise PreviewError('RESULT_INVALID' if result.get('code') == 'RESULT_INVALID' else 'CALCULATION_FAILED', reason=result.get('reason'))
                response = {'calculatorId': manifest['id'], 'calculatorVersion': manifest['version'],
                            'outputSheets': result['outputSheets'],
                            'durationSeconds': round(time.monotonic()-started, 4)}
                if geometry['presentation'] is not None:
                    response.update({
                        'summary': result['summary'],
                        'charts': result['charts'],
                    })
                if geometry['inputFeedback']:
                    response['inputFeedback'] = result['inputFeedback']
                return response
            except PreviewError:
                raise
            except Exception:
                self.close()
                raise PreviewError('CALCULATION_FAILED') from None
