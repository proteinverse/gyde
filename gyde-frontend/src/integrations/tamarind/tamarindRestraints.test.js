import { translateGydeRestraints } from "./tamarindRestraintMapping";
const info = {
  proteinSequences: ["ACD"],
  ligands: ["CCO"],
  moleculeColumns: { protein: ["seq"], ligand: ["lig"], dna: [], rna: [] },
  sequenceColumns: ["seq"],
  sequences: ["ACD"],
  alignments: ["A-CD"],
};
const row = {
  fromSeqCol: "seq",
  fromSeqPos: 2,
  toSeqCol: "lig",
  toLigand: true,
  minAngstroms: 0,
  maxAngstroms: 5,
};
test("restraint positions are mapped through alignment gaps", () => {
  const [r] = JSON.parse(translateGydeRestraints(info, [row], true).restraints);
  expect(r.from).toEqual({ chain: "A", position: 2 });
  expect(r.to).toEqual({ chain: "B", position: null });
});
test("unchecked restraints are not sent", () =>
  expect(translateGydeRestraints(info, [row], false)).toEqual({}));
test("gap restraints are rejected instead of skipped", () =>
  expect(() =>
    translateGydeRestraints(info, [{ ...row, fromSeqPos: 1 }], true),
  ).toThrow("gap"));
