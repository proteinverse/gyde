import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import RenameColumn from './RenameColumn';
jest.mock('@mui/material',()=>({
 Button:({children,...props})=><button {...props}>{children}</button>,
 Dialog:({open,children})=>open?<div>{children}</div>:null,
 DialogTitle:({children})=><h2>{children}</h2>,DialogContent:({children})=><div>{children}</div>,DialogActions:({children})=><div>{children}</div>,
 MenuItem:({children,value})=><option value={value}>{children}</option>,
 TextField:({select,label,value,onChange,children})=>select?<select aria-label={label} value={value} onChange={onChange}><option value=""/>{children}</select>:<input aria-label={label} value={value} onChange={onChange}/>,
}));
test('renames a display label without changing the column key; prevents duplicate or blank labels',async()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;
 const el=document.createElement('div'),root=createRoot(el),rename=jest.fn();
 const change=(element,value)=>{Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype,'value').set.call(element,value);element.dispatchEvent(new Event('change',{bubbles:true}));element.dispatchEvent(new Event('input',{bubbles:true}));};
 try {
  await act(async()=>root.render(<RenameColumn columns={['Untitled','other','sequence']} seqColumns={[{column:'sequence'}]} labels={{other:'Existing'}} onRename={rename}/>));
  await act(async()=>el.querySelector('button').click());
  expect([...el.querySelectorAll('option')].map(option=>option.value)).not.toContain('sequence');
  await act(async()=>change(el.querySelector('select'),'Untitled'));
  const input=el.querySelector('input');
  await act(async()=>change(input,'Existing'));
  expect([...el.querySelectorAll('button')].find(b=>b.textContent==='Save').disabled).toBe(true);
  await act(async()=>change(input,'Score'));
  await act(async()=>[...el.querySelectorAll('button')].find(b=>b.textContent==='Save').click());
  expect(rename).toHaveBeenCalledWith('Untitled','Score');
 } finally {await act(async()=>root.unmount());}
});
