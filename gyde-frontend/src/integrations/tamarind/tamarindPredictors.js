import { csvParse } from "d3-dsv";

export const tamarindPredictors = {
  af2: { name: "AlphaFold2", key: "af2" },
  "chai-1": { name: "Chai-1", key: "chai" },
  "openfold3-v1": { name: "OpenFold3", key: "of3v1" },
};
export function predictorMolecules(info, method) {
  const molecules = [];
  for (const [type, values] of [
    ["protein", info.proteinSequences],
    ["ligand", info.ligands],
    ["dna", info.dnas],
    ["rna", info.rnas],
  ]) {
    for (const value of values || []) {
      molecules.push({
        type,
        [type === "ligand" ? "smiles" : "sequence"]: value,
        chain: String.fromCharCode(65 + molecules.length),
      });
    }
  }
  if (!molecules.length || molecules.length > 26)
    throw Error("Select between 1 and 26 molecules.");
  const alphabets = {
    protein: /^[ACDEFGHIKLMNPQRSTVWYX]+$/,
    dna: /^[ACGT]+$/,
    rna: /^[ACGU]+$/,
  };
  for (const molecule of molecules) {
    if (method === "af2" && molecule.type !== "protein")
      throw Error("AlphaFold2 accepts protein chains only.");
    if (molecule.type === "ligand") {
      if (
        typeof molecule.smiles !== "string" ||
        !molecule.smiles.length ||
        molecule.smiles.length > 10000 ||
        /[\r\n\x00]/.test(molecule.smiles)
      )
        throw Error("Invalid ligand SMILES.");
    } else if (!alphabets[molecule.type].test(molecule.sequence || ""))
      throw Error(`Invalid ${molecule.type} sequence.`);
  }
  if (
    molecules.reduce((total, m) => total + (m.sequence?.length || 0), 0) > 2500
  )
    throw Error("Select at most 2,500 polymer residues per prediction.");
  return molecules;
}
export function rankedPredictions(method, files, csv) {
  const rows = csvParse(csv);
  if (rows.length !== 5 || files.length !== 5)
    throw Error("Expected five completed prediction models and their scores.");
  const models = rows.map((row) => {
    let path, score;
    if (method === "af2") {
      if (!/^0*[1-5]$/.test(row.Rank || ""))
        throw Error("Invalid AlphaFold2 rank.");
      path = row["Pdb Path"];
      score = -Number(row.Rank);
    } else if (method === "chai-1") {
      const match = /^scores\.model_idx_(\d+)\.json$/.exec(row.filename || "");
      if (!match) throw Error("Invalid Chai model identifier.");
      path = `pred.model_idx_${match[1]}.cif`;
      score = row.aggregate_score?.trim() ? Number(row.aggregate_score) : NaN;
    } else {
      if (!/^[1-5]$/.test(row.Model || ""))
        throw Error("Invalid OpenFold3 model identifier.");
      path = `results/result_sample_${row.Model}.cif`;
      score = row.sample_ranking_score?.trim()
        ? Number(row.sample_ranking_score)
        : NaN;
    }
    const file = files.find((file) => file.path === path);
    if (!file || !Number.isFinite(score))
      throw Error("Prediction scores do not match the returned structures.");
    return { file, score };
  });
  if (new Set(models.map((m) => m.file.path)).size !== 5)
    throw Error("Duplicate prediction model identifiers.");
  return models.sort((a, b) => b.score - a.score);
}

export function tamarindAntibodyInput({
  hc,
  lc,
  proteinSequences = [],
  ligands = [],
  dnas = [],
  rnas = [],
}) {
  if (
    proteinSequences.length !== 2 ||
    ligands.length ||
    dnas.length ||
    rnas.length ||
    !/^[ACDEFGHIKLMNPQRSTVWY]{1,150}$/.test(hc || "") ||
    !/^[ACDEFGHIKLMNPQRSTVWY]{1,130}$/.test(lc || "")
  ) {
    throw Error(
      "Select one heavy/light variable-domain pair (up to 150/130 residues) without other molecules.",
    );
  }
  return { heavy: hc, light: lc };
}
