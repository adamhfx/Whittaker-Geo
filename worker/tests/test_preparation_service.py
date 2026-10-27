import hashlib,json,uuid
import pytest
from worker.live import PreviewService,LiveError
from worker.model_preparation import PreparationError
from worker.preparation_service import parse_preparation_request
from worker.preparation_store import PreparationStoreError

ACTOR=str(uuid.uuid4());UPLOAD=str(uuid.uuid4());TOKEN=str(uuid.uuid4());VERSION='release-test-r1'
BYTES=b'synthetic private template';DIGEST=hashlib.sha256(BYTES).hexdigest();SOURCE='a'*64
PATH=f'demo/{VERSION}/{DIGEST}.xlsx'


def manifest():
    return {'id':'demo','version':VERSION,'sourceSha256':SOURCE,'runtimeSha256':DIGEST,
      'fields':[{'id':'value','cell':'A1','label':'Value','type':'number','required':True,'default':1}],
      'outputs':{'views':[{'id':'output','label':'Output','sheet':'Summary OUTPUT','sourceRange':'A1:B2'}]}}


class Store:
    denied=False
    state='ready'
    def __init__(self,*args):pass
    def job(self,upload,actor,token=None):
        assert upload==UPLOAD and actor==ACTOR
        if self.denied:raise PreparationStoreError('Administrator access is required.')
        return {'calculator_id':'demo','sha256':SOURCE},{'state':self.state,'candidate_version':VERSION,'manifest':manifest(),'runtime_path':PATH,'runtime_sha256':DIGEST}
    def download(self,bucket,path,target,digest):
        assert bucket=='model-templates' and path==PATH and digest==DIGEST
        target.write_bytes(BYTES)


def evaluator(path,m,inputs,**kwargs):
    assert path.read_bytes()==BYTES and inputs=={'value':2}
    return {'calculatorId':'demo','calculatorVersion':VERSION,'durationSeconds':.1,
      'outputSheets':[{'name':'Summary OUTPUT','rows':[{'cells':[{'column':1,'value':'Result'},{'column':2,'value':4}]}]}]}


def service(store=Store):
    return PreviewService(engine_secret='test-private-engine-secret-of-at-least-32-characters',supabase_url='https://supabase.test',service_key='private-key',evaluator=evaluator,preparation_store_factory=store)


def request():
    return json.dumps({'uploadId':UPLOAD,'actorId':ACTOR,'version':VERSION,'inputs':{'value':2}}).encode()


def test_private_candidate_review_checks_admin_state_version_and_exact_template():
    app=service()
    assert app.prepare(request(),review=True)['calculatorVersion']==VERSION
    bad=json.loads(request());bad['version']='stale'
    with pytest.raises(LiveError) as caught:app.prepare(json.dumps(bad).encode(),review=True)
    assert caught.value.status==422
    class Denied(Store):denied=True
    with pytest.raises(LiveError):service(Denied).prepare(request(),review=True)
    class Working(Store):state='working'
    with pytest.raises(LiveError):service(Working).prepare(request(),review=True)


def test_preparation_uses_the_same_capacity_slot_as_customer_calculations():
    app=service();assert app._capacity.acquire(blocking=False)
    try:
        with pytest.raises(LiveError) as caught:app.prepare(request(),review=True)
        assert caught.value.code=='ENGINE_BUSY'
    finally:app._capacity.release()
    assert app.prepare(request(),review=True)['calculatorId']=='demo'


def test_prepare_identity_is_strict_and_no_browser_manifest_or_path_is_accepted():
    valid={'uploadId':UPLOAD,'actorId':ACTOR,'leaseToken':TOKEN}
    assert parse_preparation_request(json.dumps(valid).encode())==valid
    with pytest.raises(PreparationError):parse_preparation_request(json.dumps({**valid,'path':'/private/data'}).encode())
    with pytest.raises(PreparationError):parse_preparation_request(json.dumps({**valid,'actorId':'not-a-uuid'}).encode())


def test_invalid_workbook_format_is_terminal_and_parser_details_stay_private(monkeypatch):
    from worker.preparation_service import run_preparation_step
    import worker.preparation_service as preparation
    published=[]
    class InvalidWorkbook(Store):
        def job(self,*args):return {'calculator_id':'demo','base_version':'1.0','storage_path':'source.xlsx','sha256':SOURCE},{'phase':'analyze','candidate_version':VERSION,'mapping':{}}
        def model(self,*args):return {'approved':True,'manifest':{'id':'demo','version':'1.0','runtimeSha256':DIGEST},'template_sha256':DIGEST,'template_path':f'demo/1.0/{DIGEST}.xlsx'}
        def download(self,bucket,path,target,digest):target.write_bytes(BYTES)
        def finish(self,*args):published.append(args);return True
    def invalid(*args):raise ValueError('Private formula and worksheet parser details')
    monkeypatch.setattr(preparation,'inspect_candidate',invalid)
    result=run_preparation_step(InvalidWorkbook(),{'uploadId':UPLOAD,'actorId':ACTOR,'leaseToken':TOKEN},evaluator,lambda *args:None)
    assert result=={'status':'failed'} and published[0][3]=='failed'
    assert 'Private formula' not in json.dumps(published)
    assert 'unsupported' in published[0][4]['error']


def test_new_http_routes_require_the_existing_engine_secret():
    import threading,urllib.request,urllib.error
    from worker.live import PreviewHTTPServer
    app=service();server=PreviewHTTPServer(('127.0.0.1',0),app)
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
        base=f'http://127.0.0.1:{server.server_address[1]}'
        for action in ('prepare','review'):
            with pytest.raises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(urllib.request.Request(base+'/'+action,data=request(),headers={'Content-Type':'application/json'}),timeout=5)
            assert caught.value.code==401
        with urllib.request.urlopen(urllib.request.Request(base+'/review',data=request(),headers={'Content-Type':'application/json','X-GeoFlow-Engine-Secret':'test-private-engine-secret-of-at-least-32-characters'}),timeout=5) as response:
            assert json.load(response)['calculatorVersion']==VERSION
    finally:server.shutdown();server.server_close();thread.join(timeout=5)
