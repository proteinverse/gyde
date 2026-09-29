import React from 'react';
import {createRoot} from 'react-dom/client';
import {act} from 'react-dom/test-utils';
import PersonalCompute from './PersonalCompute';
test('personal compute explains automatic spending before mounting the application',async()=>{
    global.IS_REACT_ACT_ENVIRONMENT=true;
    const container=document.createElement('div');document.body.appendChild(container);
    const root=createRoot(container);const mounted=jest.fn();
    function App(){React.useEffect(()=>{mounted();},[]);return <div>Workspace loaded</div>;}
    try {
        await act(async()=>root.render(<PersonalCompute><App/></PersonalCompute>));
        expect(mounted).not.toHaveBeenCalled();
        expect(document.body.textContent).toContain('MAFFT automatically');
        const button=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Continue with Tamarind compute');
        await act(async()=>button.click());
        expect(mounted).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).toContain('Recent compute jobs');
    } finally {await act(async()=>root.unmount());container.remove();}
});
