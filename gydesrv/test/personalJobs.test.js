import test from 'node:test';
import assert from 'node:assert/strict';
import {PersonalJobs} from '../integrations/tamarind/jobs.js';
import {catalog} from '../integrations/tamarind/catalog.js';
import {HttpError} from '../integrations/tamarind/errors.js';
import {MemoryCollection,config,fakeClient,mafft} from './personalHelpers.js';

function setup() {const collection=new MemoryCollection(),client=fakeClient();return {collection,client,jobs:new PersonalJobs(collection,client,catalog,config)};}
test('one submission roundtrip persists identity, polls, imports and reuses a completed alignment', async()=>{
    const {jobs,client}=setup();await jobs.init();
    const result=await jobs.submit('mafft-7.475',mafft(),'request-key-1','readwrite');
    assert.equal(result.status,'PENDING');client.jobs.get(result.jobName).JobStatus='Complete';
    assert.equal((await jobs.poll(result.id)).status,'COMPLETED');
    const files=await jobs.files(result.id);assert.equal(files.files[0].label,'alignment');
    assert.match((await jobs.file(result.id,'0')).toString(),/>a/);
    const cached=await jobs.submit('mafft-7.475',mafft(),'request-key-2','readwrite');
    assert.equal(cached.id,result.id);assert.equal(client.calls.filter(c=>c[0]==='submit').length,1);
    await assert.rejects(()=>jobs.file(result.id,'../../x'),/File not found/);
});
test('simultaneous identical retries dispatch once; changed inputs cannot reuse the same key',async()=>{
    const {jobs,client}=setup();
    const results=await Promise.all([jobs.submit('mafft-7.475',mafft(),'same-request'),jobs.submit('mafft-7.475',mafft(),'same-request')]);
    assert.equal(results[0].id,results[1].id);assert.equal(client.calls.filter(c=>c[0]==='submit').length,1);
    const changed=mafft();changed.files.input.bytes=Buffer.from('>a\nACDE\n>b\nAC\n');
    await assert.rejects(()=>jobs.submit('mafft-7.475',changed,'same-request'),e=>e.status===409);
});
test('ambiguous paid submission survives restart and reconciles without another dispatch',async()=>{
    const {jobs,client,collection}=setup();const submit=client.submit;
    client.submit=async(...args)=>{await submit(...args);throw new HttpError(503,'timeout');};
    const first=await jobs.submit('mafft-7.475',mafft(),'uncertain-key');assert.equal(first.status,'RECONCILING');
    const restarted=new PersonalJobs(collection,client,catalog,config);
    assert.equal((await restarted.submit('mafft-7.475',mafft(),'uncertain-key')).id,first.id);
    assert.equal((await restarted.poll(first.id)).status,'PENDING');
    assert.equal(client.calls.filter(c=>c[0]==='submit').length,1);
});
test('unknown submission is never resent even when Tamarind cannot find it',async()=>{
    const {jobs,client}=setup();client.submit=async()=>{throw new HttpError(503,'timeout');};
    client.job=async()=>{throw new HttpError(404,'not found');};
    const first=await jobs.submit('mafft-7.475',mafft(),'missing-job');
    assert.equal((await jobs.poll(first.id)).status,'RECONCILING');
});
test('permission rejection is terminal and validates bad input before any upload',async()=>{
    const {jobs,client,collection}=setup();client.submit=async()=>{throw new HttpError(403,'Budget denied');};
    await assert.rejects(()=>jobs.submit('mafft-7.475',mafft(),'denied-key'),e=>e.status===403);
    assert.equal(collection.rows[0].state,'FAILED');
    await assert.rejects(()=>jobs.submit('mafft-7.475',{fields:{},files:{}},'invalid-key'));
    assert.equal(collection.rows.length,1);
});
test('another configured credential cannot list, read, cancel or download existing jobs',async()=>{
    const {jobs,client,collection}=setup();const first=await jobs.submit('mafft-7.475',mafft(),'owner-key');
    const other=new PersonalJobs(collection,client,catalog,{...config,credentialId:'different-key'});
    assert.deepEqual(await other.list(),{jobs:[]});
    for(const action of [()=>other.poll(first.id),()=>other.cancel(first.id),()=>other.files(first.id),()=>other.file(first.id,'0')])
        await assert.rejects(action,e=>e.status===404);
});
test('cancellation targets only a persisted job and preserves terminal completion',async()=>{
    const {jobs,client}=setup();const first=await jobs.submit('mafft-7.475',mafft(),'cancel-key');
    assert.equal((await jobs.cancel(first.id)).status,'CANCELLING');
    assert.equal((await jobs.poll(first.id)).status,'CANCELLED');
    const completed=await jobs.submit('mafft-7.475',mafft(),'completed-key');
    client.jobs.get(completed.jobName).JobStatus='Complete';
    assert.equal((await jobs.cancel(completed.id)).status,'COMPLETED');
});
test('stale polling and submission responses cannot undo terminal or cancellation states',async()=>{
    const {jobs}=setup();const first=await jobs.submit('mafft-7.475',mafft(),'state-race');
    const stale=await jobs.owned(first.id);
    await jobs.save(stale,{state:'CANCELLING'});
    assert.equal((await jobs.save(stale,{state:'RUNNING'})).state,'CANCELLING');
    await jobs.save(stale,{state:'COMPLETED'});
    assert.equal((await jobs.save(stale,{state:'PENDING'})).state,'COMPLETED');
});

test('a concurrent poll during cancellation observes persisted intent',async()=>{
    const {jobs,client}=setup();const first=await jobs.submit('mafft-7.475',mafft(),'cancel-race-key');
    client.cancel=async name=>{
        client.jobs.get(name).JobStatus='Stopped';
        assert.equal((await jobs.poll(first.id)).status,'CANCELLED');
    };
    assert.equal((await jobs.cancel(first.id)).status,'CANCELLED');
});
test('completed cache entries are separated by configured project',async()=>{
    const {jobs,client,collection}=setup();const first=await jobs.submit('mafft-7.475',mafft(),'first-project-key','readwrite');
    client.jobs.get(first.jobName).JobStatus='Complete';await jobs.poll(first.id);
    const other=new PersonalJobs(collection,client,catalog,{...config,projectTag:'proj_other'});
    const next=await other.submit('mafft-7.475',mafft(),'other-project-key','readwrite');
    assert.notEqual(next.id,first.id);
    assert.equal(client.calls.filter(c=>c[0]==='submit').length,2);
});
test('malformed remote job identities fail closed with a sanitized upstream error',async()=>{
    const {jobs,client}=setup();const first=await jobs.submit('mafft-7.475',mafft(),'bad-identity-key');
    client.job=async()=>null;
    await assert.rejects(()=>jobs.poll(first.id),error=>error.status===502 && /identity/.test(error.message));
});
