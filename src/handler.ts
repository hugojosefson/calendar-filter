import { ApiError, apiErrorResponse } from "./api-error.ts";
import { etagFor, ifNoneMatchMatches } from "./conditional.ts";
import { IcsError } from "./ics-error.ts";
import { filterCalendar } from "./ics-filter.ts";
import { type CalendarFilterOptions, resolveOptions } from "./options.ts";
import { assertRequestUrlLength, parseRequest } from "./request.ts";
import { UpstreamError } from "./upstream-error.ts";
import { createUpstreamLoader } from "./upstream-loader.ts";

export function createCalendarFilterHandler(
  options?: CalendarFilterOptions,
): (request: Request) => Promise<Response> {
  const resolvedOptions = resolveOptions(options);
  const loadUpstream = createUpstreamLoader(resolvedOptions);
  return async (request: Request): Promise<Response> => {
    const isHead = request.method === "HEAD";
    try {
      assertRequestUrlLength(request, resolvedOptions.maxRequestUrlBytes);
      const url = new URL(request.url);
      if (url.pathname !== "/webcal") {
        throw new ApiError(404, "Not found");
      }
      if (request.method === "OPTIONS") {
        return optionsResponse();
      }
      if (request.method !== "GET" && !isHead) {
        throw new ApiError(405, "Method not allowed");
      }
      const parsed = parseRequest(request, resolvedOptions);
      const upstream = await loadUpstream(parsed.inputUrl);
      const body = filterCalendar(
        upstream.body,
        parsed.rules,
        parsed.calendarName,
      );
      const etag = await etagFor(body);
      if (ifNoneMatchMatches(request.headers.get("If-None-Match"), etag)) {
        return notModifiedResponse(etag);
      }
      return calendarResponse(body, etag, isHead);
    } catch (error) {
      if (error instanceof ApiError) {
        return apiErrorResponse(error, isHead);
      }
      if (error instanceof UpstreamError) {
        return apiErrorResponse(
          new ApiError(error.status, error.message),
          isHead,
        );
      }
      if (error instanceof IcsError) {
        return apiErrorResponse(new ApiError(502, error.message), isHead);
      }
      return apiErrorResponse(
        new ApiError(500, "Internal server error"),
        isHead,
      );
    }
  };
}

export const calendarFilterHandler: (request: Request) => Promise<Response> =
  createCalendarFilterHandler();

function optionsResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Headers": "If-None-Match",
      "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "ETag, Content-Disposition",
    },
  });
}

function calendarResponse(
  body: Uint8Array,
  etag: string,
  isHead: boolean,
): Response {
  return new Response(isHead ? null : Uint8Array.from(body), {
    headers: representationHeaders(etag),
  });
}

function notModifiedResponse(etag: string): Response {
  return new Response(null, {
    status: 304,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "ETag, Content-Disposition",
      "Cache-Control": "no-cache",
      ETag: etag,
    },
  });
}

function representationHeaders(etag: string): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "ETag, Content-Disposition",
    "Cache-Control": "no-cache",
    "Content-Disposition": 'inline; filename="calendar.ics"',
    "Content-Type": "text/calendar; charset=utf-8",
    ETag: etag,
  });
}
