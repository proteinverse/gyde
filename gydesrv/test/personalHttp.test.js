import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {tamarindRouter} from '../integrations/tamarind/router.js';
import {personalAccess} from '../integrations/tamarind/config.js';
import {MemoryCollection,config,fakeClient} from './personalHelpers.js';

export async function httpRoundtrip(t, collection = new MemoryCollection()) {
    const client = fakeClient(), app = express(), local = {...config};
    // Guard sees the port once the ephemeral test server is listening.
    app.use((req,res,next)=>personalAccess(local)(req,res,next));
    app.use(await tamarindRouter({config:local,collection,client}));
    const server = await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    local.localOrigin=`http://127.0.0.1:${server.address().port}`;
    const request=(path,opts={})=>fetch(local.localOrigin+path,opts);
    const form=()=>{const f=new FormData();f.append('input',new Blob(['>a\nACD\n>b\nAC\n']),'input.fa');return f;};
    const submit=()=>request('/compute/tamarind/services/mafft-7.475/jobs',{method:'POST',body:form(),
        headers:{Origin:local.localOrigin,'Idempotency-Key':'http-roundtrip'}});
    const foreign=await request('/compute/tamarind/services/mafft-7.475/jobs',{method:'POST',body:form(),headers:{Origin:'https://evil.test'}});
    assert.equal(foreign.status,403);assert.equal(client.calls.length,0);
    const discovery=await (await request('/compute/tamarind/services')).json();
    assert.ok(discovery.services.some(s=>s.id==='boltz-2'));assert.ok(!JSON.stringify(discovery).includes(config.apiKey));
    const responses=await Promise.all([submit(),submit()]);
    for(const response of responses) assert.equal(response.status,200);
    const first=await responses[0].json(), duplicate=await responses[1].json();assert.equal(first.id,duplicate.id);
    assert.equal(client.calls.filter(c=>c[0]==='submit').length,1);
    const recovery=await (await request('/compute/tamarind/requests/http-roundtrip')).json();assert.equal(recovery.id,first.id);
    const listing=await (await request('/compute/tamarind/jobs')).json();assert.equal(listing.jobs.length,1);
    client.jobs.get(first.jobName).JobStatus='Complete';
    const files=await (await request(first['@url']+'/files')).json();
    assert.equal(files.files[0].label,'alignment');
    assert.match(await (await request(files.files[0]['@content'])).text(),/>b/);
    assert.equal((await request('/compute/tamarind/anything-else')).status,404);
    assert.equal((await request('/compute/tamarind/jobs/not-an-id')).status,404);
}
test('HTTP provider contract rejects cross-site spending and handles discovery, duplicate submission, recovery and results', httpRoundtrip);
