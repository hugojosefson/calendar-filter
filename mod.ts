export function placeholder() {}

// TODO: implement the calendar-filter server.
// See README.md for the specification.
export function createCalendarFilterHandler(): (
  request: Request,
) => Promise<Response> {
  return (_request: Request): Promise<Response> =>
    Promise.resolve(new Response("not implemented", { status: 501 }));
}

export const calendarFilterHandler: (
  request: Request,
) => Promise<Response> = createCalendarFilterHandler();
