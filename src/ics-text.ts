export function unescapeIcsText(value: string): string {
  return value.replace(/\\(.)/gs, (match, character: string) => {
    if (character === "n" || character === "N") {
      return "\n";
    }
    if (character === "\\" || character === "," || character === ";") {
      return character;
    }
    return match;
  });
}
