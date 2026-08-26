/** @module Generates committed, self-hosted browser assets for the builder. */

const output = new URL("../src/builder/generated-assets.ts", import.meta.url);
const entry = new URL("../src/builder/browser.ts", import.meta.url);

/** Bundles browser code and copies Pico's distributable stylesheet locally. */
async function generate(): Promise<void> {
  const pico = await Deno.readTextFile(await picoPath());
  const command = new Deno.Command(Deno.execPath(), {
    args: ["bundle", "--platform=browser", "--minify", entry.pathname],
    stdout: "piped",
  });
  const bundled = await command.output();
  if (!bundled.success) {
    throw new Error(new TextDecoder().decode(bundled.stderr));
  }
  const javascript = new TextDecoder().decode(bundled.stdout);
  await Deno.writeTextFile(
    output,
    `/** @module Generated self-hosted browser assets. DO NOT EDIT: deno task assets. */
/* Pico CSS 2.1.1: https://github.com/picocss/pico/blob/master/LICENSE.md */
export const picoCss =
  ${JSON.stringify(pico)};
/* Bundled CodeMirror 6, RE2JS, and builder code retain their upstream licenses. */
export const builderJs =
  ${JSON.stringify(javascript)};
`,
  );
  const formatted = await new Deno.Command(Deno.execPath(), {
    args: ["fmt", output.pathname],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!formatted.success) {
    throw new Error(new TextDecoder().decode(formatted.stderr));
  }
}

/** Resolves Pico's npm-cache package directory without placing an asset in node_modules. */
async function picoPath(): Promise<string> {
  const info = await new Deno.Command(Deno.execPath(), {
    args: ["info", "--json", import.meta.resolve("npm:@picocss/pico@2.1.1")],
    stdout: "piped",
  }).output();
  const metadata = JSON.parse(new TextDecoder().decode(info.stdout)) as {
    npmPackages: Record<string, { localPath: string }>;
  };
  return `${
    metadata.npmPackages["@picocss/pico@2.1.1"].localPath
  }/css/pico.min.css`;
}

await generate();
