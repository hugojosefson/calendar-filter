#!/usr/bin/env -S deno run --allow-read=.
import { dirname, relative, resolve } from "@std/path";

/**
 * Generates the root README from the source path in the first argument.
 *
 * The generator expands these directives:
 * - A line containing `@@include(filename)` is replaced with the referenced
 *   file, resolved relative to the current input file.
 * - A shebang at the start of an input file is omitted.
 * - Space-free relative destinations in inline Markdown links are rewritten
 *   relative to the repository root.
 * - Relative TypeScript imports become package imports from the repository root.
 *
 * The generated Markdown is written to stdout.
 */
async function main() {
  const inputFilePath = await Deno.realPath(
    (new URL(Deno.args[0], `file://${Deno.cwd()}/`)).pathname,
  );
  const inputText = await Deno.readTextFile(inputFilePath);
  const outputText = await processText(
    inputText,
    inputFilePath,
    new Set([inputFilePath]),
  );
  console.log(outputText);
}

async function processText(
  inputText: string,
  inputFilePath: string,
  includeStack: ReadonlySet<string>,
): Promise<string> {
  const lines = inputText.split("\n");
  // Included scripts must not add a shebang to the README.
  if (lines[0]?.startsWith("#!")) {
    lines.shift();
  }
  const forInclude = processLineForInclude(inputFilePath, includeStack);
  const forLink = processLineForMarkdownLink(inputFilePath);
  const forImport = processLineForImport(inputFilePath);
  return (await Promise.all(lines.map(
    async function (line: string) {
      const included = await forInclude(line);
      if (included !== undefined) {
        return included;
      }
      return forImport(forLink(line));
    },
  ))).join("\n");
}

function processLineForInclude(
  inputFilePath: string,
  includeStack: ReadonlySet<string>,
): (line: string) => Promise<string | undefined> {
  return async (line: string): Promise<string | undefined> => {
    const match = line.match(/@@include\((.*)\)/);
    if (match) {
      const matchedPath = match[1];
      const includeFilePath = resolve(dirname(inputFilePath), matchedPath);
      const resolvedIncludeFilePath = await Deno.realPath(includeFilePath);
      if (includeStack.has(resolvedIncludeFilePath)) {
        throw new Error(`Circular README include: ${resolvedIncludeFilePath}`);
      }
      const nextIncludeStack = new Set(includeStack);
      nextIncludeStack.add(resolvedIncludeFilePath);
      return await processText(
        await Deno.readTextFile(resolvedIncludeFilePath),
        resolvedIncludeFilePath,
        nextIncludeStack,
      );
    }
    return undefined;
  };
}

function processLineForImport(
  inputFilePath: string,
): (line: string) => string {
  return (line: string): string => {
    const match = line.match(/\sfrom\s+"(\..*)"/);
    if (match) {
      const importPath = match[1];
      const step1: string =
        (new URL(importPath, `file://${inputFilePath}`)).pathname;
      const gitRoot = (new URL("../", import.meta.url)).pathname;
      const step2: string = relative(gitRoot, step1);
      if (step2 === "mod.ts") {
        return line.replace(
          /\sfrom\s+"(\..*)"/,
          ` from "@hugojosefson/calendar-filter"`,
        );
      }
      return line.replace(
        /\sfrom\s+"(\..*)"/,
        ` from "@hugojosefson/calendar-filter/${step2}"`,
      );
    }
    return line;
  };
}

function processLineForMarkdownLink(
  inputFilePath: string,
): (line: string) => string {
  return (line: string): string =>
    line.replaceAll(
      /(\]\()([^\s)]+)((?:\s+"[^"]*")?\))/g,
      (match: string, start: string, target: string, end: string): string => {
        if (
          target.startsWith("#") || target.startsWith("/") ||
          /^[a-z][a-z0-9+.-]*:/i.test(target)
        ) {
          return match;
        }

        const resolved = new URL(target, `file://${inputFilePath}`);
        const gitRoot = (new URL("../", import.meta.url)).pathname;
        const rewritten = relative(gitRoot, resolved.pathname).replaceAll(
          "\\",
          "/",
        );
        return `${start}${rewritten}${resolved.search}${resolved.hash}${end}`;
      },
    );
}

if (import.meta.main) {
  await main();
}
