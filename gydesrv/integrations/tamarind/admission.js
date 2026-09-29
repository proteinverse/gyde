import { HttpError } from "./errors.js";

// Reject overload before reading/decompressing upload bodies. A bounded database
// pool alone would still allow unlimited parsed upload bodies to wait in memory.
export function admission(limit) {
  let active = 0;
  return (_req, res, next) => {
    if (active >= limit) {
      res.set("Retry-After", "5");
      return next(
        new HttpError(
          429,
          "The compute adapter is busy. Please retry in a few seconds.",
        ),
      );
    }
    active++;
    let released = false;
    const release = () => {
      if (!released && !res.locals.computeWorkPending) {
        released = true;
        active--;
      }
    };
    (res.locals.computeReleases ||= []).push(release);
    res.once("finish", release);
    res.once("close", release);
    next();
  };
}

// A disconnected caller must not free slots while its paid submission or download
// is still executing. Keep all admission slots until the asynchronous work settles.
export function admittedHandler(fn) {
  return async (req, res, next) => {
    res.locals.computeWorkPending = true;
    try { await fn(req, res); }
    catch (error) { next(error); }
    finally {
      res.locals.computeWorkPending = false;
      for (const release of res.locals.computeReleases || []) release();
    }
  };
}
