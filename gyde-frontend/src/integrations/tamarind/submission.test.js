import {TextEncoder} from 'util';
import {createHash} from 'crypto';
import {submitTamarind} from './submission';

const originalCrypto = global.crypto;
const originalEncoder = global.TextEncoder;
beforeEach(()=>{
    global.TextEncoder=TextEncoder;
    Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:jest.fn(()=> 'test-request-key'),
        subtle:{digest:async (_algorithm,bytes)=>new Uint8Array(createHash('sha256').update(bytes).digest()).buffer}}});
    if (!AbortSignal.timeout) AbortSignal.timeout=()=>undefined;
    sessionStorage.clear();
});
afterEach(()=>{
    Object.defineProperty(global,'crypto',{configurable:true,value:originalCrypto});
    global.TextEncoder=originalEncoder;
    jest.restoreAllMocks();
});
const form=()=>({entries:()=>[['sequence','ACDEFG']][Symbol.iterator]()});
const response=()=>({status:200,ok:true,clone:()=>({json:async()=>({id:'saved-job'})})});

test('a lost submission response is recovered by a read without repeating paid compute',async()=>{
    global.fetch=jest.fn().mockRejectedValueOnce(new TypeError('connection lost')).mockResolvedValueOnce(response());
    expect((await submitTamarind('/compute/tamarind/services/boltz-2/jobs',form())).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].method).toBe('POST');
    expect(fetch.mock.calls[1][0]).toBe('/compute/tamarind/requests/test-request-key');
    expect(fetch.mock.calls[1][1].method).toBeUndefined();
});
test('an explicit retry after an unresolved response keeps the same key for equivalent new FormData',async()=>{
    global.fetch=jest.fn().mockRejectedValue(new TypeError('offline'));
    await expect(submitTamarind('/compute/tamarind/services/af2/jobs',form())).rejects.toThrow('Recent compute jobs');
    const key=fetch.mock.calls[0][1].headers['Idempotency-Key'];
    global.fetch=jest.fn().mockResolvedValue(response());
    await submitTamarind('/compute/tamarind/services/af2/jobs',form());
    expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe(key);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
});
test('losing a success response body is also reconciled before the attempt is cleared',async()=>{
    global.fetch=jest.fn().mockResolvedValueOnce({ok:true,status:200,clone:()=>({json:async()=>{throw new TypeError('body interrupted');}})})
        .mockResolvedValueOnce(response());
    await submitTamarind('/compute/tamarind/services/chai-1/jobs',form());
    expect(fetch).toHaveBeenCalledTimes(2);
});

test('multi-column imports queue submissions without exceeding two concurrent requests',async()=>{
    let active=0,max=0;
    const finish=[];
    global.fetch=jest.fn(async()=>{
        active++;max=Math.max(max,active);
        await new Promise(resolve=>finish.push(resolve));
        active--;return response();
    });
    const requests=Array.from({length:5},(_,i)=>submitTamarind(`/compute/tamarind/services/tool-${i}/jobs`,form()));
    for(let i=0;i<5;i++) {
        while(!finish.length) await new Promise(resolve=>setTimeout(resolve,0));
        finish.shift()();
    }
    await Promise.all(requests);
    expect(max).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(5);
});
