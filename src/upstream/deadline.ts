/** @module Deadline cancellation for upstream operations. */

/** Indicates an upstream operation exceeded its shared wall-clock deadline. */
export class DeadlineExceeded extends Error {}

/** Aborts all work after one timeout and races individual async operations. */
export class Deadline {
  readonly #controller = new AbortController();
  readonly #expired: Promise<never>;
  #timeout: ReturnType<typeof setTimeout> | undefined;

  /** Starts a timeout shared by all operations in one upstream load. */
  constructor(timeoutMs: number) {
    this.#expired = new Promise<never>((_, reject) => {
      this.#timeout = setTimeout(() => {
        reject(new DeadlineExceeded());
        this.#controller.abort();
      }, timeoutMs);
    });
  }

  /** Signal passed to fetch so timeout stops network I/O too. */
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  /** Rejects with DeadlineExceeded if this operation outlives the deadline. */
  race<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([promise, this.#expired]);
  }

  /** Clears the timer after the complete upstream operation settles. */
  close(): void {
    if (this.#timeout !== undefined) {
      clearTimeout(this.#timeout);
    }
  }
}
