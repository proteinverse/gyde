import { csvParse } from "d3-dsv";
const metrics = [
  ["PSH", "Surface hydrophobicity", "graph_psh"],
  ["PPC", "Positive charge", "graph_ppc"],
  ["PNC", "Negative charge", "graph_pnc"],
  ["CDR Length", "Total CDR length", "graph_cdrlen"],
  ["SFvCSP", "Heavy/light charge symmetry", "graph_sfvcsp"],
];
export function parseTamarindTap(text) {
  const rows = csvParse(text);
  if (rows.length !== 1)
    throw Error("Expected one antibody in Tamarind TAP results");
  const row = rows[0],
    result = {};
  for (const [column, name, graph] of metrics) {
    if (
      row[column] === undefined ||
      row[column].trim() === "" ||
      !Number.isFinite(Number(row[column]))
    )
      throw Error(`Tamarind TAP returned an invalid ${name} score`);
    const value = Number(row[column]);
    const flag =
      row[(column === "CDR Length" ? "CDR_Length" : column) + "_traffic_light"];
    result["TAP2_" + column.replaceAll(" ", "_")] = value;
    result[graph] = { tamarindMetric: { name, value, flag } };
  }
  return result;
}
