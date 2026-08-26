/** @module HTTP API error responses. */

/** Documents API error payloads. */
const docsUrl = "https://github.com/hugojosefson/calendar-filter#api";

/** Expected client-visible API failure with an HTTP status. */
export class ApiError extends Error {
  /** Creates a client-visible error with its response status. */
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

/** Converts an API failure into a CORS-enabled JSON response. */
export function apiErrorResponse(error: ApiError, isHead: boolean): Response {
  const headers = new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "ETag, Content-Disposition",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  if (error.status === 405) {
    headers.set("Allow", "GET, HEAD, OPTIONS");
  }
  const body = isHead
    ? null
    : JSON.stringify({ error: error.message, docs: docsUrl });
  return new Response(body, { status: error.status, headers });
}
