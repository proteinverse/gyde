import { parseCifText } from "molstar/lib/mol-io/reader/cif/text/parser";

// Preserve author chain/residue identifiers used by the residue-selection UI,
// including ligand atoms. Refuse values PDB cannot represent without remapping.
export async function designPdb(text, format) {
  if (format === "pdb") return text;
  if (format !== "mmcif") throw Error("Choose a PDB or mmCIF structure.");
  const parsed = await parseCifText(text).run();
  if (parsed.isError || parsed.result.blocks.length !== 1)
    throw Error("Choose one valid mmCIF structure.");
  const atoms = parsed.result.blocks[0].categories.atom_site;
  if (!atoms || atoms.rowCount > 99999)
    throw Error("Structure has too many atoms for PDB design input.");
  const field = (key, i, fallback = "") => {
    const value = atoms.getField(key)?.str(i);
    return value === undefined || value === "" || value === "." || value === "?"
      ? fallback
      : value;
  };
  const fixed = (value, width, decimals) => {
    if (!value.trim() || !Number.isFinite(Number(value)))
      throw Error("Invalid structure coordinates.");
    const result = Number(value).toFixed(decimals);
    if (result.length > width)
      throw Error("Structure coordinates exceed PDB limits.");
    return result.padStart(width);
  };
  const lines = [];
  const models = new Set();
  for (let i = 0; i < atoms.rowCount; i++) {
    const group = field("group_PDB", i);
    if (!["ATOM", "HETATM"].includes(group))
      throw Error("Invalid atom record.");
    const chain = field("auth_asym_id", i, field("label_asym_id", i));
    const residue = field("auth_seq_id", i, field("label_seq_id", i));
    const insertion = field("pdbx_PDB_ins_code", i, " "),
      alt = field("label_alt_id", i, " ");
    const atom = field("auth_atom_id", i, field("label_atom_id", i));
    const comp = field("auth_comp_id", i, field("label_comp_id", i));
    const element = field("type_symbol", i);
    models.add(field("pdbx_PDB_model_num", i, "1"));
    if (
      models.size > 1 ||
      !/^[A-Za-z0-9]$/.test(chain) ||
      !/^-?\d+$/.test(residue) ||
      residue.length > 4 ||
      insertion.length !== 1 ||
      alt.length !== 1 ||
      atom.length > 4 ||
      comp.length > 3 ||
      element.length > 2
    )
      throw Error(
        "This structure needs chain or residue remapping before PDB-based design.",
      );
    const atomName =
      atom.length < 4 && element.length === 1
        ? (" " + atom).padEnd(4)
        : atom.padEnd(4);
    lines.push(
      group.padEnd(6) +
        String(i + 1).padStart(5) +
        " " +
        atomName +
        alt +
        comp.padStart(3) +
        " " +
        chain +
        residue.padStart(4) +
        insertion +
        "   " +
        fixed(field("Cartn_x", i), 8, 3) +
        fixed(field("Cartn_y", i), 8, 3) +
        fixed(field("Cartn_z", i), 8, 3) +
        fixed(field("occupancy", i, "1"), 6, 2) +
        fixed(field("B_iso_or_equiv", i, "0"), 6, 2) +
        "          " +
        element.padStart(2) +
        "  ",
    );
  }
  return lines.join("\n") + "\nEND\n";
}
