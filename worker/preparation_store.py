"""Server-only private storage and fenced preparation publication."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.parse import quote
from datetime import datetime, timezone

import requests

from .model_preview import _supabase_headers
from scripts.register_model import storage_conflict


class PreparationStoreError(RuntimeError):
    pass


class PreparationStore:
    def __init__(self, url: str, key: str, http=requests):
        self.base=url.rstrip('/')
        self.headers=_supabase_headers(key)
        self.key=key
        self.http=http

    def _row(self, table: str, params: dict) -> dict | None:
        response=self.http.get(self.base+'/rest/v1/'+table,headers=self.headers,
                               params={'select':'*','limit':'2',**params},timeout=(5,20),allow_redirects=False)
        if response.status_code!=200:raise PreparationStoreError('Private model records could not be read.')
        rows=response.json()
        if not isinstance(rows,list) or len(rows)>1:raise PreparationStoreError('A private model record is ambiguous.')
        return rows[0] if rows else None

    def job(self, upload_id: str, actor_id: str, token: str | None = None) -> tuple[dict,dict]:
        if not self._row('app_administrators',{'user_id':'eq.'+actor_id}):
            raise PreparationStoreError('Administrator access is required.')
        upload=self._row('model_uploads',{'id':'eq.'+upload_id})
        preparation=self._row('model_preparations',{'upload_id':'eq.'+upload_id})
        if not upload or not preparation:raise PreparationStoreError('The preparation is unavailable.')
        expected=f"admin-uploads/{upload['calculator_id']}/{upload_id}.xlsx"
        if upload.get('storage_path')!=expected:raise PreparationStoreError('The submitted workbook identity is invalid.')
        if token is not None and (preparation.get('lease_token')!=token or preparation.get('state') not in {'working','validating'} or upload.get('status')!='review_required'):
            raise PreparationStoreError('The preparation lease is no longer current.')
        if token is not None:
            try: current = datetime.fromisoformat(preparation['lease_until'].replace('Z','+00:00')) > datetime.now(timezone.utc)
            except (ValueError,TypeError,KeyError): current = False
            if not current: raise PreparationStoreError('The preparation lease has expired.')
        return upload,preparation

    def model(self, calculator_id: str, version: str) -> dict:
        row=self._row('calculator_versions',{'calculator_id':'eq.'+calculator_id,'version':'eq.'+version})
        if not row:raise PreparationStoreError('The base model is unavailable.')
        return row

    def download(self, bucket: str, path: str, target: Path, digest: str) -> None:
        if not isinstance(path,str) or '..' in path.split('/') or not isinstance(digest,str) or len(digest)!=64:
            raise PreparationStoreError('Private workbook identity is invalid.')
        url=self.base+'/storage/v1/object/authenticated/'+bucket+'/'+quote(path,safe='/')
        with self.http.get(url,headers=self.headers,stream=True,timeout=(5,30),allow_redirects=False) as response:
            if response.status_code!=200:raise PreparationStoreError('The private workbook could not be downloaded.')
            size=0
            with target.open('wb') as output:
                for chunk in response.iter_content(64*1024):
                    size+=len(chunk)
                    if size>20*1024*1024:raise PreparationStoreError('The workbook exceeds its size limit.')
                    output.write(chunk)
        if hashlib.sha256(target.read_bytes()).hexdigest()!=digest:
            raise PreparationStoreError('The private workbook checksum did not match.')

    def upload(self, bucket: str, path: str, content: bytes) -> None:
        if len(content)>20*1024*1024:raise PreparationStoreError('The generated workbook exceeds its size limit.')
        headers={**self.headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','x-upsert':'false'}
        response=self.http.post(self.base+'/storage/v1/object/'+bucket+'/'+quote(path,safe='/'),
                                headers=headers,data=content,timeout=(5,30),allow_redirects=False)
        if storage_conflict(response):
            # A deterministic retry may reuse a completed upload, never overwrite.
            checked=self.http.get(self.base+'/storage/v1/object/authenticated/'+bucket+'/'+quote(path,safe='/'),
                                  headers=self.headers,timeout=(5,30),allow_redirects=False)
            if checked.status_code==200 and hashlib.sha256(checked.content).digest()==hashlib.sha256(content).digest():return
        if response.status_code not in (200,201):raise PreparationStoreError('The private artifact could not be stored.')

    def finish(self, upload_id: str, actor_id: str, token: str, outcome: str, data: dict) -> bool:
        response=self.http.post(self.base+'/rest/v1/rpc/finish_model_preparation',headers={**self.headers,'Content-Type':'application/json'},
            json={'p_upload':upload_id,'p_actor':actor_id,'p_token':token,'p_outcome':outcome,'p_data':data},timeout=(5,20),allow_redirects=False)
        if response.status_code!=200:raise PreparationStoreError('Preparation publication could not be confirmed.')
        return response.json() is True
