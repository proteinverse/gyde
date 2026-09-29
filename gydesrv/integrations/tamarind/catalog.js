import {translateRestraints} from './restraints.js';
import {designCatalog} from './designCatalog.js';
import {predictorCatalog} from './predictorCatalog.js';
import {extendedCatalog} from './extendedCatalog.js';
import { HttpError } from "./errors.js";

// Each entry implements a specific translation, not an arbitrary tool passthrough.
// All implemented entries are exposed; pending services below have no adapter yet.
export const catalog = {
  "mafft-7.475": {
    id: "mafft-7.475",
    name: "MAFFT alignment (Tamarind)",
    tool: "msa-analysis",
    version: "1",
    description:
      "Uses Tamarind MAFFT fast alignment. The installed MAFFT version may differ from GYDE’s original 7.475 service.",
    parameters: [{ id: "input", name: "input", type: "file", required: true }],
    outputs: [{ label: "alignment", path: "alignment.fasta" }],
    async translate(form, upload) {
      only(form, ["input", "part-tree", "sequence-type"]);
      if (
        form.fields["sequence-type"] &&
        form.fields["sequence-type"] !== "amino acid"
      )
        throw new HttpError(422, "Only protein alignment is supported");
      if (form.fields["part-tree"] && form.fields["part-tree"] !== "parttree")
        throw new HttpError(422, "Unsupported MAFFT mode");
      const input = file(form, "input");
      const fasta = parseFasta(input.bytes.toString("utf8"));
      if (fasta.length < 2 || fasta.length > 10000)
        throw new HttpError(
          422,
          "MAFFT requires between 2 and 10,000 sequences",
        );
      return {
        fastaFile: await upload(
          "input.fasta",
          Buffer.from(
            fasta
              .map(({ name, sequence }) => `>${name}\n${sequence}\n`)
              .join(""),
          ),
        ),
        algorithm: "mafft-fast",
        output_format: "fasta",
      };
    },
  },
  "boltz-2": {
    id: "boltz-2",
    name: "Boltz-2 (Tamarind)",
    tool: "boltz",
    version: "1",
    description:
      "Predict protein structures with Tamarind-hosted Boltz-2 (2.2.1). Returns five models with residue confidence. Tamarind generates the MSAs.",
    parameters: [
      {id:"restraints",name:"Restraints",type:"text"},
      {
        id: "sequence",
        name: "Protein sequence",
        type: "text",
        required: true,
      },
      {
        id: "numRecycles",
        name: "Number of recycles",
        type: "integer",
        default: 3,
        min: 1,
        max: 20,
        description: "More recycles increase computation time.",
      },
    ],
    outputs: Array.from({ length: 5 }, (_, i) => [
      {
        label: "Predicted structure (PDB)",
        path: `predictions/result/result_model_${i}.pdb`,
      },
      {
        label: "pLDDT arrays",
        path: `predictions/result/plddt_result_model_${i}.npz`,
      },
    ]).flat(),
    async translate(form) {
      only(form, ["sequence", "numRecycles", "restraints"]);
      const sequence = form.fields.sequence;
      if (
        typeof sequence !== "string" ||
        !/^[ACDEFGHIKLMNPQRSTVWYX]+(:[ACDEFGHIKLMNPQRSTVWYX]+)*$/.test(
          sequence,
        ) ||
        sequence.replaceAll(":", "").length > 2048 ||
        sequence.split(":").length > 26
      )
        throw new HttpError(
          422,
          "Boltz-2 requires protein sequences totaling at most 2,048 residues and 26 chains",
        );
      return {
        inputFormat: "sequence",
        sequence,
        ...translateRestraints(form.fields.restraints,sequence.split(":").map((s,i)=>({type:"protein",sequence:s,chain:String.fromCharCode(65+i)})),"boltz"),
        version: "2.2.1",
        numSamples: 5,
        numRecycles: integerField(form, "numRecycles", 3, 1, 20),
        useMSA: true,
        useBoltzServer: false,
        outputType: "pdb",
        predictAffinity: false,
      };
    },
  },
  thermompnn: {
    id: "thermompnn",
    name: "ThermoMPNN (Tamarind)",
    tool: "thermompnn",
    version: "1",
    description:
      "Tamarind stability scan. Each selected chain requires contiguous PDB residue numbering starting at 1.",
    parameters: [
      { id: "input", name: "input", type: "file", required: true },
      { id: "chain", name: "Chain", type: "text" },
      {
        id: "allChains",
        name: "Keep all chains in context",
        type: "flag",
        default: false,
      },
      {
        id: "topK",
        name: "Max sequences",
        type: "integer",
        default: 10,
        min: 1,
        max: 10000,
      },
    ],
    outputs: [
      { label: "Mutations stability prediction", path: "Chain_results.csv" },
    ],
    async translate(form, upload) {
      only(form, ["input", "chain", "allChains", "topK"]);
      const allChains = booleanField(form, "allChains", false);
      const topK = integerField(form, "topK", 10, 1, 10000);
      const input = file(form, "input"),
        chain = form.fields.chain;
      if (!allChains && !/^[A-Za-z0-9]$/.test(chain || ""))
        throw new HttpError(422, "Choose one PDB chain");
      // GYDE applies CSV position indices directly to its atomic sequence.
      // Refuse gaps/insertion codes until that translation is implemented.
      const pdb = singleModelPdb(input.bytes);
      const selectedChains = allChains
        ? [
            ...new Set(
              pdb
                .toString("utf8")
                .split(/\r?\n/)
                .filter((line) => line.startsWith("ATOM  "))
                .map((line) => line[21]),
            ),
          ].sort()
        : [chain];
      if (
        !selectedChains.length ||
        selectedChains.some((c) => !/^[A-Za-z0-9]$/.test(c || ""))
      )
        throw new HttpError(422, "Use named protein chains for ThermoMPNN");
      for (const selectedChain of selectedChains) {
        const residues = [];
        for (const line of pdb.toString("utf8").split(/\r?\n/)) {
          if (
            !line.startsWith("ATOM  ") ||
            line[21] !== selectedChain ||
            line.slice(12, 16).trim() !== "CA"
          )
            continue;
          if (line[16] !== " " || line[26] !== " ")
            throw new HttpError(
              422,
              "Alternate locations and insertion codes require a residue mapping before ThermoMPNN can run",
            );
          if (
            !new Set([
              "ALA",
              "ARG",
              "ASN",
              "ASP",
              "CYS",
              "GLN",
              "GLU",
              "GLY",
              "HIS",
              "ILE",
              "LEU",
              "LYS",
              "MET",
              "PHE",
              "PRO",
              "SER",
              "THR",
              "TRP",
              "TYR",
              "VAL",
            ]).has(line.slice(17, 20))
          )
            throw new HttpError(
              422,
              "ThermoMPNN currently requires standard amino-acid residues",
            );
          const position = Number(line.slice(22, 26).trim());
          residues.push(position);
        }
        if (!residues.length || residues.some((n, i) => n !== i + 1))
          throw new HttpError(
            422,
            "ThermoMPNN currently requires contiguous chain numbering starting at 1",
          );
      }
      return {
        pdbFile: await upload("input.pdb", pdb),
        chains: selectedChains,
        allChains,
        topK,
        verify: false,
      };
    },
  },
};

Object.assign(catalog, extendedCatalog({only, file, parseFasta}), predictorCatalog({only,integerField}), designCatalog({only,file,integerField,singleModelPdb}));

export const pendingServices = {
  "boltz-1": "Exact predictor version, inputs and confidence outputs",
  abodybuilder: "Model version and Kabat renumbering expectations",
  "collabfold-proxy": "MSA file identifiers and downstream predictor reuse",
};

export function enabledCatalog(ids) {
  for (const id of ids)
    if (!Object.hasOwn(catalog, id))
      throw new Error(`No adapter implementation for GYDE service: ${id}`);
  return Object.fromEntries(ids.map((id) => [id, catalog[id]]));
}
export function only(form, names) {
  for (const key of [...Object.keys(form.fields), ...Object.keys(form.files)]) {
    if (!names.includes(key))
      throw new HttpError(422, `Unsupported parameter: ${key}`);
  }
}
export function file(form, name) {
  const value = form.files[name];
  if (!value?.bytes?.length) throw new HttpError(422, `Upload ${name}`);
  return value;
}
export function parseFasta(text) {
  const rows = [];
  for (const line of text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (line.startsWith(">")) {
      const name = line.slice(1).split(/\s+/)[0];
      if (!name || rows.some((r) => r.name === name))
        throw new HttpError(
          422,
          "FASTA sequence names must be non-empty and unique",
        );
      rows.push({ name, sequence: "" });
    } else {
      if (!rows.length || !/^[ACDEFGHIKLMNPQRSTVWYXBZUO.-]+$/i.test(line))
        throw new HttpError(422, "Invalid protein FASTA");
      // Realignment starts from residues, with either common gap notation removed.
      rows.at(-1).sequence += line.replace(/[-.]/g, "");
    }
  }
  if (!rows.length || rows.some((r) => !r.sequence))
    throw new HttpError(422, "FASTA contains an empty sequence");
  return rows;
}

function singleModelPdb(bytes) {
  const lines = bytes.toString("utf8").split(/\r?\n/);
  const explicit = lines.some((line) => line.slice(0, 6).trim() === "MODEL");
  let models = 0,
    inModel = false;
  const normalized = [];
  for (const line of lines) {
    const record = line.slice(0, 6).trim();
    if (record === "MODEL") {
      if (++models > 1 || inModel)
        throw new HttpError(
          422,
          "This tool requires one PDB model. Select a single model before running.",
        );
      inModel = true;
    } else if (record === "ENDMDL") {
      if (!inModel)
        throw new HttpError(422, "The PDB model boundaries are invalid.");
      inModel = false;
    } else {
      if (explicit && !inModel && ["ATOM", "HETATM"].includes(record))
        throw new HttpError(422, "The PDB contains atoms outside its model.");
      normalized.push(line);
    }
  }
  if (inModel)
    throw new HttpError(422, "The PDB model is missing its ENDMDL record.");
  return explicit ? Buffer.from(normalized.join("\n")) : bytes;
}

function booleanField(form, name, fallback) {
  const value = form.fields[name];
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new HttpError(422, `${name} must be true or false`);
}
function integerField(form, name, fallback, min, max) {
  const raw = form.fields[name];
  if (raw === undefined) return fallback;
  if (
    !/^\d+$/.test(raw) ||
    !Number.isSafeInteger(Number(raw)) ||
    Number(raw) < min ||
    Number(raw) > max
  )
    throw new HttpError(
      422,
      `${name} must be a whole number from ${min} to ${max}`,
    );
  return Number(raw);
}
