import { HttpError } from "./errors.js";

// Match only files beneath the authenticated job prefix. Output patterns belong
// to adapters, never to a browser request; paths retain their full relative name.
export function outputFiles(outputs, keys, prefix) {
  const paths = [
    ...new Set(
      keys
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length)),
    ),
  ]
    .filter(
      (path) =>
        path &&
        !path.split("/").some((p) => !p || p === "." || p === "..") &&
        !/[\\\x00-\x1f]/.test(path),
    )
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return outputs.flatMap((output) => {
    const matches = paths.filter((path) =>
      output.path ? path === output.path : output.pattern.test(path),
    );
    if (
      matches.length < (output.min ?? 1) ||
      matches.length > (output.max ?? 1)
    ) {
      throw new HttpError(
        502,
        `Unexpected number of results for ${output.label}`,
      );
    }
    return matches.map((path) => ({ label: output.label, path }));
  });
}
