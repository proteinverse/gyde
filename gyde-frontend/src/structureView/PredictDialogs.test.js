import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {StructurePredictDialog} from './PredictDialogs';
import {tamarindBoltzInput} from '../integrations/tamarind/tamarindBoltz';
global.IS_REACT_ACT_ENVIRONMENT = true;
const mockSubmit = jest.fn();
const mockService = {services:[{id:'boltz-2'}],submit:mockSubmit};
jest.mock('../czekolada/lib', () => {
    const React = require('react');
    return {useSlivka: () => mockService,
        configMapToFormData: (_service, params) => params,
        ServiceLauncher: ({parameterCallback}) => {
            React.useEffect(() => parameterCallback({numRecycles:3}), [parameterCallback]);
            return <div>Number of recycles</div>;
        },
    };
});
jest.mock('../integrations/tamarind/TamarindPredictionLayout', () => ({
    PredictionTheme: ({children}) => children, PredictionInputs: () => null, predictionName: name => name,
}));
jest.mock('@mui/material', () => {
    const React = require('react');
    const box = ({children}) => <div>{children}</div>;
    return {...Object.fromEntries(['CircularProgress','Checkbox','FormControlLabel','Typography','Stack','Dialog','DialogTitle','DialogContent','DialogActions'].map(name=>[name,box])),
        Button: ({children,disabled,onClick}) => <button disabled={disabled} onClick={onClick}>{children}</button>,
        TextField: React.forwardRef(({value,onChange},ref) => <div ref={ref}><input value={value || ''} onChange={onChange}/></div>),
    };
});
let el, root;
const render = async infos => act(async () => root.render(<StructurePredictDialog
    method="boltz-2" methodKey="boltz2" inputConstructor={tamarindBoltzInput}
    structureInfos={infos} onJobSubmitted={jest.fn()} onHide={jest.fn()}
    structureSuffixes={['_0']} dataColumns={[]} structureKeys={[]} columnTypes={{}} columnarData={{}} />));
const clickRun = async () => act(async () => [...el.querySelectorAll('button')].find(b=>b.textContent==='Predict structures').click());
beforeEach(() => {jest.clearAllMocks();el=document.createElement('div');document.body.appendChild(el);root=createRoot(el);});
afterEach(async () => {await act(async () => root.unmount());el.remove();});
test('validates all selected inputs before dispatching any compute', async () => {
    await render([{proteinSequences:['ACD']},{proteinSequences:['EFG'],ligands:['CC']}]);
    await clickRun();
    expect(mockSubmit).not.toHaveBeenCalled();
    expect(el.textContent).toContain('protein chains only');
});
test('shows backend submission errors and permits a retry with the same settings', async () => {
    mockSubmit.mockRejectedValueOnce(new Error('Compute request failed (HTTP 403): Access denied')).mockResolvedValueOnce({});
    await render([{proteinSequences:['ACD']}]);
    await clickRun();
    expect(el.textContent).toContain('Access denied');
    await clickRun();
    expect(mockSubmit).toHaveBeenCalledTimes(2);
    expect(mockSubmit.mock.calls[1][1]).toEqual({sequence:'ACD',numRecycles:3});
});

test('retrying a partially submitted batch does not submit its accepted rows again',async()=>{
    mockSubmit.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Second row denied')).mockResolvedValueOnce({});
    await render([{proteinSequences:['ACD']},{proteinSequences:['EFG']}]);
    await clickRun();
    expect(el.textContent).toContain('1 row(s) already submitted');
    await clickRun();
    expect(mockSubmit).toHaveBeenCalledTimes(3);
    expect(mockSubmit.mock.calls.map(call=>call[1].sequence)).toEqual(['ACD','EFG','EFG']);
});
