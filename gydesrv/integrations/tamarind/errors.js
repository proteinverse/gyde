export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, `${label} must be an object`);
  return value;
}
export function requireId(value) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new HttpError(404, "Not found");
  return value;
}
