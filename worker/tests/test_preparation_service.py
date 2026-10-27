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
