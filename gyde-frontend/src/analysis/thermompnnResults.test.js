import { thermompnnResults } from "./thermompnnResults";
const chains = {
  A: { mpnnAtomicSequence: "AC", mpnnNumbering: [1, 2] },
  B: { mpnnAtomicSequence: "DE", mpnnNumbering: [1, 2] },
};
const rows = [
  { position: "2", wildtype: "D", mutation: "A", ddG_pred: "-1" },
  { position: "0", wildtype: "A", mutation: "G", ddG_pred: "-1" },
];
test("maps concatenated mutation positions to separate chain columns and limits tied scores exactly", () => {
  const result = thermompnnResults(
    rows,
    chains,
    ["A", "B"],
    "input.pdb",
    "test",
    1,
  );
  expect(result.dataRowCount).toBe(2);
  expect(result.columnarData.sequence).toEqual(["AC", "AC"]);
  expect(result.columnarData.sequence_2).toEqual(["DE", "AE"]);
  expect(result.columnarData.concept_name).toEqual(["ref", "B:D1A"]);
  expect(result.columnarData.structure_chains).toEqual([
    ["A", "B"],
    ["A", "B"],
  ]);
  expect(result.seqRefColumns).toEqual([
    { column: "sequence_base" },
    { column: "sequence_2_base" },
  ]);
});
test("rejects empty, out-of-range, mismatched and malformed mutation results", () => {
  for (const results of [
    [],
    [{ ...rows[0], position: "4" }],
    [{ ...rows[0], wildtype: "A" }],
    [{ ...rows[0], ddG_pred: "bad" }],
    [{ ...rows[0], mutation: "X" }],
  ]) {
    expect(() =>
      thermompnnResults(results, chains, ["A", "B"], "input.pdb", "test", null),
    ).toThrow();
  }
});
