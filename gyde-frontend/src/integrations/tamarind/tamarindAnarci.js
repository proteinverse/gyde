import { csvParse } from "d3-dsv";

// Preserve the runner's column order: some numbering schemes place insertion
// codes before their numbered position, so numeric sorting would corrupt it.
export function parseAnarciCsv(text, sequence) {
  const rows = csvParse(text);
  const positions = rows.columns.filter((column) => /^\d+[A-Z]*$/.test(column));
  if (!positions.length && rows.length)
    throw Error("ANARCI returned no numbering columns");
  return rows.map((row) => {
    const start = Number(row.seqstart_index),
      end = Number(row.seqend_index);
    if (
      !row.seqstart_index ||
      !row.seqend_index ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end >= sequence.seq.length
    )
      throw Error("ANARCI returned invalid sequence coordinates");
    const chain = row.chain_type === "K" ? "L" : row.chain_type;
    if (!/^[HLABGD]$/.test(chain || ""))
      throw Error("ANARCI returned an unknown chain type");
    const alignment = positions.map((column) => {
      const [, number, insertCode] = /^(\d+)([A-Z]*)$/.exec(column);
      const match = row[column];
      if (!/^[ACDEFGHIKLMNPQRSTVWYX-]$/.test(match || ""))
        throw Error("ANARCI returned an invalid numbered residue");
      return { chainName: chain, modelPos: Number(number), insertCode, match };
    });
    if (
      alignment
        .map((x) => x.match)
        .join("")
        .replaceAll("-", "") !== sequence.seq.slice(start, end + 1)
    )
      throw Error("ANARCI numbering does not match the submitted sequence");
    return {
      seqName: sequence.name,
      baseSeqStart: start + 1,
      baseSeqEnd: end + 1,
      score: Number(row.score),
      expect: Number(row["e-value"]),
      alignment,
    };
  });
}
