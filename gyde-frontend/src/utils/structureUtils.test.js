import {makeMappingsGeneric} from './structureUtils';

test.each([undefined, ['A,B']])('identical chains retain their own author positions (%p)', async chains => {
    const worker = {align: jest.fn()};
    const result = await makeMappingsGeneric(worker, {A:'AC', B:'AC'},
        {A:['10','11'], B:['11','12']}, ['AC'], chains);
    expect(result.chains).toEqual(['A,B']);
    expect(result.mappingsByChain[0].A.map(v => v.value)).toEqual(['10','11']);
    expect(result.mappingsByChain[0].B.map(v => v.value)).toEqual(['11','12']);
    expect(result.mappingsByChain[0].A[1].value).toBe('11');
    expect(result.mappingsByChain[0].B[1].value).toBe('12');
    expect(worker.align).not.toHaveBeenCalled();
});

test('explicit chain groups preserve independent alignment gaps and insertion IDs', async () => {
    const worker = {align: jest.fn().mockResolvedValue({score:100, aliA:'A-C', aliB:'ADC'})};
    const result = await makeMappingsGeneric(worker, {A:'ADC', B:'AC'},
        {A:['10','10A','11'], B:['20','21']}, ['ADC'], ['A,B']);
    expect(result.mappingsByChain[0].A.map(v => v.value)).toEqual(['10','10A','11']);
    expect(result.mappingsByChain[0].B.map(v => v.value)).toEqual(['20',undefined,'21']);
});

test('a missing explicitly named chain never inherits another chains residue map', async () => {
    const result = await makeMappingsGeneric({}, {A:'AC'}, {A:['10','11']}, ['AC'], ['A,B']);
    expect(result.mappingsByChain[0].B).toBeUndefined();
});
