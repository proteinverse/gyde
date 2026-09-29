import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {admission, admittedHandler} from '../integrations/tamarind/admission.js';

const response = () => Object.assign(new EventEmitter(), {locals:{}, set(){}});
test('disconnecting a caller retains its slot until remote work settles', async () => {
    const admit=admission(1), res=response();
    let finish;
    const work=new Promise(resolve => {finish=resolve;});
    admit({},res,error=>assert.equal(error,undefined));
    const running=admittedHandler(async()=>work)({},res,error=>assert.fail(error));
    res.emit('close');
    admit({},response(),error=>assert.equal(error.status,429));
    finish();await running;
    admit({},response(),error=>assert.equal(error,undefined));
});
test('failed work releases all nested admission slots exactly once', async () => {
    const outer=admission(1),inner=admission(1),res=response();
    for(const admit of [outer,inner]) admit({},res,error=>assert.equal(error,undefined));
    await admittedHandler(async()=>{throw Error('failure');})({},res,error=>assert.equal(error.message,'failure'));
    res.emit('finish');res.emit('close');
    for(const admit of [outer,inner]) {
        admit({},response(),error=>assert.equal(error,undefined));
        admit({},response(),error=>assert.equal(error.status,429));
    }
});
