export async function requestError(
  response,
  context = "Compute request failed",
) {
  const fallback = `${context} (HTTP ${response.status}). Please try again.`;
  let data;
  try {
    data = await response.json();
  } catch {
    return fallback;
  }
  const details =
    typeof data?.error === "string"
      ? data.error
      : Array.isArray(data?.errors)
        ? data.errors
            .map((error) => {
              if (typeof error?.message !== "string") return "";
              return error.parameter
                ? `${error.parameter}: ${error.message}`
                : error.message;
            })
            .filter(Boolean)
            .join("; ")
        : "";
  return details
    ? `${context} (HTTP ${response.status}): ${details}`
    : fallback;
}
