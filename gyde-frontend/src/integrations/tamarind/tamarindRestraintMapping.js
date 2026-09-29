import { predictorMolecules } from "./tamarindPredictors";
export function translateGydeRestraints(info, restraints, enabled) {
  if (!enabled) return {};
  const molecules = predictorMolecules(info);
  const byColumn = {};
  for (const type of ["protein", "ligand", "dna", "rna"]) {
    molecules
      .filter((m) => m.type === type)
      .forEach((m, i) => {
        byColumn[info.moleculeColumns[type][i]] = m;
      });
  }
  const endpoint = (column, position, isLigand) => {
    const molecule = byColumn[column];
    if (!molecule || (molecule.type === "ligand") !== !!isLigand)
      throw Error("A restraint refers to an unavailable molecule.");
    if (isLigand) return { chain: molecule.chain, position: null };
    const index = info.sequenceColumns.indexOf(column);
    const alignment = info.alignments?.[index] || info.sequences[index];
    if (
      !Number.isInteger(position) ||
      position < 0 ||
      position >= alignment?.length ||
      alignment[position] === "-"
    )
      throw Error("A restraint points to a gap or missing residue.");
    const ungapped = alignment.slice(0, position + 1).replace(/-/g, "").length;
    if (alignment.replace(/-/g, "") !== molecule.sequence)
      throw Error("Restraint alignment does not match the predicted sequence.");
    return { chain: molecule.chain, position: ungapped };
  };
  const mapped = restraints.map((r) => {
    const from = endpoint(r.fromSeqCol, r.fromSeqPos, r.fromLigand);
    const to = endpoint(r.toSeqCol, r.toSeqPos, r.toLigand);
    if (from.position === null && to.position === null)
      throw Error("Select at least one polymer residue for a restraint.");
    if (
      !Number.isFinite(r.minAngstroms) ||
      !Number.isFinite(r.maxAngstroms) ||
      r.minAngstroms < 0 ||
      r.maxAngstroms <= r.minAngstroms
    )
      throw Error("Invalid restraint distance range.");
    return { from, to, min: r.minAngstroms, max: r.maxAngstroms };
  });
  return { restraints: JSON.stringify(mapped) };
}
