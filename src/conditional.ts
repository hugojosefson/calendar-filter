export async function etagFor(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(body));
  const hexadecimal = [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `"${hexadecimal}"`;
}

export function ifNoneMatchMatches(
  header: string | null,
  currentEtag: string,
): boolean {
  if (header === null) {
    return false;
  }
  return parseEtags(header).some((etag) =>
    etag === "*" || etag === currentEtag
  );
}

function parseEtags(header: string): string[] {
  const etags: string[] = [];
  let offset = 0;
  while (offset < header.length) {
    offset = skipWhitespace(header, offset);
    if (header[offset] === "*") {
      etags.push("*");
      offset++;
    } else {
      if (header.slice(offset, offset + 2) === "W/") {
        offset += 2;
      }
      if (header[offset] !== '"') {
        return [];
      }
      const end = header.indexOf('"', offset + 1);
      if (end === -1) {
        return [];
      }
      etags.push(header.slice(offset, end + 1));
      offset = end + 1;
    }
    offset = skipWhitespace(header, offset);
    if (offset === header.length) {
      return etags;
    }
    if (header[offset] !== ",") {
      return [];
    }
    offset++;
  }
  return [];
}

function skipWhitespace(value: string, offset: number): number {
  while (value[offset] === " " || value[offset] === "\t") {
    offset++;
  }
  return offset;
}
