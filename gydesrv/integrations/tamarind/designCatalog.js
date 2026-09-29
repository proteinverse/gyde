import { HttpError } from "./errors.js";

export function designCatalog({ only, file, integerField, singleModelPdb }) {
  return Object.fromEntries(
    [false, true].map((ligand) => {
      const id = ligand ? "ligand_mpnn" : "mpnn_design_residues";
      const inputKey = ligand ? "pdb_path" : "input",
        countKey = ligand ? "batch_size" : "num_seq_per_target";
      const selectionKeys = ligand
        ? ["redesigned_residues"]
        : ["chains_to_design", "design_positions"];
      return [
        id,
        {
          id,
          name: ligand ? "LigandMPNN (Tamarind)" : "ProteinMPNN (Tamarind)",
          tool: ligand ? "ligandmpnn" : "proteinmpnn",
          version: "1",
          description:
            "Design selected structure residues using Tamarind MPNN.",
          parameters: [
            ...(!ligand
              ? [
                  {
                    id: "save_probs",
                    name: "Save per-position probabilities",
                    type: "flag",
                    default: false,
                  },
                ]
              : []),
            { id: inputKey, name: "Structure", type: "file", required: true },
            ...selectionKeys.map((id) => ({
              id,
              name: id,
              type: "text",
              required: true,
            })),
            {
              id: countKey,
              name: "Number of sequences",
              type: "integer",
              default: 20,
              min: 1,
              max: 1000,
            },
            {
              id: "temperature",
              name: "Sampling temperature",
              type: "decimal",
              default: 0.1,
              min: 0.01,
              max: 1,
            },
            {
              id: "omitAAs",
              name: "Amino acids to omit (empty = none)",
              type: "text",
              default: "C",
            },
            {
              id: "seed",
              name: "Random seed",
              type: "integer",
              min: 0,
              max: 2147483647,
            },
          ],
          outputs: [
            ...(!ligand
              ? [
                  {
                    label: "Tamarind probability heatmap",
                    path: "gyde_probabilities.json",
                    min: 0,
                  },
                ]
              : []),
            {
              label: ligand ? "sequence" : "Output design file",
              pattern: /^seqs\/[^/]+\.fa$/,
              min: 1,
              max: 1,
            },
          ],
          async translate(form, upload) {
            only(form, [
              inputKey,
              countKey,
              ...selectionKeys,
              "temperature",
              "omitAAs",
              "seed",
              ...(!ligand ? ["save_probs"] : []),
            ]);
            if (
              !ligand &&
              form.fields.save_probs !== undefined &&
              !["true", "false"].includes(form.fields.save_probs)
            )
              throw new HttpError(422, "save_probs must be true or false");
            const pdb = singleModelPdb(file(form, inputKey).bytes);
            const residues = new Map();
            for (const line of pdb.toString("utf8").split(/\r?\n/)) {
              if (
                (line.startsWith("ATOM  ") || line.startsWith("HETATM")) &&
                line[16] !== " "
              ) {
                throw new HttpError(
                  422,
                  "Choose one alternate location for every protein and ligand atom before design",
                );
              }
              if (
                !line.startsWith("ATOM  ") ||
                line.slice(12, 16).trim() !== "CA"
              )
                continue;
              const chain = line[21],
                residue = line.slice(22, 27).trim();
              if (
                !/^[A-Za-z0-9]$/.test(chain || "") ||
                !/^-?\d+[A-Za-z]?$/.test(residue) ||
                line[16] !== " "
              )
                throw new HttpError(
                  422,
                  "Use named PDB chains without alternate atom locations",
                );
              const key = chain + ":" + residue;
              if (residues.has(key))
                throw new HttpError(
                  422,
                  "Duplicate protein residue identifiers",
                );
              residues.set(key, true);
            }
            if (!residues.size)
              throw new HttpError(
                422,
                "No protein residues found in the structure",
              );
            const designedResidues = {};
            const add = (chain, residue) => {
              if (!residues.has(chain + ":" + residue))
                throw new HttpError(
                  422,
                  `Selected residue ${chain}${residue} is absent from the structure`,
                );
              (designedResidues[chain] ||= new Set()).add(residue);
            };
            if (ligand) {
              for (const token of (form.fields.redesigned_residues || "")
                .trim()
                .split(/\s+/)) {
                const match = /^([A-Za-z0-9])(-?\d+[A-Za-z]?)$/.exec(token);
                if (!match)
                  throw new HttpError(422, "Invalid selected residue");
                add(match[1], match[2]);
              }
            } else {
              const chains = (form.fields.chains_to_design || "")
                .trim()
                .split(/\s+/);
              const groups = (form.fields.design_positions || "")
                .split(",")
                .map((s) => s.trim());
              if (
                chains.length !== groups.length ||
                new Set(chains).size !== chains.length
              )
                throw new HttpError(422, "Invalid design chain mapping");
              groups.forEach((group, i) =>
                group
                  .split(/\s+/)
                  .forEach((residue) => add(chains[i], residue)),
              );
            }
            const temperature = Number(form.fields.temperature ?? 0.1);
            if (
              !Number.isFinite(temperature) ||
              temperature < 0.01 ||
              temperature > 1
            )
              throw new HttpError(
                422,
                "Temperature must be between 0.01 and 1",
              );
            const omitAAs =
              form.fields.omitAAs === undefined
                ? "C"
                : form.fields.omitAAs.trim();
            if (
              omitAAs !== "empty" &&
              !/^[ACDEFGHIKLMNPQRSTVWY]*$/.test(omitAAs)
            )
              throw new HttpError(422, "Invalid amino acids to omit");
            if (new Set(omitAAs).size === 20)
              throw new HttpError(
                422,
                "Allow at least one amino acid for design",
              );
            return {
              pdbFile: await upload("input.pdb", pdb),
              designedChains: Object.keys(designedResidues),
              designedResidues: Object.fromEntries(
                Object.entries(designedResidues).map(([k, v]) => [
                  k,
                  [...v].join(" "),
                ]),
              ),
              numSequences: integerField(form, countKey, 20, 1, 1000),
              temperature,
              omitAAs: omitAAs || "empty",
              noiseLevel: "0.02",
              verifySequences: "verify-none",
              ...(!ligand && form.fields.save_probs === "true"
                ? { exportGydeProbabilities: true }
                : {}),
              ...(form.fields.seed !== undefined
                ? { seed: integerField(form, "seed", 0, 0, 2147483647) }
                : {}),
            };
          },
        },
      ];
    }),
  );
}
