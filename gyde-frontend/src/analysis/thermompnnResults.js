import { aosToSoa } from "../utils/utils";

// Tamarind indexes mutations across the concatenation of selected chains.
// Preserve separate sequence columns so mutations remain attached to the correct chain.
export function thermompnnResults(
  results,
  chainData,
  chains,
  structure,
  jobName,
  limit,
) {
  const sequences = chains.map((chain) => chainData[chain].mpnnAtomicSequence);
  const numbering = chains.map((chain) =>
    chainData[chain].mpnnNumbering.map((value, i) => ({
      start: i + 1,
      end: i + 1,
      value: { residueNumber: value },
    })),
  );
  const columns = chains.map((_, i) =>
    i === 0 ? "sequence" : `sequence_${i + 1}`,
  );
  const referenceColumns = columns.map((column) => `${column}_base`);
  const positions = chains.flatMap((chain, chainIndex) =>
    sequences[chainIndex]
      .split("")
      .map((wildtype, index) => ({
        chain,
        chainIndex,
        index,
        wildtype,
        residue: numbering[chainIndex][index]?.value.residueNumber,
      })),
  );
  if (!results.length)
    throw Error("Tamarind returned no ThermoMPNN mutations.");
  const rows = results
    .map((result) => {
      const position = Number(result.position),
        score = Number(result.ddG_pred);
      const mapped = positions[position];
      if (
        String(result.position).trim() === "" ||
        !Number.isInteger(position) ||
        !mapped ||
        mapped.wildtype !== result.wildtype ||
        !/^[ACDEFGHIKLMNPQRSTVWY]$/.test(result.mutation) ||
        String(result.ddG_pred).trim() === "" ||
        !Number.isFinite(score)
      ) {
        throw Error(
          "Tamarind returned a mutation that cannot be mapped to the selected structure.",
        );
      }
      const mutated = [...sequences];
      const residues = mutated[mapped.chainIndex].split("");
      residues[mapped.index] = result.mutation;
      mutated[mapped.chainIndex] = residues.join("");
      const name = `${chains.length > 1 ? mapped.chain + ":" : ""}${result.wildtype}${mapped.residue}${result.mutation}`;
      return { name, sequences: mutated, score };
    })
    .sort((a, b) => a.score - b.score);
  const selected = limit === null ? rows : rows.slice(0, limit);
  const records = [{ name: "ref", sequences, score: 0 }, ...selected].map(
    (row) => ({
      seqid: row.name,
      concept_name: row.name,
      seed: jobName,
      ddG_pred: row.score,
      structure_url: structure,
      structure_chains: chains,
      structure_residue_numbering: numbering,
      ...Object.fromEntries(
        columns.map((column, i) => [column, row.sequences[i]]),
      ),
      ...Object.fromEntries(
        referenceColumns.map((column, i) => [column, sequences[i]]),
      ),
    }),
  );
  return {
    columnarData: aosToSoa(records),
    dataColumns: ["seqid", "concept_name", "seed", ...columns, "ddG_pred"],
    dataRowCount: records.length,
    alignmentKey: "seqs",
    seqColumns: columns.map((column, i) => ({
      column,
      numbering: numbering[i].map((r) => r.value.residueNumber),
    })),
    seqColumnNames: chains.map((chain) => `Chain ${chain}`),
    seqRefColumns: referenceColumns.map((column) => ({ column })),
    isAntibody: false,
    isHeatmapVisible: true,
    heatmapSelectedColumn: "ddG_pred",
    msaDataFields: ["Names", "ddG_pred"],
    nameColumn: "concept_name",
    refNameColumn: "seed",
    name: `ThermoMPNN: ${jobName}`,
  };
}
