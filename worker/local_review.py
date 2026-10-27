"""Owner-only local candidate review. Never binds beyond the loopback interface."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil

from .live import PreviewHTTPServer, PreviewService, SlidingWindowLimiter
from .model_preview import PreviewError
from .warm_office import WarmOffice


def main():
    if os.environ.get('LOCAL_MODEL_REVIEW') != 'true':
        raise SystemExit('Set LOCAL_MODEL_REVIEW=true only for owner review on this computer.')
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description='Review a private candidate on localhost only.')
    parser.add_argument('--manifest', type=Path, default=root/'models/state-rent/2.1.0-candidate.1.json')
    parser.add_argument('--template', type=Path, default=root/'private/models/state-rent/2.1.0-candidate.1.xlsx')
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        raise SystemExit('Choose an unprivileged local port.')
    manifest = json.loads(args.manifest.read_text(encoding='utf-8'))
    template = args.template.resolve()
    if hashlib.sha256(template.read_bytes()).hexdigest() != manifest.get('runtimeSha256', '').lower():
        raise SystemExit('Private candidate checksum does not match its manifest.')
    python_bin = os.environ.get('UNO_PYTHON_BIN')
    if not python_bin:
        raise SystemExit('Configure UNO_PYTHON_BIN with a Python runtime that can import UNO.')
    office = WarmOffice(python_bin, os.environ.get('SOFFICE_BIN', 'soffice'))

    def local_loader(calculator_id, version, target, **unused):
        if calculator_id != manifest['id'] or version != manifest['version']:
            raise PreviewError('MODEL_UNAVAILABLE')
        if hashlib.sha256(template.read_bytes()).hexdigest() != manifest['runtimeSha256'].lower():
            raise PreviewError('MODEL_UNAVAILABLE')
        shutil.copyfile(template, target)
        return manifest

    # No live database calls and no model approval changes. This local-only
    # loader supplies the one explicit candidate selected by the owner.
    service = PreviewService(engine_secret=os.environ.get('CALC_ENGINE_SECRET', ''),
        supabase_url='local-owner-review', service_key='not-used-in-local-review',
        model_loader=local_loader, evaluator=office.evaluate, timeout=24,
        max_concurrency=1, limiter=SlidingWindowLimiter(limit=120))
    server = PreviewHTTPServer(('127.0.0.1', args.port), service)
    print(json.dumps({'event': 'local_model_review_started', 'port': args.port,
                      'modelVersion': manifest['version']}), flush=True)
    try:
        server.serve_forever(poll_interval=.5)
    finally:
        server.server_close()
        office.close()


if __name__ == '__main__':
    main()
