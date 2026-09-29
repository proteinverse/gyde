import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {PredictionInputs, predictionMenuLabel, predictionName} from './TamarindPredictionLayout';
global.IS_REACT_ACT_ENVIRONMENT = true;
test('labels only Tamarind predictions with the provider logo and avoids duplicate suffixes', async () => {
    const el = document.createElement('div'), root = createRoot(el);
    for (const name of ['Chai-1', 'Boltz-2 (Tamarind)']) {
        await act(async () => root.render(<span>{predictionMenuLabel(name, true)}</span>));
        expect(el.textContent).toBe(name.replace(' (Tamarind)', ''));
        expect(el.querySelector('img').alt).toBe('Tamarind Bio');
    }
    await act(async () => root.render(<span>{predictionMenuLabel('Chai-1', false)}</span>));
    expect(el.textContent).toBe('Chai-1');
    expect(el.querySelector('img')).toBeNull();
    expect(predictionName('chai-1')).toBe('Chai-1');
    await act(async () => root.unmount());
});
test('shows selected molecules without editable duplicate inputs', async () => {
    const el = document.createElement('div');
    const root = createRoot(el);
    await act(async () => root.render(<PredictionInputs infos={[
        {proteinSequences:['ACD'],ligands:['CCO'],dnas:['ACGT'],rnas:['ACGU']},
        {proteinSequences:['EFG']},
    ]}/>));
    for (const value of ['Prediction 1','Prediction 2','ACD','CCO','ACGT','ACGU','EFG']) expect(el.textContent).toContain(value);
    expect(el.querySelector('input,textarea')).toBeNull();
    await act(async () => root.unmount());
});
