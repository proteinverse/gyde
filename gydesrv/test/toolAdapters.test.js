import test from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../integrations/tamarind/catalog.js";
const form = (fields = {}, files = {}) => ({ fields, files });
const molecules = JSON.stringify([
  { type: "protein", sequence: "ACDE", chain: "A" },
]);
test("predictors use the intended Tamarind model and fixed output count", async () => {
  const af = await catalog.af2.translate(form({ molecules }));
  assert.equal(af.sequence, "ACDE");
  assert.equal(af.numModels, "5");
  assert.equal(af.useMSA, true);
  const chai = await catalog["chai-1"].translate(form({ molecules }));
  assert.equal(chai.numSamples, 5);
  assert.equal(chai.numBatches, 1);
  assert.equal(chai.molecules[0].chain, "A");
  const of = await catalog["openfold3-v1"].translate(form({ molecules }));
  assert.equal(of.checkpoint, "openfold3-p2-155k");
  assert.equal(of.outputFormat, "cif");
});
test("predictor validation prevents silently dropped molecules and invalid chain mappings", async () => {
  await assert.rejects(
    () =>
      catalog.af2.translate(
        form({
          molecules: JSON.stringify([
            { type: "ligand", smiles: "CCO", chain: "A" },
          ]),
        }),
      ),
    /ligand/,
  );
  await assert.rejects(
    () =>
      catalog["chai-1"].translate(
        form({
          molecules: JSON.stringify([
            { type: "protein", sequence: "AC", chain: "B" },
          ]),
        }),
      ),
    /chain/,
  );
  await assert.rejects(
    () => catalog["chai-1"].translate(form({ molecules, numRecycles: "2.5" })),
    /whole number/,
  );
  await assert.rejects(
    () =>
      catalog["openfold3-v1"].translate(form({ molecules, bonds: "ignored?" })),
    /Unsupported/,
  );
});
test("antibody predictors map heavy/light roles without pretending they use the same model", async () => {
  assert.deepEqual(
    await catalog.abodybuilder2.translate(form({ heavy: "AC", light: "DE" })),
    { modelType: "Antibody", sequence1: "AC", sequence2: "DE" },
  );
  assert.deepEqual(
    await catalog.abodybuilder3.translate(form({ heavy: "AC", light: "DE" })),
    { heavy: "AC", light: "DE" },
  );
});
const atom = (n, chain, res) =>
  `ATOM  ${String(n).padStart(5)}  CA  ALA ${chain}${String(res).padStart(4)}    1.000   2.000   3.000  1.00 10.00           C  `;
const pdb = Buffer.from(
  [atom(1, "A", 10), atom(2, "A", 11), atom(3, "B", 2)].join("\n"),
);
test("design adapter keeps author residue numbers and selected chains", async () => {
  const settings = await catalog.mpnn_design_residues.translate(
    form(
      {
        chains_to_design: "A B",
        design_positions: "11, 2",
        num_seq_per_target: "20",
      },
      { input: { bytes: pdb } },
    ),
    async () => "uploaded.pdb",
  );
  assert.deepEqual(settings.designedResidues, { A: "11", B: "2" });
  assert.equal(settings.verifySequences, "verify-none");
  const ligand = await catalog.ligand_mpnn.translate(
    form(
      { redesigned_residues: "A11 B2", batch_size: "2" },
      { pdb_path: { bytes: pdb } },
    ),
    async () => "uploaded.pdb",
  );
  assert.deepEqual(ligand.designedResidues, { A: "11", B: "2" });
});
test("design adapter validates before uploading or launching compute", async () => {
  const upload = () => {
    throw Error("must not upload");
  };
  await assert.rejects(
    () =>
      catalog.mpnn_design_residues.translate(
        form(
          { chains_to_design: "A", design_positions: "999" },
          { input: { bytes: pdb } },
        ),
        upload,
      ),
    /absent/,
  );
  await assert.rejects(
    () =>
      catalog.ligand_mpnn.translate(
        form(
          { redesigned_residues: "A11", temperature: "NaN" },
          { pdb_path: { bytes: pdb } },
        ),
        upload,
      ),
    /Temperature/,
  );
});
test("alternate side-chain and ligand locations are rejected before upload", async () => {
  for (const record of ["ATOM  ", "HETATM"]) {
    const alternate =
      record +
      "    4  CB BALA A  10       1.000   2.000   3.000  1.00 10.00           C  ";
    await assert.rejects(
      () =>
        catalog.mpnn_design_residues.translate(
          form(
            { chains_to_design: "A", design_positions: "11" },
            {
              input: {
                bytes: Buffer.concat([pdb, Buffer.from("\n" + alternate)]),
              },
            },
          ),
          () => {
            throw Error("must not upload");
          },
        ),
      /alternate/,
    );
  }
});

 test("probability export is requested only for an explicitly selected heatmap", async () => {
  for (const value of [undefined, "false", "true"]) {
    const settings = await catalog.mpnn_design_residues.translate(
      form({chains_to_design: "A", design_positions: "11", ...(value === undefined ? {} : {save_probs: value})},
           {input: {bytes: pdb}}), async () => "uploaded.pdb");
    assert.equal(settings.exportGydeProbabilities, value === "true" ? true : undefined);
  }
});
