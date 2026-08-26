const ipv4DeniedRanges: Array<[number, number]> = [
  [0x00000000, 0x00ffffff],
  [0x0a000000, 0x0affffff],
  [0x64400000, 0x647fffff],
  [0x7f000000, 0x7fffffff],
  [0xa9fe0000, 0xa9feffff],
  [0xac100000, 0xac1fffff],
  [0xc0000000, 0xc00000ff],
  [0xc0000200, 0xc00002ff],
  [0xc0586300, 0xc05863ff],
  [0xc0a80000, 0xc0a8ffff],
  [0xc6120000, 0xc613ffff],
  [0xc6336400, 0xc63364ff],
  [0xcb007100, 0xcb0071ff],
  [0xe0000000, 0xffffffff],
];

const ipv6DeniedPrefixes: Array<[bigint, number]> = [
  [0n, 96], // IPv4-compatible and unspecified addresses
  [0xfcn << 120n, 7],
  [0xfe80n << 112n, 10],
  [0xffn << 120n, 8],
  [0x20010db8n << 96n, 32],
  [0x64ff9b0001n << 80n, 48],
  [0x100n << 112n, 64],
  [0x2001n << 112n, 23],
  [0x2002n << 112n, 16],
  [0x3fff0n << 108n, 20],
  [0x5f00n << 112n, 16],
];

export function isGloballyRoutableAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4 !== undefined) {
    return !ipv4DeniedRanges.some(([start, end]) =>
      ipv4 >= start && ipv4 <= end
    );
  }
  const ipv6 = parseIpv6(address);
  if (ipv6 === undefined) return false;
  const mapped = ipv6 & ((1n << 32n) - 1n);
  if ((ipv6 >> 32n) === 0xffffn) {
    return isGloballyRoutableAddress(formatIpv4(mapped));
  }
  return !ipv6DeniedPrefixes.some(([network, prefixLength]) =>
    hasPrefix(ipv6, network, prefixLength)
  );
}

function hasPrefix(
  address: bigint,
  network: bigint,
  prefixLength: number,
): boolean {
  const shift = BigInt(128 - prefixLength);
  return (address >> shift) === (network >> shift);
}

function parseIpv4(address: string): number | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) return undefined;
  const values = parts.map((part) => Number(part));
  if (
    values.some((value, index) => !/^\d+$/.test(parts[index]) || value > 255)
  ) return undefined;
  return values.reduce((result, value) => result * 256 + value, 0);
}

function parseIpv6(address: string): bigint | undefined {
  let input = address.toLowerCase();
  if (!input.includes(":")) return undefined;
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const dottedTail = input.slice(lastColon + 1);
    const ipv4 = parseIpv4(dottedTail);
    if (
      lastColon === -1 || ipv4 === undefined ||
      input.slice(0, lastColon).includes(".")
    ) {
      return undefined;
    }
    input = `${input.slice(0, lastColon)}:${(ipv4 >>> 16).toString(16)}:${
      (ipv4 & 0xffff).toString(16)
    }`;
  }
  const [left, right, ...extra] = input.split("::");
  if (extra.length > 0) return undefined;
  const leftParts = left === "" ? [] : left.split(":");
  const rightParts = right === undefined || right === ""
    ? []
    : right.split(":");
  const parts = [...leftParts, ...rightParts];
  if (
    parts.length > 8 || (right === undefined && parts.length !== 8) ||
    (right !== undefined && parts.length >= 8)
  ) {
    return undefined;
  }
  if (parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;
  const expanded = [
    ...leftParts,
    ...Array(8 - parts.length).fill("0"),
    ...rightParts,
  ];
  return expanded.reduce(
    (result, part) => (result << 16n) + BigInt(`0x${part}`),
    0n,
  );
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => Number((value >> shift) & 255n))
    .join(".");
}
