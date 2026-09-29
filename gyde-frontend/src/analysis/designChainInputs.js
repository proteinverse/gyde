export function designChainInputs(
  structureChains,
  tamarind,
  legacyProteinOffsets = false,
) {
  const sequences = {},
    residues = {};
  for (const [chain, data] of Object.entries(structureChains)) {
    sequences[chain] = tamarind
      ? data.rawAtomicSequence
      : data.mpnnAtomicSequence;
    residues[chain] = tamarind
      ? data.rawNumbering
      : legacyProteinOffsets
        ? data.mpnnNumbering.map((_, i) => i + 1)
        : data.mpnnNumbering;
  }
  return { sequences, residues };
}
