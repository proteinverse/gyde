import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {computeConfig, personalAccess} from '../integrations/tamarind/config.js';
import {TamarindApiClient, storageUrl, boundedBody} from '../integrations/tamarind/client.js';
import {config} from './personalHelpers.js';

const env = {GYDE_COMPUTE_PROVIDER: 'tamarind', GYDE_MOCK_USER: 'local-user', TAMARIND_API_KEY: 'test-only-key'};
test('disabled provider needs no Tamarind account, key or login configuration', () => {
    assert.deepEqual(computeConfig({}), {provider: 'slivka'});
});
test('personal mode refuses remote/shared installations, insecure TLS and arbitrary key destinations', () => {
    for (const change of [{GYDE_HOST:'0.0.0.0'}, {GYDE_HOST:'example.com'}, {GYDE_OAUTH_ISSUER:'https://login.example'},
        {GYDE_MOCK_USER:''}, {NODE_TLS_REJECT_UNAUTHORIZED:'0'}, {TAMARIND_ORIGIN:'https://app.tamarind.bio.evil.test'},
        {TAMARIND_ORIGIN:'http://app.tamarind.bio'}, {TAMARIND_API_KEY:'bad\nkey'}, {GYDE_PORT:'0'}])
        assert.throws(() => computeConfig({...env, ...change}));
    assert.equal(computeConfig(env).localOrigin, 'http://127.0.0.1:3030');
});
test('private key files and environment keys produce the same credential scope', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gyde-key-test-'));
    try {
        const path = join(dir,'key');writeFileSync(path,'test-only-key\n',{mode:0o600});
        const file = computeConfig({...env,TAMARIND_API_KEY:undefined,TAMARIND_API_KEY_FILE:path});
        assert.equal(file.credentialId, computeConfig(env).credentialId);
        assert.throws(() => computeConfig({...env,TAMARIND_API_KEY_FILE:path}));
    } finally {rmSync(dir,{recursive:true,force:true});}
});
test('loopback guard rejects DNS rebinding, foreign/null origins, remote sockets and cross-site form posts', () => {
    const guard = personalAccess(computeConfig(env));
    const allowed = (headers={}, method='GET', remoteAddress='127.0.0.1') => {
        let passed=false;
        const res={status(){return res;},json(){},set(){}};
        guard({headers:{host:'127.0.0.1:3030',...headers},socket:{remoteAddress},method},res,()=>passed=true);
        return passed;
    };
    assert.equal(allowed(),true);
    for (const headers of [{host:'evil.test:3030'}, {origin:'https://evil.test'}, {origin:'null'},
        {'sec-fetch-site':'cross-site'}, {'sec-fetch-site':'same-site'}]) assert.equal(allowed(headers),false);
    assert.equal(allowed({},'GET','10.0.0.2'),false);
    assert.equal(allowed({},'POST'),false);
    assert.equal(allowed({origin:'http://127.0.0.1:3030'},'POST'),true);
    assert.equal(allowed({'x-gyde-local':'1'},'DELETE'),true);
});
test('API key goes only to the official API; storage reads/uploads receive no credential and follow no redirects', async () => {
    const calls=[];
    const request=async (url, init) => {
        calls.push({url,init});
        if(url.endsWith('/getPresignedUploadUrl')) return Response.json({key:'test@example.test/input.pdb',uploadUrl:'https://bucket.s3.us-west-2.amazonaws.com/input.pdb?sig=test'});
        if(url.endsWith('/result')) return Response.json('https://abc123.cloudfront.net/result?sig=test');
        return new Response('data');
    };
    const client=new TamarindApiClient(config,request);
    assert.equal(await client.upload('input.pdb',Buffer.from('ATOM')), 'input.pdb');
    assert.equal((await client.file('job','out.pdb')).toString(),'data');
    for (const {url,init} of calls) {
        assert.equal(init.redirect,'error');
        assert.equal(init.headers?.['x-api-key'],url.startsWith(config.origin+'/') ? config.apiKey : undefined);
        assert.equal(init.headers?.Authorization,undefined);assert.equal(init.headers?.Cookie,undefined);
    }
});
test('storage destinations reject private hosts, credential URLs, non-TLS and suffix spoofing', () => {
    for(const url of ['http://bucket.s3.amazonaws.com/x','https://127.0.0.1/x','https://169.254.169.254/x',
        'https://bucket.s3.amazonaws.com.evil.test/x','https://u:p@bucket.s3.amazonaws.com/x','https://bucket.s3.amazonaws.com:8443/x'])
        assert.throws(()=>storageUrl(url));
});
test('oversized responses and upstream errors never expose keys or upstream response bodies', async () => {
    await assert.rejects(()=>boundedBody(new Response('too big'),2),/transfer limit/);
    const client=new TamarindApiClient(config,async()=>new Response('secret: '+config.apiKey,{status:403}));
    await assert.rejects(()=>client.job('job'),error=>error.status===403 && !error.message.includes(config.apiKey));
});
test('public file listing uses relative string paths and stays inside the job directory',async()=>{
    const calls=[];
    const client=new TamarindApiClient(config,async url=>{
        calls.push(url);
        return Response.json(new URL(url).searchParams.get('folder')==='gyde-job' ? ['gyde-job/sub/'] : ['gyde-job/sub/out.pdb']);
    });
    assert.deepEqual(await client.files({User:'u',JobName:'gyde-job'}),['u/gyde-job/sub/out.pdb']);
    assert.equal(calls.length,2);
    const bad=new TamarindApiClient(config,async()=>Response.json(['other-job/secret.pdb']));
    await assert.rejects(()=>bad.files({User:'u',JobName:'gyde-job'}),/Unexpected result path/);
});
