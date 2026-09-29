import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import {ServiceLauncher} from './lib';
jest.mock('./App', () => ({ServiceLauncher: () => <input aria-label="Recycles"/>}));
jest.mock('./Styled', () => ({children}) => <div data-testid="legacy-style-container">{children}</div>);
global.IS_REACT_ACT_ENVIRONMENT = true;
test.each([true,false])('hosted=%s isolates Bootstrap only for non-hosted forms', async hosted => {
    const previous=process.env.REACT_APP_COMPUTE_PROVIDER;
    process.env.REACT_APP_COMPUTE_PROVIDER=hosted ? 'tamarind' : 'slivka';
    const el=document.createElement('div');const root=createRoot(el);
    try {
        await act(async () => root.render(<ServiceLauncher/>));
        expect(!!el.querySelector('[data-testid="legacy-style-container"]')).toBe(!hosted);
        expect(el.querySelector('input')).not.toBeNull();
    } finally {
        await act(async () => root.unmount());
        if(previous===undefined) delete process.env.REACT_APP_COMPUTE_PROVIDER;
        else process.env.REACT_APP_COMPUTE_PROVIDER=previous;
    }
});
