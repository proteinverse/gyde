import test from "node:test";
import assert from "node:assert/strict";
import { catalog } from "../integrations/tamarind/catalog.js";
import { outputFiles } from "../integrations/tamarind/outputFiles.js";
const form = (fields = {}, files = {}) => ({ fields, files });
test("TAP maps a heavy/light variable-domain pair to current Tamarind TAP", async () => {
  assert.deepEqual(await catalog.tap.translate(form({ seq: "ACDE/FGHI" })), {
    heavySequence: "ACDE",
    lightSequence: "FGHI",
  });
  await assert.rejects(
    () => catalog.tap.translate(form({ seq: "ACDE" })),
    /pair/,
  );
  await assert.rejects(
    () => catalog.tap.translate(form({ seq: "A".repeat(151) + "/FGHI" })),
    /variable domains/,
  );
});
test("ANARCI submits one sequence and recognizes combined light-chain CSV", async () => {
  assert.deepEqual(
    await catalog.anarci.translate(
      form(
        { scheme: "kabat" },
        { input: { bytes: Buffer.from(">test\nACDE") } },
      ),
    ),
    { sequence: "ACDE", scheme: "kabat" },
  );
  assert.deepEqual(
    outputFiles(
      catalog.anarci.outputs,
      ["u/j/annotated_KL.csv", "u/j/annotated_H.csv"],
      "u/j/",
    ).map((x) => x.path),
    ["annotated_H.csv", "annotated_KL.csv"],
  );
  assert.deepEqual(outputFiles(catalog.anarci.outputs, [], "u/j/"), []);
  await assert.rejects(
    () =>
      catalog.anarci.translate(
        form(
          { scheme: "invalid" },
          { input: { bytes: Buffer.from(">t\nACDE") } },
        ),
      ),
    /scheme/,
  );
});
