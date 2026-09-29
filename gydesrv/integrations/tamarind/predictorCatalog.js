import { translateRestraints } from "./restraints.js";
import { HttpError } from "./errors.js";

export function predictorCatalog({ only, integerField }) {
  const parameters = [
    { id: "molecules", name: "Molecules", type: "text", required: true },
    {
      id: "numRecycles",
      name: "Recycles",
      type: "integer",
      default: 3,
      min: 1,
      max: 20,
    },
  ];
  const specifications = [
    {
      id: "af2",
      name: "AlphaFold2",
      tool: "alphafold",
      pattern: /^[^/]+_unrelaxed_rank_00[1-5]_alphafold2[^/]*\.pdb$/,
    },
    {
      id: "chai-1",
      name: "Chai-1",
      tool: "chai",
      pattern: /^pred\.model_idx_[0-4]\.cif$/,
    },
    {
      id: "openfold3-v1",
      name: "OpenFold3",
      tool: "openfold",
      pattern: /^results\/result_sample_[1-5]\.cif$/,
    },
  ];
  return Object.fromEntries(
    specifications.map((spec) => [
      spec.id,
      {
        id: spec.id,
        name: `${spec.name} (Tamarind)`,
        tool: spec.tool,
        version: "1",
        description: `Predict five structures using Tamarind ${spec.name}. Tamarind generates MSAs.`,
        parameters:
          spec.tool === "openfold"
            ? parameters.slice(0, 1)
            : [
                ...parameters,
                ...(spec.tool === "chai"
                  ? [{ id: "restraints", name: "Restraints", type: "text" }]
                  : []),
              ],
        outputs: [
          {
            label: "Predicted structures",
            pattern: spec.pattern,
            min: 5,
            max: 5,
          },
          { label: "Prediction metrics", path: "metrics.csv" },
        ],
        async translate(form) {
          only(
            form,
            spec.tool === "openfold"
              ? ["molecules"]
              : [
                  "molecules",
                  "numRecycles",
                  ...(spec.tool === "chai" ? ["restraints"] : []),
                ],
          );
          let molecules;
          try {
            molecules = JSON.parse(form.fields.molecules);
          } catch {
            throw new HttpError(422, "Invalid molecule inputs");
          }
          if (
            !Array.isArray(molecules) ||
            !molecules.length ||
            molecules.length > 26
          )
            throw new HttpError(422, "Provide between 1 and 26 molecules");
          let total = 0;
          molecules = molecules.map((m, i) => {
            if (
              !m ||
              Object.keys(m).some(
                (k) => !["type", "sequence", "smiles", "chain"].includes(k),
              ) ||
              m.chain !== String.fromCharCode(65 + i)
            )
              throw new HttpError(422, "Invalid molecule chain mapping");
            if (m.type === "ligand") {
              if (
                spec.tool === "alphafold" ||
                typeof m.smiles !== "string" ||
                !m.smiles.length ||
                m.smiles.length > 10000 ||
                /[\r\n\x00]/.test(m.smiles) ||
                m.sequence !== undefined
              )
                throw new HttpError(422, "Invalid ligand input");
              return { type: "ligand", smiles: m.smiles, chain: m.chain };
            }
            const alphabets = {
              protein: /^[ACDEFGHIKLMNPQRSTVWYX]+$/,
              dna: /^[ACGT]+$/,
              rna: /^[ACGU]+$/,
            };
            if (
              !alphabets[m.type]?.test(m.sequence || "") ||
              m.smiles !== undefined ||
              (spec.tool === "alphafold" && m.type !== "protein")
            )
              throw new HttpError(
                422,
                "Invalid polymer sequence for this predictor",
              );
            total += m.sequence.length;
            return { type: m.type, sequence: m.sequence, chain: m.chain };
          });
          if (total > 2500)
            throw new HttpError(
              422,
              "Predict at most 2,500 polymer residues per job",
            );
          if (spec.tool === "alphafold")
            return {
              sequence: molecules.map((m) => m.sequence).join(":"),
              numModels: "5",
              numRecycles: String(integerField(form, "numRecycles", 3, 1, 20)),
              numRelax: 0,
              useMSA: true,
              pairMode: "unpaired_paired",
              templateMode: "none",
              modelType: "auto",
            };
          if (spec.tool === "chai")
            return {
              inputFormat: "molecules",
              molecules,
              ...translateRestraints(form.fields.restraints, molecules, "chai"),
              useMSA: true,
              numSamples: 5,
              numTrunkSamples: 1,
              numBatches: 1,
              numRecycles: integerField(form, "numRecycles", 3, 1, 20),
            };
          return {
            inputFormat: "molecules",
            molecules,
            outputFormat: "cif",
            numSeeds: 1,
            numSamples: 5,
            templateMode: "none",
            chooseBest: false,
            checkpoint: "openfold3-p2-155k",
          };
        },
      },
    ]),
  );
}
