/** @module Upstream URL and address security policy. */

import { isGloballyRoutableAddress } from "./ip-policy.ts";
import { UpstreamError } from "./error.ts";

/** Resolves every address an upstream hostname may reach. */
export type ResolveAddresses = (hostname: string) => Promise<string[]>;

/** Enforces protocol, credential, DNS, and public-address SSRF boundaries. */
export async function assertUpstreamUrl(
  url: URL,
  resolver: ResolveAddresses,
  allowPrivateUpstreams: boolean,
  initial: boolean,
): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw failure(initial, "Upstream URL must use HTTP or HTTPS");
  }
  if (url.username !== "" || url.password !== "") {
    throw failure(initial, "Upstream URL must not contain credentials");
  }
  if (allowPrivateUpstreams) {
    return;
  }
  const literal = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (isIpLiteral(literal)) {
    if (!isGloballyRoutableAddress(literal)) {
      throw failure(initial, "Upstream address is not globally routable");
    }
    return;
  }
  let addresses: string[];
  try {
    addresses = await resolver(url.hostname);
  } catch {
    throw new UpstreamError(502, "Upstream DNS lookup failed");
  }
  if (addresses.length === 0) {
    throw new UpstreamError(502, "Upstream DNS returned no addresses");
  }
  if (addresses.some((address) => !isGloballyRoutableAddress(address))) {
    throw failure(initial, "Upstream address is not globally routable");
  }
}

/** Recognizes the IPv4 and IPv6 literal forms accepted by URL hostnames. */
function isIpLiteral(value: string): boolean {
  return value.includes(":") || /^\d+(?:\.\d+){3}$/.test(value);
}

/** Uses a client error for original input and a gateway error after redirects. */
/** Chooses client or gateway status based on redirect depth. */
function failure(initial: boolean, message: string): UpstreamError {
  return new UpstreamError(initial ? 400 : 502, message);
}
