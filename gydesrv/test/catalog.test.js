import test from "node:test";
import assert from "node:assert/strict";
import { catalog, enabledCatalog } from "../integrations/tamarind/catalog.js";
test("MAFFT uploads ungapped FASTA and rejects invalid or empty sequences before upload", async () => {
  const form = (text) => ({
    fields: {},
    files: { input: { bytes: Buffer.from(text) } },
  });
  let uploaded;
  const settings = await catalog["mafft-7.475"].translate(
    form(">first description\r\nA.C-\r\nD\r\n>second\n-A.D.\n"),
    async (name, bytes) => {
      uploaded = { name, text: bytes.toString("utf8") };
      return "uploaded.fasta";
    },
  );
  assert.deepEqual(uploaded, {
    name: "input.fasta",
    text: ">first\nACD\n>second\nAD\n",
  });
  assert.equal(settings.fastaFile, "uploaded.fasta");
  for (const text of [
    ">a\n...--\n>b\nACD\n",
    ">a\nAC!\n>b\nACD\n",
    ">a\nACD\n>a\nACF\n",
    ">a\nACD\n",
  ]) {
    await assert.rejects(
      catalog["mafft-7.475"].translate(form(text), async () => {
        assert.fail("Invalid alignment input must never upload");
      }),
      { status: 422 },
    );
  }
});
test("ThermoMPNN preserves selected chain and refuses positional ambiguity", async () => {
  const atom = (n) =>
    `ATOM      1  CA  ALA A${String(n).padStart(4)}    0.000   0.000   0.000`;
  const form = {
    fields: { chain: "A" },
    files: { input: { bytes: Buffer.from([atom(1), atom(2)].join("\n")) } },
  };
  const settings = await catalog.thermompnn.translate(
    form,
    async () => "uploaded.pdb",
  );
  assert.deepEqual(settings, {
    pdbFile: "uploaded.pdb",
    chains: ["A"],
    allChains: false,
    topK: 10,
    verify: false,
  });
  await assert.rejects(
    catalog.thermompnn.translate(
      {
        ...form,
        files: { input: { bytes: Buffer.from([atom(1), atom(3)].join("\n")) } },
      },
      async () => "",
    ),
    { status: 422 },
  );
  assert.throws(() => enabledCatalog(["model_rosetta_energy"]));
  await assert.rejects(
    catalog.thermompnn.translate(
      {
        ...form,
        files: { input: { bytes: Buffer.from(atom(1).replace("ALA", "UNK")) } },
      },
      async () => {
        throw new Error("Invalid residues must be rejected before upload");
      },
    ),
    { status: 422 },
  );
});

test("ThermoMPNN accepts and normalizes one explicit AlphaFold-style PDB model", async () => {
  const atom = "ATOM      1  CA  ALA A   1    0.000   0.000   0.000";
  const form = (text) => ({
    fields: { chain: "A" },
    files: { input: { bytes: Buffer.from(text) } },
  });
  let uploaded;
  await catalog.thermompnn.translate(
    form(`HEADER test\nMODEL        1\n${atom}\nENDMDL\nEND\n`),
    async (_name, bytes) => {
      uploaded = bytes.toString();
      return "input.pdb";
    },
  );
  assert.equal(uploaded, `HEADER test\n${atom}\nEND\n`);
  for (const text of [
    `MODEL        1\n${atom}\nENDMDL\nMODEL        2\n${atom}\nENDMDL`,
    `MODEL        1\n${atom}`,
    `${atom}\nENDMDL`,
    `${atom}\nMODEL        1\n${atom}\nENDMDL`,
    `MODEL        1\n${atom}\nENDMDL\n${atom}`,
  ]) {
    await assert.rejects(
      catalog.thermompnn.translate(form(text), async () =>
        assert.fail("Invalid model must not upload"),
      ),
      { status: 422 },
    );
  }
});

test("Boltz-2 uses Tamarind hosted compute and MSA with explicit version and output contract", async () => {
  const adapter = catalog["boltz-2"];
  assert.deepEqual(
    await adapter.translate({
      fields: { sequence: "ACD:EFG", numRecycles: "4" },
      files: {},
    }),
    {
      inputFormat: "sequence",
      sequence: "ACD:EFG",
      version: "2.2.1",
      numSamples: 5,
      numRecycles: 4,
      useMSA: true,
      useBoltzServer: false,
      outputType: "pdb",
      predictAffinity: false,
    },
  );
  assert.equal(adapter.outputs.length, 10);
  assert.equal(
    adapter.outputs[0].path,
    "predictions/result/result_model_0.pdb",
  );
  assert.equal(
    adapter.outputs[9].path,
    "predictions/result/plddt_result_model_4.npz",
  );
  for (const fields of [
    { sequence: "" },
    { sequence: "ACD:" },
    { sequence: "A".repeat(2049) },
    { sequence: "ACD", numRecycles: "0" },
    { sequence: "ACD", numRecycles: "2.5" },
    { sequence: "ACD", numRecycles: "21" },
    { sequence: "ACD", useBoltzServer: "true" },
    { sequence: "ACD", yamlFile: "untrusted.yaml" },
  ]) {
    await assert.rejects(adapter.translate({ fields, files: {} }), {
      status: 422,
    });
  }
});
test("ThermoMPNN validates every chain in all-chain mode and forwards output settings", async () => {
  const atom = (chain) =>
    `ATOM      1  CA  ALA ${chain}   1    0.000   0.000   0.000`;
  const form = {
    fields: { allChains: "true", topK: "12" },
    files: { input: { bytes: Buffer.from([atom("B"), atom("A")].join("\n")) } },
  };
  assert.deepEqual(
    await catalog.thermompnn.translate(form, async () => "input.pdb"),
    {
      pdbFile: "input.pdb",
      chains: ["A", "B"],
      allChains: true,
      verify: false,
      topK: 12,
    },
  );
  for (const fields of [
    { allChains: "yes" },
    { allChains: "true", topK: "0" },
    { allChains: "true", topK: "1.5" },
  ]) {
    await assert.rejects(
      catalog.thermompnn.translate({ ...form, fields }, async () =>
        assert.fail(),
      ),
      { status: 422 },
    );
  }
  await assert.rejects(
    catalog.thermompnn.translate(
      {
        ...form,
        files: {
          input: {
            bytes: Buffer.from(
              atom("A") + "\n" + atom("B").replace("ALA", "UNK"),
            ),
          },
        },
      },
      async () => assert.fail(),
    ),
    { status: 422 },
  );
});
