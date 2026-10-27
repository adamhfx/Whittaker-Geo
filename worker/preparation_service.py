"""One bounded admin preparation step using the existing calculation slot."""
from __future__ import annotations

import json
import tempfile
import uuid
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

from .export_evaluation import export_evaluation
from .model_preparation import PreparationError, inspect_candidate, prepare_runtime
from .model_preview import PreviewError, inspect_preview_export, _views
from .preparation_validation import defaults, result_values, compare_values, validation_scenarios, scenario_inputs, baseline_comparison

LIMITATIONS=['Baseline comparison uses saved Excel values. Fresh Excel recalculation parity for changed-input scenarios remains unverified. Automated scenarios are runtime checks and require administrator numerical review.']


def parse_preparation_request(raw: bytes, *, review=False) -> dict:
    try:body=json.loads(raw)
    except (ValueError,UnicodeDecodeError):raise PreparationError('Invalid preparation request.') from None
    allowed={'uploadId','actorId','version','inputs'} if review else {'uploadId','actorId','leaseToken'}
    if not isinstance(body,dict) or set(body)!=allowed:raise PreparationError('Invalid preparation request.')
    try:
        for key in ('uploadId','actorId') if review else ('uploadId','actorId','leaseToken'):
            body[key]=str(uuid.UUID(body[key]))
    except (ValueError,TypeError,AttributeError):raise PreparationError('Invalid preparation identity.') from None
    if review and (not isinstance(body['version'],str) or len(body['version'])>100 or not isinstance(body['inputs'],dict) or len(body['inputs'])>500):
        raise PreparationError('Invalid candidate input snapshot.')
    return body


def run_preparation_step(store, request: dict, evaluator, validate_result) -> dict:
    upload_id,actor,token=request['uploadId'],request['actorId'],request['leaseToken']
    upload,job=store.job(upload_id,actor,token)
    with tempfile.TemporaryDirectory(prefix='geoflow-model-prepare-') as folder:
        work=Path(folder);source=work/'source.xlsx';runtime=work/'runtime.xlsx'
        try:
            if job['phase']=='analyze':
                store.download('model-templates',upload['storage_path'],source,upload['sha256'])
                base=store.model(upload['calculator_id'],upload['base_version'])
                if base.get('approved') is not True:raise PreparationError('The selected base model is no longer approved.')
                if (base['manifest'].get('runtimeSha256')!=base['template_sha256'] or base['manifest'].get('id')!=upload['calculator_id']
                    or base['manifest'].get('version')!=upload['base_version'] or base['template_path']!=f"{upload['calculator_id']}/{upload['base_version']}/{base['template_sha256']}.xlsx"):
                    raise PreparationError('The base model checksum is invalid.')
                previous=work/'base.xlsx'
                store.download('model-templates',base['template_path'],previous,base['template_sha256'])
                manifest,report=inspect_candidate(source,previous,base['manifest'],job['candidate_version'],job['mapping'])
                data={'manifest':manifest,'mappingReport':report}
                if report['issues']:
                    store.finish(upload_id,actor,token,'mapping_required',data)
                    return {'status':'mapping_required'}
                prepared=prepare_runtime(source,runtime,manifest['inputSheet'])
                manifest['runtimeSha256']=prepared['runtimeSha256']
                path=f"{upload['calculator_id']}/{job['candidate_version']}/{prepared['runtimeSha256']}.xlsx"
                store.upload('model-templates',path,runtime.read_bytes())
                data.update({'manifest':manifest,'runtimePath':path,'runtimeSha256':prepared['runtimeSha256'],
                             'scenarios':validation_scenarios(manifest,job['mapping']),
                             'validations':{'preparation':{'passed':True,'inputCount':len(manifest['fields']),
                                'sourceSha256':upload['sha256'],'runtimeSha256':prepared['runtimeSha256'],
                                'compatibilityRewrites':prepared['compatibilityRewrites']}}})
                store.finish(upload_id,actor,token,'analyzed',data)
                return {'status':'validating'}

            manifest=job['manifest']
            if manifest.get('version')!=job['candidate_version'] or manifest.get('sourceSha256')!=upload['sha256'] or manifest.get('runtimeSha256')!=job['runtime_sha256']:
                raise PreparationError('The prepared workbook identity changed. Run preparation again.')
            expected=f"{upload['calculator_id']}/{job['candidate_version']}/{job['runtime_sha256']}.xlsx"
            if job['runtime_path']!=expected:raise PreparationError('The prepared artifact path is invalid.')
            store.download('model-templates',expected,runtime,job['runtime_sha256'])
            inputs=defaults(manifest)
            if job['phase']=='scenario':
                case=job['scenarios'][job['scenario_index']]
                inputs=scenario_inputs(manifest,case)
            result=validate_result(evaluator(runtime,manifest,inputs,timeout=90,workdir=folder),manifest['id'],manifest['version'],manifest)
            if job['phase']=='baseline':
                store.download('model-templates',upload['storage_path'],source,upload['sha256'])
                check=baseline_comparison(source,manifest,result)
                if not check['passed']:
                    store.finish(upload_id,actor,token,'failed',{'error':'The recalculated baseline differs from the saved Excel results. Review the differences and recalculate/save the source workbook before re-uploading.',
                                  'checks':{'baseline':check},'result':result})
                    return {'status':'failed'}
                store.finish(upload_id,actor,token,'baseline',{'check':check,'result':result})
            elif job['phase']=='scenario':
                check={'passed':True,'name':case['name'],'changes':case['changes'],'durationSeconds':result['durationSeconds'],
                       'summary':result.get('summary',[]),'charts':result.get('charts',[]),
                       'reference':'Runtime health check; not independently compared with recalculated Excel.'}
                store.finish(upload_id,actor,token,'scenario',{'index':job['scenario_index'],'check':check})
            elif job['phase']=='export':
                reset=compare_values(result_values(result),result_values(job['baseline_result']))
                reset['name']='Restored baseline after changed-input scenarios'
                if not reset['passed']:
                    store.finish(upload_id,actor,token,'failed',{'error':'The baseline did not reset after the test scenarios. This candidate cannot be released.','checks':{'reset':reset}})
                    return {'status':'failed'}
                workbook=work/'results.xlsx'
                export_evaluation(runtime,manifest,result,workbook)
                charts=len(manifest.get('presentation',{}).get('charts',[]))
                inspect_preview_export(workbook,[view['sheet'] for view in _views(manifest)],expected_chart_count=charts)
                export_path=f"model-reviews/{upload_id}/{job['candidate_version']}/{token}.xlsx"
                store.upload('calculation-exports',export_path,workbook.read_bytes())
                # The existing immutable registration implementation is included
                # in the image. Registration never sets approval/current state.
                from scripts.register_model import register_candidate, RegistrationError
                try:register_candidate(manifest,runtime.read_bytes(),store.base,store.key)
                except RegistrationError:
                    raise PreparationError('The immutable candidate registration could not be verified. Retry preparation; existing releases are unchanged.') from None
                store.finish(upload_id,actor,token,'complete',{'reset':reset,'export':{'passed':True,'tabs':len(result['outputSheets']),'charts':charts,'bytes':workbook.stat().st_size},
                    'exportPath':export_path,'limitations':LIMITATIONS})
                return {'status':'ready'}
            else:raise PreparationError('The preparation step is no longer valid.')
            return {'status':'validating'}
        except (PreparationError,PreviewError) as error:
            if isinstance(error,PreviewError):
                message='The workbook produced an unsupported or undefined calculation result. Review its formulas and the current test scenario.'
            else:message=str(error)
            store.finish(upload_id,actor,token,'failed',{'error':message})
            return {'status':'failed'}
        except (ValueError,TypeError,KeyError,zipfile.BadZipFile,ET.ParseError):
            # Invalid workbook structures and unsupported chart references are
            # terminal review issues, not a sleeping-service retry. Never expose
            # parser text, which can contain formulas or private sheet content.
            store.finish(upload_id,actor,token,'failed',{'error':'The workbook structure or a mapping is unsupported. Reset the cell mapping and retry, or correct the source workbook and upload it again. Changed formulas, worksheet names or chart references may need developer review.'})
            return {'status':'failed'}


def evaluate_candidate(store, request: dict, evaluator, validate_result) -> dict:
    upload,job=store.job(request['uploadId'],request['actorId'])
    if job['state'] not in {'ready','approved','failed'} or not job.get('manifest') or not job.get('runtime_path'):
        raise PreparationError('Finish candidate preparation before trying a scenario.')
    if request['version']!=job['candidate_version']:
        raise PreparationError('The candidate changed. Reload this review before calculating.')
    manifest=job['manifest']
    if manifest.get('sourceSha256')!=upload['sha256'] or manifest.get('runtimeSha256')!=job['runtime_sha256']:
        raise PreparationError('The candidate workbook identity is invalid.')
    expected=f"{upload['calculator_id']}/{job['candidate_version']}/{job['runtime_sha256']}.xlsx"
    if job['runtime_path']!=expected:raise PreparationError('The candidate artifact path is invalid.')
    with tempfile.TemporaryDirectory(prefix='geoflow-model-review-') as folder:
        path=Path(folder)/'runtime.xlsx'
        store.download('model-templates',expected,path,job['runtime_sha256'])
        return validate_result(evaluator(path,manifest,request['inputs'],timeout=90,workdir=folder),manifest['id'],manifest['version'],manifest)
