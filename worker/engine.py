"""Isolated workbook execution and values-only result extraction."""
from pathlib import Path
import argparse, hashlib, json, math, os, subprocess, tempfile, time, zipfile
import xml.etree.ElementTree as ET
import openpyxl

ROOT=Path(__file__).resolve().parents[1]
NS={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
M='{'+NS['m']+'}'

class ModelError(Exception): pass

def payout_year(cash_flows):
    cumulative=0.; deficit=False
    for year,amount in enumerate(cash_flows,1):
        cumulative+=amount
        if cumulative<0:deficit=True
        if deficit and cumulative>=0:return year
    return None if deficit else 0

def validate_inputs(values,manifest):
    allowed={f['id']:f for f in manifest['fields']}
    if set(values)-set(allowed):raise ModelError('Unknown input fields')
    normalized={}
    for key,f in allowed.items():
        value=values.get(key)
        if value is None or value=='':
            if f['required']:raise ModelError('Missing input: '+f['label'])
            normalized[key]='' if f['type']=='milestone' else 0;continue
        if f['type']=='number':
            if isinstance(value,bool) or not isinstance(value,(float,int)) or not math.isfinite(value):raise ModelError('Invalid number: '+f['label'])
            if 'min' in f and value<f['min'] or 'max' in f and value>f['max']:raise ModelError('Out of range: '+f['label'])
            if 'exclusiveMin' in f and value<=f['exclusiveMin'] or 'exclusiveMax' in f and value>=f['exclusiveMax']:raise ModelError('Out of range: '+f['label'])
            if f.get('integer') and int(value)!=value:raise ModelError('Whole number required: '+f['label'])
        elif f['type']=='select' and value not in f['options']:raise ModelError('Invalid selection: '+f['label'])
        elif f['type']=='milestone' and value not in ('','X'):raise ModelError('Invalid milestone')
        elif not isinstance(value,str) or len(value)>200:raise ModelError('Invalid text')
        normalized[key]=value
    milestones=[f for f in manifest['fields'] if f['type']=='milestone']
    if milestones and sum(normalized.get(f['id'])=='X' for f in milestones)!=1:raise ModelError('Choose exactly one facilities completion year')
    rules=manifest.get('inputRules',{})
    if rules is None:rules={}
    if not isinstance(rules,dict):raise ModelError('Invalid input validation rules')
    fluid=rules.get('fluid')
    if fluid is not None:
        if not isinstance(fluid,dict) or not isinstance(fluid.get('field'),str) or not isinstance(fluid.get('units'),list) or not fluid['units']:
            raise ModelError('Invalid fluid validation rules')
        primary=normalized.get(fluid['field'])
        suffix={'Oil':'(oil)','NG':'(gas)'}.get(primary)
        if suffix is None:raise ModelError('Invalid primary fluid')
        for key in fluid['units']:
            if not isinstance(key,str) or key not in normalized:raise ModelError('Invalid fluid unit mapping')
            value=normalized[key]
            if not isinstance(value,str) or not value.lower().endswith(suffix):
                label=next((f['label'] for f in manifest['fields'] if f['id']==key),key)
                raise ModelError('Unit selection must match '+label+' and the primary fluid')
    ascending=rules.get('ascending',[])
    if not isinstance(ascending,list):raise ModelError('Invalid ordered input rules')
    for rule in ascending:
        if not isinstance(rule,dict) or not isinstance(rule.get('fields'),list) or len(rule['fields'])<2:
            raise ModelError('Invalid ordered input rule')
        keys=rule['fields']
        if any(not isinstance(key,str) or key not in normalized for key in keys):
            raise ModelError('Invalid ordered input mapping')
        values_to_check=[normalized[key] for key in keys]
        if any(isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) for value in values_to_check):
            raise ModelError('Invalid ordered input value')
        if any(left>=right for left,right in zip(values_to_check,values_to_check[1:])):
            label=rule.get('label') if isinstance(rule.get('label'),str) else 'Capacity tiers'
            raise ModelError(label+' must be strictly increasing')
    return normalized

def inject_inputs(template,destination,values,input_sheet: str='Inputs'):
    with zipfile.ZipFile(template) as zin:
        book=ET.fromstring(zin.read('xl/workbook.xml'));rels={r.attrib['Id']:r.attrib['Target'] for r in ET.fromstring(zin.read('xl/_rels/workbook.xml.rels'))}
        s=next((s for s in book.find('m:sheets',NS) if s.attrib['name']==input_sheet),None)
        if s is None:raise ModelError('Input worksheet not found')
        t=rels[s.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']]
        path=t.lstrip('/') if t.startswith('/') else 'xl/'+t
        root=ET.fromstring(zin.read(path));cells={c.attrib['r']:c for c in root.findall('.//m:sheetData/m:row/m:c',NS)}
        for address,value in values.items():
            c=cells.get(address)
            if c is None:raise ModelError('Input mapping mismatch')
            if c.find('m:f',NS) is not None:raise ModelError('Input would overwrite a formula')
            for child in list(c):c.remove(child)
            c.attrib.pop('t',None)
            if isinstance(value,str):
                c.set('t','inlineStr');ET.SubElement(ET.SubElement(c,M+'is'),M+'t').text=value
            else:ET.SubElement(c,M+'v').text=str(value)
        with zipfile.ZipFile(destination,'w',zipfile.ZIP_DEFLATED) as zout:
            for n in zin.namelist():
                data=zin.read(n)
                if n.startswith('xl/worksheets/sheet') and n.endswith('.xml'):
                    sheet=root if n==path else ET.fromstring(data)
                    # XML input edits bypass the spreadsheet engine's dependency
                    # invalidation. Cached formula values must never survive.
                    for cell in sheet.findall('.//m:sheetData/m:row/m:c',NS):
                        if cell.find('m:f',NS) is not None:
                            for cached in cell.findall('m:v',NS)+cell.findall('m:is',NS):cell.remove(cached)
                    data=ET.tostring(sheet,encoding='utf-8',xml_declaration=True)
                zout.writestr(n,data)

def recalculate(template,values,folder,timeout=90,input_sheet: str='Inputs'):
    folder=Path(folder);folder.mkdir(parents=True,exist_ok=True);out=folder/'calculated';out.mkdir();source=folder/'run.xlsx'
    inject_inputs(template,source,values,input_sheet=input_sheet)
    command=[os.environ.get('SOFFICE_BIN','soffice'),'--headless','--nologo','--nodefault','--norestore',f'-env:UserInstallation={(folder/"profile").resolve().as_uri()}','--convert-to','xlsx:Calc MS Excel 2007 XML','--outdir',str(out),str(source)]
    result=subprocess.run(command,capture_output=True,timeout=timeout)
    path=out/'run.xlsx'
    if result.returncode or not path.exists():raise ModelError('Calculation engine failed; no result was published')
    wb=openpyxl.load_workbook(path,data_only=True)
    return path,wb

def finite(value):
    return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value)

def extract(wb):
    cash=wb['CashFlowSummStRnt'];dash=wb['DashboardStRnt'];annual=[]
    for row in range(10,40):
        cells=['N','AL','AM','AN','AO','W','Z','O','Q']
        values=[cash[f'{col}{row}'].value for col in cells]
        # The source intentionally leaves later annual capital-cost cells blank.
        # Excel arithmetic treats these as zero; keep blanks in the XLSX export,
        # and normalize only this documented numeric chart/JSON series.
        if values[5] is None:values[5]=0
        if not all(finite(v) for v in values):raise ModelError('The cash-flow output contains invalid results')
        annual.append(dict(zip(['year','contractor','contractorCumulative','state','stateCumulative','capex','opex','gas','oil'],values)))
    payout=payout_year([r['contractor'] for r in annual])
    cash['AL57']=payout if payout is not None else 'Not reached';dash['W30']=cash['AL57'].value
    metrics={'contractorNpv10':cash['AL44'].value,'stateNpv10':cash['AN44'].value,'contractorCashFlow':cash['AL41'].value,'capitalInvestment':cash['W41'].value,'irr':cash['AL52'].value,'payoutYear':payout}
    has_signs=any(r['contractor']<0 for r in annual) and any(r['contractor']>0 for r in annual)
    if not has_signs and metrics['irr'] in ['#NUM!','#VALUE!','#DIV/0!']:
        metrics['irr']=None
        for sn,addr in [('CashFlowSummStRnt','AL52'),('DashboardStRnt','W21'),('DashboardStRnt','D34')]:wb[sn][addr]='Not defined'
    for key,val in metrics.items():
        if key not in ('payoutYear','irr') and not finite(val):raise ModelError('A summary metric did not calculate')
    if metrics['irr'] is not None and not finite(metrics['irr']):raise ModelError('IRR did not converge')
    # Undefined ratios are allowed only when their actual denominator is zero.
    for addr,den in [('W28',cash['W41'].value),('W29',cash['W41'].value),('W35',(cash['AL44'].value or 0)+(cash['AN44'].value or 0)),('W36',(cash['AL41'].value or 0)+(cash['AN41'].value or 0))]:
        if den==0 and dash[addr].data_type=='e':dash[addr]='Not defined'
    for sn in ['CashFlowSummStRnt','DashboardStRnt']:
        for row in wb[sn]:
            for c in row:
                if c.data_type=='e':raise ModelError(f'Unresolved result error in {sn} {c.coordinate}')
    return {'metrics':metrics,'annual':annual}

def run_model(template,manifest,inputs,output,with_sensitivity=True):
    outputs=manifest.get('outputs')
    if isinstance(outputs,dict) and isinstance(outputs.get('views'),list):
        from .model_preview import PreviewError, run_saved_model
        try:
            return run_saved_model(template,manifest,inputs,output)
        except PreviewError as exc:
            raise ModelError(exc.code) from None
    from .exporter import export_results, inspect_export
    values=validate_inputs(inputs,manifest)
    if hashlib.sha256(Path(template).read_bytes()).hexdigest()!=manifest['runtimeSha256']:raise ModelError('Runtime model checksum does not match its version')
    started=time.monotonic()
    with tempfile.TemporaryDirectory(prefix='modeldesk-') as temp:
        base_path,wb=recalculate(template,values,Path(temp)/'baseline')
        result=extract(wb);baseline=result['metrics']['contractorNpv10'];sensitivity=[]
        for key in manifest['multipliers'] if with_sensitivity else []:
            item={'input':key,'label':next(f['label'] for f in manifest['fields'] if f['id']==key),'baseline':baseline}
            for scale,name in [(0.5,'low'),(1.5,'high')]:
                scenario={**values,key:values[key]*scale}
                _,variant=recalculate(template,scenario,Path(temp)/(key+name));item[name]=extract(variant)['metrics']['contractorNpv10']
            sensitivity.append(item)
        result.update(sensitivity=sensitivity,calculatorId=manifest['id'],calculatorVersion=manifest['version'])
        export_results(wb,result,output);inspect_export(output)
    result['durationSeconds']=round(time.monotonic()-started,3)
    return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,default=ROOT/'models/state-rent/1.0.0-candidate.1.json');p.add_argument('--template',type=Path,default=ROOT/'private/models/state-rent/1.0.0-candidate.1.xlsx');p.add_argument('--inputs',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--skip-sensitivity',action='store_true');a=p.parse_args();m=json.loads(a.manifest.read_text());inputs=json.loads(a.inputs.read_text()) if a.inputs else {f['id']:f['default'] for f in m['fields']};r=run_model(a.template,m,inputs,a.output,not a.skip_sensitivity);a.output.with_suffix('.json').write_text(json.dumps(r,indent=2));print(json.dumps({'ok':True,'durationSeconds':r['durationSeconds']}))
