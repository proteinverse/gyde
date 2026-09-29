import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {Simulate} from 'react-dom/test-utils';
import {ServiceLauncherImpl} from '../../czekolada/App';
import {useSlivka} from '../../czekolada/SlivkaService';
jest.mock('react-router', () => ({}));
jest.mock('../../czekolada/SlivkaService', () => ({useSlivka: jest.fn()}));

let container, root, client, listener;
const service = {id:'mpnn_design_residues',parameters:[{id:'num_seq_per_target',name:'Number of sequences',type:'integer',default:20,min:1,max:1000}]};
const findButton = text => [...container.querySelectorAll('button')].find(el => el.textContent.includes(text));
beforeEach(() => {
    process.env.REACT_APP_COMPUTE_PROVIDER='tamarind';
    global.IS_REACT_ACT_ENVIRONMENT=true;
    container=document.createElement('div'); document.body.appendChild(container); root=createRoot(container);
    client={submit:jest.fn(async (_s,_f,_o,cb) => {listener=cb; cb({id:'portal',status:'PENDING',finished:false,resultUrl:'https://staging.tamarind.bio/jobs/actual-job'});}),cancel:jest.fn().mockResolvedValue()};
    useSlivka.mockReturnValue(client);
});
afterEach(() => {act(() => root.unmount());container.remove();delete process.env.REACT_APP_COMPUTE_PROVIDER;});
async function renderAndSubmit() {
    await act(async () => root.render(<ServiceLauncherImpl service={service} showProgress />));
    await act(async () => Simulate.click(findButton('Submit job')));
}
test('queued jobs expose their real results link and cancellation while locking inputs', async () => {
    await renderAndSubmit();
    expect(container.textContent).toContain('Queued');
    expect(container.querySelector('a').href).toBe('https://staging.tamarind.bio/jobs/actual-job');
    expect(container.querySelector('input').disabled).toBe(true);
    expect(findButton('Queued').disabled).toBe(true);
    await act(async () => Simulate.click(findButton('Cancel job')));
    expect(client.cancel).toHaveBeenCalledWith('portal');
    expect(container.textContent).toContain('Cancelling');
    await act(async () => listener({id:'portal',status:'CANCELLED',finished:true}));
    expect(findButton('Submit job').disabled).toBe(false);
});
test('cancellation errors stay visible without losing the job link', async () => {
    client.cancel.mockRejectedValueOnce(new Error('Cancellation denied'));
    await renderAndSubmit();
    await act(async () => Simulate.click(findButton('Cancel job')));
    expect(container.querySelector('[role="alert"]').textContent).toContain('Cancellation denied');
    expect(findButton('Cancel job').disabled).toBe(false);
    expect(container.querySelector('a').href).toContain('actual-job');
});
test('temporary polling errors retain results access and block duplicate submission', async () => {
    await renderAndSubmit();
    await act(async () => listener({id:'portal',status:'COMMS_ERROR',finished:false}));
    expect(container.textContent).toContain('Reconnecting');
    expect(container.querySelector('a').href).toContain('actual-job');
    expect(findButton('Reconnecting').disabled).toBe(true);
});
test('submission failures are visible and allow retry', async () => {
    client.submit.mockRejectedValueOnce(new Error('Invalid residue selection'));
    await renderAndSubmit();
    expect(container.querySelector('[role="alert"]').textContent).toContain('Invalid residue selection');
    expect(findButton('Submit job').disabled).toBe(false);
    expect(container.querySelector('a')).toBeNull();
});

test('integer controls reject fractional design counts before submission', async () => {
    await act(async () => root.render(<ServiceLauncherImpl service={service} />));
    await act(async () => Simulate.change(container.querySelector('input'), {target:{value:'1.5'}}));
    expect(findButton('Submit job').disabled).toBe(true);
    expect(client.submit).not.toHaveBeenCalled();
});

test('completion remains locked through asynchronous import and ignores duplicate completion events', async () => {
    let resolveImport;
    const importResult = jest.fn(status => status.finished ? new Promise(resolve => {resolveImport=resolve;}) : undefined);
    await act(async () => root.render(<ServiceLauncherImpl service={service} listener={importResult} />));
    await act(async () => Simulate.click(findButton('Submit job')));
    let completion;
    await act(async () => {completion=listener({id:'portal',status:'COMPLETED',finished:true});});
    expect(container.textContent).toContain('Importing results');
    expect(container.querySelector('input').disabled).toBe(true);
    await act(async () => Simulate.click(findButton('Importing results')));
    expect(client.submit).toHaveBeenCalledTimes(1);
    await act(async () => listener({id:'portal',status:'COMPLETED',finished:true}));
    expect(importResult).toHaveBeenCalledTimes(2); // pending + a single completion
    await act(async () => {resolveImport(); await completion;});
    expect(container.querySelector('input').disabled).toBe(false);
    expect(container.textContent).not.toContain('importing the results');
});

test('failed imports show the error and release the lock without losing result access', async () => {
    const importResult = jest.fn(async status => {if (status.finished) throw new Error('Result download failed');});
    await act(async () => root.render(<ServiceLauncherImpl service={service} listener={importResult} />));
    await act(async () => Simulate.click(findButton('Submit job')));
    await act(async () => listener({id:'portal',status:'COMPLETED',finished:true}));
    expect(container.querySelector('[role="alert"]').textContent).toContain('Result download failed');
    expect(container.querySelector('input').disabled).toBe(false);
    expect(container.querySelector('a').href).toContain('actual-job');
});

test.each(['', '   '])('blank required text %p disables submission', async blank => {
    const textService={id:'text',parameters:[{id:'sequence',name:'Sequence',type:'text',required:true,default:'ACD'}]};
    await act(async () => root.render(<ServiceLauncherImpl service={textService} />));
    await act(async () => Simulate.change(container.querySelector('input'), {target:{value:blank}}));
    expect(findButton('Submit job').disabled).toBe(true);
    expect(container.textContent).toContain('Required');
    expect(client.submit).not.toHaveBeenCalled();
});

test('pending jobs lock array elements and their add action', async () => {
    const arrayService={id:'array',parameters:[{id:'sequences',name:'Sequences',type:'text',array:true,required:true}]};
    await act(async () => root.render(<ServiceLauncherImpl service={arrayService} />));
    const legacyRoot = [...container.querySelectorAll('*')].find(element => element.shadowRoot)?.shadowRoot;
    expect(legacyRoot).toBeDefined();
    await act(async () => Simulate.change(legacyRoot.querySelector('input'), {target:{value:'ACD'}}));
    await act(async () => Simulate.click(findButton('Submit job')));
    expect(legacyRoot.querySelector('input').disabled).toBe(true);
    expect([...legacyRoot.querySelectorAll('button')].find(button => button.textContent === '+').disabled).toBe(true);
});

test('Slivka submission errors remain visible in its default launcher',async()=>{
    delete process.env.REACT_APP_COMPUTE_PROVIDER;
    client.submit.mockRejectedValueOnce(new Error('Slivka unavailable'));
    await act(async()=>root.render(<ServiceLauncherImpl service={service} showProgress />));
    await act(async()=>Simulate.click(findButton('Run Job')));
    expect(container.querySelector('[role="alert"]').textContent).toContain('Slivka unavailable');
    expect(findButton('Run Job').disabled).toBe(false);
});
