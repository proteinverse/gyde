import test from "node:test";
import assert from "node:assert/strict";
import { translateRestraints } from "../integrations/tamarind/restraints.js";
const molecules = [
  { chain: "A", type: "protein", sequence: "ACD" },
  { chain: "B", type: "ligand", smiles: "CCO" },
];
const row = {
  from: { chain: "A", position: 2 },
  to: { chain: "B", position: null },
  min: 1,
  max: 6,
};
test("Chai pocket puts ligand first and retains both distance bounds", () => {
  const {
    restraints: [r],
  } = translateRestraints(JSON.stringify([row]), molecules, "chai");
  assert.equal(r.chainA, "B");
  assert.equal(r.res_idxA, "");
  assert.equal(r.res_idxB, "2");
  assert.equal(r.connection_type, "pocket");
  assert.equal(r.min_distance_angstrom, 1);
  assert.equal(r.max_distance_angstrom, 6);
});
test("Boltz maps even one restraint and uses its upper distance bound", () => {
  const result = translateRestraints(JSON.stringify([row]), molecules, "boltz");
  assert.deepEqual(result.pocketRestraints, [
    {
      binderChain: "B",
      pocketChain: "A",
      pocketContacts: [2],
      max_distance_angstrom: 6,
    },
  ]);
});
test("invalid residues and distance values never reach the runner", () => {
  assert.throws(
    () =>
      translateRestraints(
        JSON.stringify([{ ...row, from: { chain: "A", position: 4 } }]),
        molecules,
        "chai",
      ),
    /residue/,
  );
  assert.throws(
    () =>
      translateRestraints(
        JSON.stringify([{ ...row, min: 10 }]),
        molecules,
        "chai",
      ),
    /distance/,
  );
});
