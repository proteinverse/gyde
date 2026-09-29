export function tamarindBoltzInput({
  proteinSequences = [],
  ligands = [],
  dnas = [],
  rnas = [],
}) {
  if (ligands.length || dnas.length || rnas.length) {
    throw Error(
      "This Tamarind Boltz-2 integration supports protein chains only. Remove ligand, DNA and RNA inputs before predicting.",
    );
  }
  if (
    !proteinSequences.length ||
    proteinSequences.length > 26 ||
    proteinSequences.some(
      (sequence) => !/^[ACDEFGHIKLMNPQRSTVWYX]+$/.test(sequence),
    ) ||
    proteinSequences.join("").length > 2048
  ) {
    throw Error(
      "Select protein sequences totaling at most 2,048 residues and 26 chains.",
    );
  }
  return { sequence: proteinSequences.join(":") };
}

export function singleBoltzRow(infos) {
  const selected = new Set(infos.flatMap(info => Array.from(info.selectedIndices ?? info.dataIndices)));
  if (selected.size !== 1 || !infos.length) {
    throw Error('Select one dataset row to run Boltz-2. Each job predicts five models for its protein chains.');
  }
  // Visible structures carry the same dataset sequences. They must not launch
  // duplicate sequence-only predictions for the same selected row.
  return [infos[0]];
}

export function boltzReconnectRows(infos) {
  const rows = new Map();
  for (const info of infos) {
    for (const index of info.dataIndices) {
      if (!rows.has(index)) rows.set(index, {...info, dataIndices: [index]});
    }
  }
  return [...rows.values()];
}
