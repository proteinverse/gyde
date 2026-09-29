import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {ThermoMPNNDialog} from './ThermoMPNN';
import {parseStructureData} from '../structureView/utils';
import {getPdbChains} from '../utils/pdb';
global.IS_REACT_ACT_ENVIRONMENT = true;
jest.mock('d3-dsv', () => ({csvParse: jest.fn()}));
jest.mock('../utils/loaders', () => ({readAsText: jest.fn()}));
jest.mock('../utils/utils', () => ({aosToSoa: jest.fn()}));
jest.mock('../utils/pdb', () => ({getPdbChains: jest.fn()}));
jest.mock('../structureView/utils', () => ({parseStructureData: jest.fn()}));
jest.mock('../Pinger', () => ({usePinger: () => jest.fn()}));
jest.mock('../czekolada/lib', () => ({useSlivka: () => ({})}));
jest.mock('./slivka', () => jest.fn());
jest.mock('@mui/material', () => {
  const React = require('react');
  const box = ({children}) => <div>{children}</div>;
  return {Button: ({children, disabled, onClick}) => <button disabled={disabled} onClick={onClick}>{children}</button>,
    TextField: ({select, label, value, onChange, children}) => select ? <select aria-label={label} value={value} onChange={onChange}><option value="" />{children}</select> : <input aria-label={label} value={value} onChange={onChange}/>,
    MenuItem: ({children, value}) => <option value={value}>{children}</option>,
    ...Object.fromEntries(['Typography','Alert','FormControlLabel','Checkbox','Dialog','DialogActions','DialogContent','DialogTitle','IconButton','Stack','Table','TableContainer','TableRow','TableBody','TableCell','TableHead','Divider','LinearProgress','Switch','Input'].map(k=>[k,box]))};
});
let root, el;
const props = {open:true,onClose:jest.fn(),passedProps:{columnarData:{structure:['model.pdb']},soloSelection:0,structureKeys:['structure'],onDataLoad:jest.fn()}};
const run = () => [...el.querySelectorAll('button')].find(b=>b.textContent==='Run');
async function select(label, value) { await act(async()=>{const s=el.querySelector(`select[aria-label="${label}"]`);s.value=value;s.dispatchEvent(new Event('change',{bubbles:true}));}); }
beforeEach(async()=>{process.env.REACT_APP_COMPUTE_PROVIDER='tamarind';el=document.createElement('div');document.body.appendChild(el);root=createRoot(el);jest.clearAllMocks();await act(async()=>root.render(<ThermoMPNNDialog {...props}/>));});
afterEach(async()=>{await act(async()=>root.unmount());el.remove();delete process.env.REACT_APP_COMPUTE_PROVIDER;});
test('requires a loaded PDB and a selected chain', async()=>{
 expect(run().disabled).toBe(true);
 parseStructureData.mockResolvedValue({structureText:'ATOM',format:'pdb'});
 getPdbChains.mockResolvedValue({A:{rawAtomicSequence:'MQI'}});
 await select('Select structure','structure'); expect(run().disabled).toBe(true);
 await select('Chain to analyse','A'); expect(run().disabled).toBe(false);
});
test('failed structure loads cannot be submitted', async()=>{
 parseStructureData.mockRejectedValue(new Error('HTTP 404'));
 await select('Select structure','structure'); expect(run().disabled).toBe(true); expect(el.textContent).toContain('HTTP 404');
 expect(el.querySelector('select[aria-label="Select structure"]').value).toBe('');
 parseStructureData.mockResolvedValue({structureText:'ATOM',format:'pdb'});
 getPdbChains.mockResolvedValue({A:{rawAtomicSequence:'MQI'}});
 await select('Select structure','structure');
 await select('Chain to analyse','A');
 expect(run().disabled).toBe(false);
});
test('CIF input is rejected before submitting', async()=>{
 parseStructureData.mockResolvedValue({structureText:'data_',format:'mmcif'});
 await select('Select structure','structure'); expect(run().disabled).toBe(true); expect(el.textContent).toContain('requires a PDB');
});

test('Slivka mode keeps its original dialog without Tamarind controls or wording', async()=>{
 delete process.env.REACT_APP_COMPUTE_PROVIDER;
 await act(async()=>root.render(<ThermoMPNNDialog {...props}/>));
 expect(el.textContent).not.toContain('Tamarind');
 expect(el.textContent).toContain('ThermoMPNN');
 expect(run()).toBeDefined();
});
