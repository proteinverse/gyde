import {alphaFoldPdbUrl, mapUniProtEntry} from './alphaFold';
const accession = 'P0CG47';
const pdbUrl = 'https://alphafold.ebi.ac.uk/files/AF-P0CG47-F1-model_v6.pdb';
const reply = (data, status = 200) => jest.fn().mockResolvedValue({ok: status === 200, status, json: async () => data});
test('uses the API-provided PDB version', async () => {
  const fetch = reply([{uniprotAccession: accession, pdbUrl}]);
  expect(await alphaFoldPdbUrl(accession, fetch)).toBe(pdbUrl);
  expect(fetch).toHaveBeenCalledWith('https://alphafold.ebi.ac.uk/api/prediction/P0CG47');
});
test.each([[], [{uniprotAccession: 'OTHER', pdbUrl}], [{uniprotAccession: accession}], [{uniprotAccession: accession, pdbUrl}, {uniprotAccession: accession, pdbUrl}]].map(data => [data]))('does not invent a model for missing or ambiguous entries', async data => {
  expect(await alphaFoldPdbUrl(accession, reply(data))).toBeNull();
});
test.each(['https://evil.com/model.pdb', 'http://alphafold.ebi.ac.uk/files/model.pdb', 'https://alphafold.ebi.ac.uk/files/model.cif', 'https://user@alphafold.ebi.ac.uk/files/model.pdb'])('rejects unexpected model URL %s', async url => {
  await expect(alphaFoldPdbUrl(accession, reply([{uniprotAccession: accession, pdbUrl: url}]))).rejects.toThrow();
});
test.each([404, 503])('keeps sequence import usable when AlphaFold returns %s', async status => {
  const result = await mapUniProtEntry({primaryAccession: accession, sequence: {value: 'MQIFVK'}}, reply([], status));
  expect(result.sequence).toBe('MQIFVK');
  expect(result.otherData.structure_url).toBeUndefined();
  expect(result.otherData.structure_status).toBeTruthy();
});
test('keeps sequence import usable after network failure', async () => {
  const result = await mapUniProtEntry({primaryAccession: accession, sequence: {value: 'MQIFVK'}}, jest.fn().mockRejectedValue(new Error('offline')));
  expect(result.sequence).toBe('MQIFVK');
  expect(result.otherData.structure_status).toContain('unavailable');
});
