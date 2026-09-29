import {loadStructureModel} from './loadStructureModel';
test('loads the requested model without depending on hierarchy population or last model ordering',async()=>{
 const model={cell:{obj:{data:{label:'original'}}}};
 const other={cell:{obj:{data:{label:'another load'}}}};
 const applyPreset=jest.fn(async()=>({model}));
 const viewer={plugin:{builders:{structure:{hierarchy:{applyPreset}}},get managers(){throw Error('Hierarchy not ready');}}};
 expect(await loadStructureModel(viewer,'trajectory','requested',{modelIndex:2})).toBe(model);
 expect(applyPreset).toHaveBeenCalledWith('trajectory','default',{model:{modelIndex:2}});
 expect(model.cell.obj.data.label).toBe('requested');
 expect(other.cell.obj.data.label).toBe('another load');
});
test('missing parsed models produce an actionable error',async()=>{
 const viewer={plugin:{builders:{structure:{hierarchy:{applyPreset:async()=>undefined}}}}};
 await expect(loadStructureModel(viewer,'bad','label')).rejects.toThrow('no readable model');
});

test('later dataset rows use the default file model unless an explicit model is selected',async()=>{
 const model={cell:{obj:{data:{}}}};
 const applyPreset=jest.fn(async()=>({model}));
 const viewer={plugin:{builders:{structure:{hierarchy:{applyPreset}}}}};
 await loadStructureModel(viewer,'one-model-file','row 10',{dataIndices:[9]});
 expect(applyPreset).toHaveBeenCalledWith('one-model-file','default',undefined);
});
