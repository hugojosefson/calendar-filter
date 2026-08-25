import { ApiError, apiErrorResponse } from "./api-error.ts";
import { type CalendarFilterOptions, resolveOptions } from "./options.ts";
import { assertRequestUrlLength, parseRequest } from "./request.ts";

export function createCalendarFilterHandler(
  options?: CalendarFilterOptions,
): (request: Request) => Promise<Response> {
  const resolvedOptions = resolveOptions(options);
  return (request: Request): Promise<Response> => {
    const isHead = request.method === "HEAD";
    try {
      assertRequestUrlLength(request, resolvedOptions.maxRequestUrlBytes);
      const url = new URL(request.url);
      if (url.pathname !== "/webcal") {
        throw new ApiError(404, "Not found");
      }
      if (request.method === "OPTIONS") {
        return Promise.resolve(optionsResponse());
      }
      if (request.method !== "GET" && !isHead) {
        throw new ApiError(405, "Method not allowed");
      }
      parseRequest(request, resolvedOptions);
      throw new ApiError(501, "Calendar fetching is not implemented");
    } catch (error) {
      if (error instanceof ApiError) {
        return Promise.resolve(apiErrorResponse(error, isHead));
      }
      return Promise.resolve(
        apiErrorResponse(new ApiError(500, "Internal server error"), isHead),
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
