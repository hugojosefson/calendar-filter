/** @module Typed upstream failures mapped to API statuses. */

/** Failure from upstream validation, fetch, DNS, or resource limits. */
export class UpstreamError extends Error {
  constructor(
    readonly status: 400 | 502 | 504,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}
