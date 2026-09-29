import busboy from "busboy";
import { HttpError } from "./errors.js";

export function multipart(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = busboy({
        headers: req.headers,
        limits: {
          fileSize: maxBytes,
          fieldSize: maxBytes,
          files: 8,
          fields: 64,
          parts: 72,
        },
      });
    } catch {
      reject(new HttpError(400, "Expected a multipart form"));
      return;
    }
    const fields = Object.create(null),
      files = Object.create(null);
    let error,
      total = 0;
    const fail = (message) => {
      error ||= new HttpError(413, message);
    };
    const seen = new Set();
    function name(key) {
      if (seen.has(key))
        error ||= new HttpError(422, `Repeated parameter: ${key}`);
      seen.add(key);
    }
    parser.on("field", (key, value, info) => {
      name(key);
      total += Buffer.byteLength(value);
      if (info.valueTruncated || info.nameTruncated || total > maxBytes)
        fail("Input exceeds the upload limit");
      if (!error) fields[key] = value;
    });
    parser.on("file", (key, stream, info) => {
      name(key);
      const chunks = [];
      stream.on("limit", () => fail("Input exceeds the upload limit"));
      stream.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) fail("Input exceeds the upload limit");
        if (!error) chunks.push(chunk);
      });
      stream.on("error", (e) => {
        error ||= e;
      });
      stream.on("end", () => {
        if (!error)
          files[key] = {
            bytes: Buffer.concat(chunks),
            filename: info.filename,
            mimeType: info.mimeType,
          };
      });
    });
    for (const event of ["filesLimit", "fieldsLimit", "partsLimit"])
      parser.on(event, () => fail("Too many form fields"));
    parser.on("error", () =>
      reject(new HttpError(400, "Invalid multipart form")),
    );
    req.on("aborted", () => {
      parser.destroy();
      reject(new HttpError(400, "Upload interrupted"));
    });
    parser.on("close", () =>
      error ? reject(error) : resolve({ fields, files }),
    );
    req.pipe(parser);
  });
}
