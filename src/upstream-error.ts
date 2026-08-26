export class UpstreamError extends Error {
  constructor(
    readonly status: 400 | 502 | 504,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}
