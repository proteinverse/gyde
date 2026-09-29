import {
  predictorMolecules,
  rankedPredictions,
  tamarindAntibodyInput,
} from "./tamarindPredictors";
test("molecule serialization retains ligand, DNA, RNA and repeated protein chains", () => {
  const m = predictorMolecules({
    proteinSequences: ["AC", "AC"],
    ligands: ["CCO"],
    dnas: ["ACGT"],
    rnas: ["ACGU"],
  });
  expect(m.map((x) => x.chain)).toEqual(["A", "B", "C", "D", "E"]);
  expect(m[2]).toEqual({ type: "ligand", smiles: "CCO", chain: "C" });
  expect(m[4].type).toBe("rna");
});
test("OpenFold ranking uses model IDs rather than alphabetical file order", () => {
  const files = [1, 2, 3, 4, 5].map((i) => ({
    path: `results/result_sample_${i}.cif`,
  }));
  const csv = "Model,sample_ranking_score\n1,0.1\n2,0.5\n3,0.9\n4,0.2\n5,0.3";
  expect(rankedPredictions("openfold3-v1", files, csv)[0].file.path).toContain(
    "sample_3",
  );
  expect(() =>
    rankedPredictions("openfold3-v1", files, csv.replace("3,0.9", "2,0.9")),
  ).toThrow("Duplicate");
  expect(() =>
    rankedPredictions("openfold3-v1", files, csv.replace("3,0.9", "3,")),
  ).toThrow("scores");
});

test("batch input validation refuses unsupported molecules before submission", () => {
  expect(() =>
    predictorMolecules({ proteinSequences: ["AC"], ligands: ["CCO"] }, "af2"),
  ).toThrow("protein chains only");
  expect(() =>
    predictorMolecules({ proteinSequences: ["not a protein"] }, "chai-1"),
  ).toThrow("Invalid");
  expect(() =>
    predictorMolecules({ proteinSequences: ["A".repeat(2501)] }, "af2"),
  ).toThrow("2,500");
});
test("antibody inputs cannot silently discard an additional protein chain", () => {
  expect(
    tamarindAntibodyInput({
      hc: "AC",
      lc: "DE",
      proteinSequences: ["AC", "DE"],
    }),
  ).toEqual({ heavy: "AC", light: "DE" });
  expect(() =>
    tamarindAntibodyInput({
      hc: "AC",
      lc: "DE",
      proteinSequences: ["AC", "DE", "FG"],
    }),
  ).toThrow("without other");
});
