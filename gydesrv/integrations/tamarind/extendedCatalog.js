import { HttpError } from "./errors.js";

export function extendedCatalog({ only, file, parseFasta }) {
  const antibody = (heavy, light) => {
    if (
      !/^[ACDEFGHIKLMNPQRSTVWY]{1,150}$/.test(heavy || "") ||
      !/^[ACDEFGHIKLMNPQRSTVWY]{1,130}$/.test(light || "")
    )
      throw new HttpError(
        422,
        "Provide heavy and light antibody variable domains (up to 150 and 130 residues)",
      );
    return { heavy, light };
  };
  const antibodyServices = Object.fromEntries(
    [2, 3].map((version) => [
      `abodybuilder${version}`,
      {
        id: `abodybuilder${version}`,
        name: `ABodyBuilder${version} (Tamarind)`,
        tool: version === 2 ? "immunebuilder" : "abodybuilder",
        version: "1",
        description: `Antibody variable-domain structure prediction using ABodyBuilder${version}.`,
        parameters: [
          { id: "heavy", name: "Heavy sequence", type: "text", required: true },
          { id: "light", name: "Light sequence", type: "text", required: true },
        ],
        outputs: [
          {
            label: "Predicted structure (PDB)",
            path: version === 2 ? "model.pdb" : "output.pdb",
          },
        ],
        async translate(form) {
          only(form, ["heavy", "light"]);
          const { heavy, light } = antibody(
            form.fields.heavy,
            form.fields.light,
          );
          return version === 2
            ? { modelType: "Antibody", sequence1: heavy, sequence2: light }
            : { heavy, light };
        },
      },
    ]),
  );
  return {
    ...antibodyServices,
    tap: {
      id: "tap",
      name: "TAP (Tamarind)",
      tool: "tap",
      version: "1",
      description:
        "Tamarind TAP2-aligned developability metrics for antibody variable domains.",
      parameters: [
        {
          id: "seq",
          name: "Heavy/light sequences",
          type: "text",
          required: true,
        },
      ],
      outputs: [{ label: "Tamarind TAP scores", path: "results.csv" }],
      async translate(form) {
        only(form, ["seq"]);
        const parts = (form.fields.seq || "").split("/");
        if (parts.length !== 2)
          throw new HttpError(422, "Provide one heavy/light sequence pair");
        const { heavy, light } = antibody(...parts);
        return { heavySequence: heavy, lightSequence: light };
      },
    },
    anarci: {
      id: "anarci",
      name: "ANARCI (Tamarind)",
      tool: "anarci",
      version: "1",
      description:
        "Antibody and T-cell receptor numbering using Tamarind ANARCI.",
      parameters: [
        { id: "input", name: "Sequences", type: "file", required: true },
        {
          id: "scheme",
          name: "Numbering scheme",
          type: "choice",
          default: "kabat",
          choices: ["imgt", "kabat", "chothia", "martin", "aho", "wolfguy"],
        },
      ],
      outputs: [
        {
          label: "Numbering CSV",
          pattern: /^annotated_(?:H|KL|A|B|G|D)\.csv$/,
          min: 0,
          max: 6,
        },
      ],
      async translate(form) {
        only(form, ["input", "scheme"]);
        const sequences = parseFasta(
          file(form, "input").bytes.toString("utf8"),
        );
        if (sequences.length !== 1)
          throw new HttpError(422, "Submit one sequence per ANARCI job");
        if (sequences[0].sequence.length > 10000)
          throw new HttpError(422, "ANARCI accepts at most 10,000 residues");
        const scheme = form.fields.scheme || "kabat";
        if (
          !["imgt", "kabat", "chothia", "martin", "aho", "wolfguy"].includes(
            scheme,
          )
        )
          throw new HttpError(422, "Unsupported numbering scheme");
        return { sequence: sequences[0].sequence.toUpperCase(), scheme };
      },
    },
  };
}
