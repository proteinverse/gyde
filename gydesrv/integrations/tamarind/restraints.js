import { HttpError } from "./errors.js";

export function translateRestraints(raw, molecules, tool) {
  if (raw === undefined) return {};
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch {
    throw new HttpError(422, "Invalid restraints");
  }
  if (!Array.isArray(rows) || rows.length > 1000)
    throw new HttpError(422, "Provide at most 1,000 restraints");
  const endpoint = (e) => {
    const molecule = molecules.find((m) => m.chain === e?.chain);
    if (
      !molecule ||
      Object.keys(e).some((k) => !["chain", "position"].includes(k))
    )
      throw new HttpError(422, "Invalid restraint chain");
    if (molecule.type === "ligand") {
      if (e.position !== null)
        throw new HttpError(422, "Ligand restraints must use a pocket");
    } else if (
      !Number.isInteger(e.position) ||
      e.position < 1 ||
      e.position > molecule.sequence.length
    )
      throw new HttpError(422, "Invalid restraint residue");
    return e;
  };
  const restraints = [],
    contactRestraints = [],
    pocketRestraints = [];
  rows.forEach((r, i) => {
    if (
      !r ||
      Object.keys(r).some((k) => !["from", "to", "min", "max"].includes(k)) ||
      !Number.isFinite(r.min) ||
      !Number.isFinite(r.max) ||
      r.min < 0 ||
      r.max <= r.min
    )
      throw new HttpError(422, "Invalid restraint distance");
    let a = endpoint(r.from),
      b = endpoint(r.to);
    if (a.position === null && b.position === null)
      throw new HttpError(422, "A restraint requires a polymer residue");
    if (b.position === null) [a, b] = [b, a];
    const pocket = a.position === null;
    if (tool === "chai")
      restraints.push({
        restraint_id: `gyde_${i}`,
        chainA: a.chain,
        res_idxA: pocket ? "" : String(a.position),
        chainB: b.chain,
        res_idxB: String(b.position),
        connection_type: pocket ? "pocket" : "contact",
        confidence: 1,
        min_distance_angstrom: r.min,
        max_distance_angstrom: r.max,
      });
    else if (pocket)
      pocketRestraints.push({
        binderChain: a.chain,
        pocketChain: b.chain,
        pocketContacts: [b.position],
        max_distance_angstrom: r.max,
      });
    else
      contactRestraints.push({
        chainA: a.chain,
        res_idxA: a.position,
        chainB: b.chain,
        res_idxB: b.position,
        max_distance_angstrom: r.max,
      });
  });
  return tool === "chai"
    ? { restraints }
    : { contactRestraints, pocketRestraints };
}
