import { designPdb } from "./designPdb";
const cif = `data_test
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.pdbx_PDB_model_num
ATOM 1 C CA . ALA A 10 A 1.0 2.0 3.0 1 50 1
HETATM 2 C C1 . LIG B 2 ? 4.0 5.0 6.0 1 0 1
#
`;
test("converts mmCIF without losing ligand atoms or author residue IDs", async () => {
  const pdb = await designPdb(cif, "mmcif");
  const lines = pdb.split("\n");
  expect(lines[0].slice(21, 27)).toBe("A  10A");
  expect(lines[1].slice(0, 6)).toBe("HETATM");
  expect(lines[1].slice(30, 38)).toBe("   4.000");
});
test("refuses a lossy chain truncation and multiple models", async () => {
  await expect(
    designPdb(cif.replace("ALA A 10", "ALA AB 10"), "mmcif"),
  ).rejects.toThrow("remapping");
  await expect(
    designPdb(cif.replace("6.0 1 0 1", "6.0 1 0 2"), "mmcif"),
  ).rejects.toThrow("remapping");
});
