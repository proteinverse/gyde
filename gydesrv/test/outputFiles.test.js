import test from "node:test";
import assert from "node:assert/strict";
import { outputFiles } from "../integrations/tamarind/outputFiles.js";
test("dynamic result names remain within the authenticated job and sort deterministically", () => {
  const out = [
    { label: "models", pattern: /^models\/model_\d+\.pdb$/, max: 5 },
  ];
  assert.deepEqual(
    outputFiles(
      out,
      [
        "other/job/models/model_1.pdb",
        "me/job/models/model_10.pdb",
        "me/job/models/model_2.pdb",
        "me/job/../models/model_1.pdb",
      ],
      "me/job/",
    ).map((x) => x.path),
    ["models/model_2.pdb", "models/model_10.pdb"],
  );
  assert.throws(() => outputFiles(out, [], "me/job/"), /Unexpected number/);
  assert.throws(() =>
    outputFiles(
      [{ ...out[0], max: 1 }],
      ["me/job/models/model_1.pdb", "me/job/models/model_2.pdb"],
      "me/job/",
    ),
  );
});
test("fixed outputs and optional chain-specific outputs remain exact", () => {
  assert.deepEqual(
    outputFiles(
      [{ label: "csv", path: "annotated_H.csv", min: 0 }],
      ["me/job/annotated_K.csv"],
      "me/job/",
    ),
    [],
  );
  assert.throws(() =>
    outputFiles(
      [{ label: "pdb", path: "output.pdb" }],
      ["me/job/not-output.pdb"],
      "me/job/",
    ),
  );
});
