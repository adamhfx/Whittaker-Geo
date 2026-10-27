import hashlib,io,json,queue,tempfile
from pathlib import Path
from types import SimpleNamespace
from worker.warm_office import WarmOffice


def test_warm_document_owns_its_template_and_cleans_previous_model_copy(tmp_path,monkeypatch):
    office=WarmOffice('unused','unused')
    output=io.StringIO();messages=queue.Queue()
    def start():
        if office._folder is None:
            office._folder=tempfile.TemporaryDirectory(dir=tmp_path)
            office._helper=SimpleNamespace(stdin=output,poll=lambda:0)
            office._messages=messages
    monkeypatch.setattr(office,'_start',start)
    monkeypatch.setattr(office,'_output_geometry',lambda *args:{'views':[],'presentation':None,'inputFeedback':[]})
    manifest={'id':'test','version':'1.0','inputSheet':'UI','fields':[{'id':'input','cell':'A1','label':'Input','type':'number','required':True,'default':1}]}
    def evaluate(data):
        with tempfile.TemporaryDirectory(dir=tmp_path) as request_folder:
            original=Path(request_folder)/'runtime.xlsx';original.write_bytes(data)
            manifest['runtimeSha256']=hashlib.sha256(data).hexdigest()
            messages.put(json.dumps({'ok':True,'outputSheets':[]}))
            office.evaluate(original,manifest,{'input':2})
            payload=json.loads(output.getvalue().splitlines()[-1])
            cached=Path(payload['template'])
            assert cached!=original and cached.read_bytes()==data
            assert original.read_bytes()==data
        assert not original.exists() and cached.exists()
        return cached
    try:
        first=evaluate(b'first immutable workbook')
        assert evaluate(b'first immutable workbook')==first
        second=evaluate(b'second immutable workbook')
        assert second!=first and not first.exists()
        owned=Path(office._folder.name)
    finally:office.close()
    assert not owned.exists()
