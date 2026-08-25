const docsUrl = "https://github.com/hugojosefson/calendar-filter#api";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

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
