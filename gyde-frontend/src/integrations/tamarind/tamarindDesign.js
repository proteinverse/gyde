// Tamarind runs the modern LigandMPNN implementation for both design models.
// Its FASTA contains all protein chains, sorted by chain ID (data_utils.mask_c).
export function parseTamarindDesign(
  text,
  chainData,
  designMapping,
  separator = ":",
) {
  const records = [];
  for (const line of text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (line.startsWith(">")) records.push({ header: line.slice(1), seq: "" });
    else {
      if (!records.length || !/^[ACDEFGHIKLMNPQRSTVWYX:]+$/.test(line))
        throw Error("Invalid Tamarind design FASTA.");
      records[records.length - 1].seq += line;
    }
  }
  const chains = Object.keys(chainData).sort();
  if (records.length < 2 || !chains.length)
    throw Error("No designed sequences were returned.");
  const reference = chains.map((chain) => chainData[chain].rawAtomicSequence);
  if (records[0].seq !== reference.join(":"))
    throw Error(
      "The design structure changed chain sequences; results cannot be mapped safely.",
    );
  const selected = Object.fromEntries(
    chains.map((chain) => [
      chain,
      new Set((designMapping[chain] || []).map(String)),
    ]),
  );
  return records.map((record, index) => {
    const seqs = record.seq.split(":");
    if (
      seqs.length !== chains.length ||
      seqs.some((seq, i) => seq.length !== reference[i].length)
    )
      throw Error("Designed chain lengths do not match the structure.");
    seqs.forEach((seq, i) => {
      for (let p = 0; p < seq.length; p++) {
        if (
          seq[p] !== reference[i][p] &&
          !selected[chains[i]].has(String(chainData[chains[i]].rawNumbering[p]))
        )
          throw Error(
            "The result changed a residue outside the selected design positions.",
          );
      }
    });
    const result = {
      seq: seqs.join(separator),
      designed_chains: JSON.stringify(chains),
      ...(index ? { id: index, sample: index } : {}),
    };
    if (index) {
      for (const key of [
        "overall_confidence",
        "ligand_confidence",
        "seq_rec",
      ]) {
        const match = new RegExp(`(?:^|,\\s*)${key}=([^,]+)`).exec(
          record.header,
        );
        const value = match ? Number(match[1]) : NaN;
        if (!Number.isFinite(value) || value < 0 || value > 1)
          throw Error(`Invalid ${key} in Tamarind design results.`);
        result[key] = value;
      }
      result.seq_recovery = result.seq_rec;
    }
    return result;
  });
}

export function tamarindDesignProbabilities(data, chainData, designMapping) {
  if (data?.version !== 1 || data.alphabet !== "ACDEFGHIKLMNPQRSTVWYX")
    throw Error("Unsupported Tamarind probability output.");
  const result = {};
  for (const [chain, info] of Object.entries(chainData)) {
    const values = data.chains?.[chain];
    if (
      values?.sequence !== info.rawAtomicSequence ||
      JSON.stringify(values.residues) !== JSON.stringify(info.rawNumbering) ||
      values.probabilities?.length !== info.rawNumbering.length
    )
      throw Error("Probability residue mapping does not match the structure.");
    const selected = new Set((designMapping[chain] || []).map(String));
    result[chain] = values.probabilities.map((row, i) => {
      if (
        !Array.isArray(row) ||
        row.length !== 21 ||
        row.some(
          (p) =>
            p !== null &&
            (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1),
        )
      )
        throw Error("Invalid amino-acid probabilities.");
      return selected.has(String(info.rawNumbering[i]))
        ? row
        : row.map(() => null);
    });
  }
  return result;
}
