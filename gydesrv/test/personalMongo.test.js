import test from 'node:test';
import assert from 'node:assert/strict';
import {MongoClient} from 'mongodb';
import {randomUUID} from 'node:crypto';
import {PersonalJobs} from '../integrations/tamarind/jobs.js';
import {catalog} from '../integrations/tamarind/catalog.js';
import {config,fakeClient,mafft} from './personalHelpers.js';

test('MongoDB unique submission claims and restart recovery use the real database', {skip:!process.env.GYDE_TEST_MONGO_URL}, async t=>{
    const mongo=new MongoClient(process.env.GYDE_TEST_MONGO_URL);await mongo.connect();
    const db=mongo.db('gyde_test_'+randomUUID().replaceAll('-',''));
    t.after(async()=>{await db.dropDatabase();await mongo.close();});
    const collection=db.collection('jobs'),client=fakeClient();
    const first=new PersonalJobs(collection,client,catalog,config),second=new PersonalJobs(collection,client,catalog,config);
    await first.init();
    const results=await Promise.all([first.submit('mafft-7.475',mafft(),'mongo-request'),second.submit('mafft-7.475',mafft(),'mongo-request')]);
    assert.equal(results[0].id,results[1].id);assert.equal(await collection.countDocuments(),1);
    assert.equal(client.calls.filter(c=>c[0]==='submit').length,1);
    const restarted=new PersonalJobs(collection,client,catalog,config);
    const status=await restarted.request('mongo-request');assert.equal(status.id,results[0].id);
    client.jobs.get(status.jobName).JobStatus='Complete';
    assert.equal((await restarted.poll(status.id)).status,'COMPLETED');
    assert.equal((await restarted.files(status.id)).files[0].label,'alignment');
});
