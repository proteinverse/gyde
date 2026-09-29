import { parseTamarindDesign } from "./tamarindDesign";
const chains = {
  B: { rawAtomicSequence: "DE", rawNumbering: ["10", "11"] },
  A: { rawAtomicSequence: "AC", rawNumbering: ["1", "2"] },
};
const fasta =
  ">ref, id=0\nAC:DE\n>sample, id=1, overall_confidence=0.8, ligand_confidence=0.9, seq_rec=0.5\nAG:DE";
test("modern MPNN chains are sorted and confidence names are preserved", () => {
  const result = parseTamarindDesign(fasta, chains, { A: ["2"] }, "/");
  expect(result[0].designed_chains).toBe('["A","B"]');
  expect(result[1].seq).toBe("AG/DE");
  expect(result[1].overall_confidence).toBe(0.8);
  expect(result[1].global_score).toBeUndefined();
});
test("rejects a redesign outside selected author residue identifiers", () => {
  expect(() => parseTamarindDesign(fasta, chains, { A: ["1"] })).toThrow(
    "outside",
  );
});
test("rejects a changed input structure instead of swapping chain assignments", () => {
  expect(() =>
    parseTamarindDesign(fasta.replace("AC:DE", "DE:AC"), chains, { A: ["2"] }),
  ).toThrow("chain sequences");
});
test("rejects incomplete scores", () => {
  expect(() =>
    parseTamarindDesign(
      fasta.replace("overall_confidence=0.8", "overall_confidence=NaN"),
      chains,
      { A: ["2"] },
    ),
  ).toThrow("confidence");
});

test('heatmaps use matching author residues and mask unselected positions',()=>{
 const {tamarindDesignProbabilities}=require('./tamarindDesign');
 const chainData={A:{rawAtomicSequence:'AC',rawNumbering:['10','10A']}};
 const data={version:1,alphabet:'ACDEFGHIKLMNPQRSTVWYX',chains:{A:{sequence:'AC',residues:['10','10A'],probabilities:[Array(21).fill(.1),Array(21).fill(.2)]}}};
 expect(tamarindDesignProbabilities(data,chainData,{A:['10A']}).A).toEqual([Array(21).fill(null),Array(21).fill(.2)]);
 data.chains.A.residues=['1','2'];
 expect(()=>tamarindDesignProbabilities(data,chainData,{A:['10A']})).toThrow('mapping');
});
