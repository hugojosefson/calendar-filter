import { RE2JS } from "re2js";

type ProgramInstruction = {
  op: number;
  out: number;
  arg: number;
  runes: readonly number[];
};
type Program = { inst: readonly ProgramInstruction[]; start: number };

export function isTextFlags(flags: string): boolean {
  return flags === "" || flags === "i";
}

export function canonicalText(
  source: string,
  flags: string,
): string | undefined {
  if (!isTextFlags(flags)) {
    return undefined;
  }
  try {
    const text = singletonProgram(RE2JS.compile(source, re2Flags(flags)));
    return text !== undefined && RE2JS.quote(text) === source
      ? text
      : undefined;
  } catch {
    return undefined;
  }
}

export function singletonText(
  source: string,
  flags: string,
): string | undefined {
  if (!isTextFlags(flags)) {
    return undefined;
  }
  try {
    return singletonProgram(RE2JS.compile(source, re2Flags(flags)));
  } catch {
    return undefined;
  }
}

export function canCompile(source: string, flags: string): boolean {
  try {
    RE2JS.compile(source, re2Flags(flags));
    return true;
  } catch {
    return false;
  }
}

function re2Flags(flags: string): number {
  let result = 0;
  for (const flag of flags) {
    if (flag === "i") {
      result |= RE2JS.CASE_INSENSITIVE;
    }
    if (flag === "m") {
      result |= RE2JS.MULTILINE;
    }
    if (flag === "s") {
      result |= RE2JS.DOTALL;
    }
  }
  return result;
}

// RE2JS 2.8.6 exposes the VM only through an untyped re2() object. Keeping
// this dependency here prevents its version-specific representation leaking
// into query and UI state code.
function singletonProgram(regex: RE2JS): string | undefined {
  const program = regex.re2().prog as Program;
  const visiting = new Set<number>();
  const memo = new Map<number, string | undefined>();
  const visit = (pc: number): string | undefined => {
    if (visiting.has(pc)) {
      return undefined;
    }
    if (memo.has(pc)) {
      return memo.get(pc);
    }
    const instruction = program.inst[pc];
    if (instruction === undefined) {
      return undefined;
    }
    visiting.add(pc);
    let result: string | undefined;
    switch (instruction.op) {
      case 6:
        result = "";
        break;
      case 3:
      case 7:
        result = visit(instruction.out);
        break;
      case 1:
      case 2: {
        const left = visit(instruction.out);
        const right = visit(instruction.arg);
        result = left !== undefined && left === right ? left : undefined;
        break;
      }
      case 9:
        result = appendRune(instruction.runes, visit(instruction.out));
        break;
      case 8:
        result = instruction.arg === 0 && instruction.runes.length === 2 &&
            instruction.runes[0] === instruction.runes[1]
          ? appendRune(instruction.runes, visit(instruction.out))
          : undefined;
        break;
      default:
        result = undefined;
    }
    visiting.delete(pc);
    memo.set(pc, result);
    return result;
  };
  return visit(program.start);
}

function appendRune(
  runes: readonly number[],
  suffix: string | undefined,
): string | undefined {
  if (runes.length === 0 || suffix === undefined) {
    return undefined;
  }
  return String.fromCodePoint(runes[0]) + suffix;
}
