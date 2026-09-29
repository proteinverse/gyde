import { requestError } from "./requestErrors";

test("shows the actual adapter validation message instead of an empty statusText", async () => {
  expect(
    await requestError({
      status: 422,
      statusText: "",
      json: async () => ({ error: "Choose one PDB chain" }),
    }),
  ).toBe("Compute request failed (HTTP 422): Choose one PDB chain");
});
test("retains parameter validation details", async () => {
  expect(
    await requestError({
      status: 422,
      json: async () => ({
        errors: [{ parameter: "chain", message: "Required" }],
      }),
    }),
  ).toContain("chain: Required");
});
test.each([null, {}, { error: {} }, { errors: [null] }])(
  "handles an unrecognized JSON error body",
  async (data) => {
    expect(
      await requestError({ status: 503, json: async () => data }),
    ).toContain("Compute request failed (HTTP 503)");
  },
);
test("does not show an HTML proxy error page as the message", async () => {
  expect(
    await requestError({
      status: 502,
      json: async () => {
        throw Error("HTML");
      },
    }),
  ).toContain("Compute request failed (HTTP 502)");
});
