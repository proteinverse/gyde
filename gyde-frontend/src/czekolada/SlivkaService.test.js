import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {WithSlivkaService, useSlivka} from './SlivkaService';
global.IS_REACT_ACT_ENVIRONMENT = true;

test('the service wrapper exposes cached Tamarind result URLs from actual submissions', async () => {
  const element = document.createElement('div');
  const root = createRoot(element);
  const originalFetch = global.fetch;
  const result = {id:'portal-job', '@url':'/api/jobs/portal-job', status:'PENDING',
    resultUrl:'https://staging.tamarind.bio/jobs/tamarind-job'};
  global.fetch = jest.fn(async (_url, options) => ({ok:true,
    json:async () => options?.method === 'POST' ? result : {services:[{id:'boltz-2'}]}}));
  let service;
  function Probe() { service = useSlivka(); return null; }
  try {
    await act(async () => root.render(<WithSlivkaService><Probe /></WithSlivkaService>));
    expect(service.getJobStatus('missing')).toBeUndefined();
    await service.submit('boltz-2', new FormData(), {});
    expect(service.getJobStatus('portal-job').resultUrl).toBe(result.resultUrl);
  } finally {
    await act(async () => root.unmount());
    global.fetch = originalFetch;
  }
});

test('restored completed jobs retrieve all Boltz outputs after a temporary rejection without submitting', async () => {
  const {SlivkaService} = require('./SlivkaService');
  const {importCompletedResult} = require('../structureView/resultImport');
  jest.useFakeTimers();
  const originalFetch = global.fetch;
  const files = Array.from({length:5}, (_, i) => [
    {label:'PDB', path:`model_${i}.pdb`, '@content':`/media/existing/pdb${i}`},
    {label:'pLDDT', path:`model_${i}.npz`, '@content':`/media/existing/npz${i}`},
  ]).flat();
  let busy = true;
  global.fetch = jest.fn(async url => {
    if (url === '/api/jobs/existing') return {ok:true, json:async () => ({id:'existing',status:'COMPLETED',finished:true,'@url':url})};
    if (url.endsWith('/files')) {
      if (busy) { busy=false; return {ok:false,status:429,headers:{get:()=> '5'},json:async()=>({error:'busy'})}; }
      return {ok:true,json:async()=>({files})};
    }
    return {ok:true,arrayBuffer:async()=>new ArrayBuffer(8)};
  });
  const service = new SlivkaService();
  const save = jest.fn();
  let outputs;
  let importPromise;
  const subscription = service.watchJob('existing', result => {
    importPromise = importCompletedResult({...result,methodKey:'boltz2',jobName:'boltz2'}, {
      save,isActive:()=>true,run:async () => {
        outputs = await service.fetch(result.id,[{label:'PDB',type:'url'},{label:'pLDDT',type:'arrayBuffer'}]);
      },
    });
  });
  try {
    await service._pollJob('existing');
    for (let i=0;i<30;i++) await Promise.resolve();
    expect(save.mock.calls[0][0]._gyde_compute_complete).toBe(true);
    jest.advanceTimersByTime(5000);
    await importPromise;
    expect(outputs).toHaveLength(10);
    expect(outputs.filter(output => output.label==='pLDDT').every(output => output.data.byteLength===8)).toBe(true);
    expect(global.fetch.mock.calls.every(([_url,options]) => !options?.method)).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  } finally {
    subscription.unsubscribe(); global.fetch=originalFetch; jest.useRealTimers();
  }
});

test('slow status requests cannot pile up for the same job', async () => {
  const {SlivkaService} = require('./SlivkaService');
  const service = new SlivkaService();
  const originalFetch = global.fetch;
  let finish;
  global.fetch = jest.fn(() => new Promise(resolve => {finish=resolve;}));
  try {
    const first = service._pollJob('existing');
    await service._pollJob('existing');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    finish({ok:true,json:async()=>({id:'existing',status:'RUNNING'})});
    await first;
    expect(service.polling.size).toBe(0);
  } finally {global.fetch=originalFetch;}
});

test('a hung status poll times out and allows the next poll to complete', async () => {
  const {SlivkaService} = require('./SlivkaService');
  const service = new SlivkaService();
  const originalFetch = global.fetch;
  jest.useFakeTimers();
  global.fetch = jest.fn((_url, {signal}) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(Error('timeout'), {name:'AbortError'})));
  }));
  try {
    const first = service._pollJob('existing');
    jest.advanceTimersByTime(30000);
    await first;
    expect(service.polling.size).toBe(0);
    expect(service.status.existing.status).toBe('COMMS_ERROR');
    global.fetch.mockResolvedValueOnce({ok:true,json:async()=>({id:'existing',status:'COMPLETED',finished:true})});
    await service._pollJob('existing');
    expect(service.status.existing.status).toBe('COMPLETED');
    expect(global.fetch).toHaveBeenCalledTimes(2);
  } finally {global.fetch=originalFetch; jest.useRealTimers();}
});
