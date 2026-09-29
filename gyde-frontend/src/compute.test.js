import {loadComputeConfig} from './compute';
afterEach(()=>jest.restoreAllMocks());
test('legacy servers without compute discovery retain Slivka',async()=>{
    global.fetch=jest.fn().mockResolvedValue({status:404});
    expect(await loadComputeConfig()).toEqual({provider:'slivka'});
});
test('discovery accepts only a provider name, never server configuration or secrets',async()=>{
    global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({provider:'tamarind',unexpected:'ignored'})});
    expect(await loadComputeConfig()).toEqual({provider:'tamarind'});
    global.fetch.mockResolvedValue({ok:true,json:async()=>({provider:'unknown'})});
    await expect(loadComputeConfig()).rejects.toThrow('Invalid compute provider');
});
