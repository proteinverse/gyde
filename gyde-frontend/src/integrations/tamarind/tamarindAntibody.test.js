import { parseAnarciCsv } from "./tamarindAnarci";
import { parseTamarindTap } from "./tamarindTap";

const numbering =
  "Id,domain_no,hmm_species,chain_type,e-value,score,seqstart_index,seqend_index,1,2,3,3A\ninput,0,human,K,1e-20,100,1,3,A,-,C,D";
test("ANARCI preserves insertion codes, light chain identity and inclusive coordinates", () => {
  const [result] = parseAnarciCsv(numbering, {
    name: "row_light",
    seq: "MACDK",
  });
  expect(result.seqName).toBe("row_light");
  expect(result.baseSeqStart).toBe(2);
  expect(result.baseSeqEnd).toBe(4);
  expect(result.alignment[3]).toEqual({
    chainName: "L",
    modelPos: 3,
    insertCode: "A",
    match: "D",
  });
});
test("ANARCI refuses numbering for a different sequence", () => {
  expect(() => parseAnarciCsv(numbering, { name: "x", seq: "MAAEK" })).toThrow(
    "does not match",
  );
});
test("ANARCI accepts a header-only no-hit result", () => {
  expect(parseAnarciCsv("Id,domain_no", { name: "x", seq: "ACD" })).toEqual([]);
});
test("TAP retains current scientific names and scores without inventing reference distributions", () => {
  const result = parseTamarindTap(
    "PSH,PPC,PNC,CDR Length,SFvCSP,PSH_traffic_light\n100,2,3,45,-0.1,green",
  );
  expect(result.TAP2_PSH).toBe(100);
  expect(result.graph_psh).toEqual({
    tamarindMetric: {
      name: "Surface hydrophobicity",
      value: 100,
      flag: "green",
    },
  });
  expect(result.TAP2_CDR_Length).toBe(45);
  expect(result.Patch_Hydrophob_CDR).toBeUndefined();
});
test.each(["", "NaN", "Infinity"])(
  "TAP rejects an invalid metric (%s)",
  (value) => {
    expect(() =>
      parseTamarindTap(`PSH,PPC,PNC,CDR Length,SFvCSP\n${value},2,3,45,1`),
    ).toThrow();
  },
);
