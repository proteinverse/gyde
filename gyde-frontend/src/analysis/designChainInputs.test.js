import { designChainInputs } from "./designChainInputs";
test("Tamarind design maps raw sequence residues to author IDs, not padded offsets", () => {
  const data = {
    A: {
      rawAtomicSequence: "ACD",
      rawNumbering: ["10", "10A", "12"],
      mpnnAtomicSequence: "ACXD",
      mpnnNumbering: ["10", "10A", "", "12"],
    },
  };
  expect(designChainInputs(data, true, true)).toEqual({
    sequences: { A: "ACD" },
    residues: { A: ["10", "10A", "12"] },
  });
});
