import { tamarindBoltzInput, singleBoltzRow, boltzReconnectRows } from "./tamarindBoltz";
test("preserves protein chain order and rejects unsupported inputs without dropping molecules", () => {
  expect(tamarindBoltzInput({ proteinSequences: ["ACD", "EFG"] })).toEqual({
    sequence: "ACD:EFG",
  });
  for (const input of [
    { proteinSequences: [] },
    { proteinSequences: ["AC-D"] },
    { proteinSequences: ["A".repeat(2049)] },
    { proteinSequences: Array(27).fill("AC") },
    ...["ligands", "dnas", "rnas"].map((key) => ({
      proteinSequences: ["ACD"],
      [key]: ["AC"],
    })),
  ]) {
    expect(() => tamarindBoltzInput(input)).toThrow();
  }
});

test('counts selected dataset rows, not visible structures or deduplicated sequences', () => {
  const one = {dataIndices:[0],selectedIndices:[0],proteinSequences:['ACD']};
  expect(singleBoltzRow([one,{...one,structureKey:'second'}])).toEqual([one]);
  expect(() => singleBoltzRow([{...one,dataIndices:[0,1],selectedIndices:[0,1]}])).toThrow('Select one dataset row');
  expect(() => singleBoltzRow([{...one,dataIndices:[0],selectedIndices:[1,2]}])).toThrow('Select one dataset row');
  expect(() => singleBoltzRow([])).toThrow('Select one dataset row');
});
test('reconnects merged dataset rows once each despite multiple visible structures', () => {
  const one = {dataIndices:[0,1],proteinSequences:['ACD']};
  expect(boltzReconnectRows([one,{...one,dataIndices:[1]}]).map(info=>info.dataIndices)).toEqual([[0],[1]]);
});
