export class DeadlineExceeded extends Error {}

export class Deadline {
  readonly #controller = new AbortController();
  readonly #expired: Promise<never>;
  #timeout: ReturnType<typeof setTimeout> | undefined;

  constructor(timeoutMs: number) {
    this.#expired = new Promise<never>((_, reject) => {
      this.#timeout = setTimeout(() => {
        reject(new DeadlineExceeded());
        this.#controller.abort();
      }, timeoutMs);
    });
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  race<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([promise, this.#expired]);
  }

  close(): void {
    if (this.#timeout !== undefined) clearTimeout(this.#timeout);
  }
}
