// Builds the four published bundles:
//
//   fn.js / fn.cjs        – side-effect-free polyfill (`dialog-closedby-polyfill/fn`)
//   index.js / index.cjs  – auto-applying entry (`dialog-closedby-polyfill`)
//
// The index bundles keep `./fn.js` external (rewritten to `./fn.cjs` for
// CommonJS), so both entry points share a single copy of the polyfill state.
//
// The hand-written `fn.d.ts` / `index.d.ts` are also copied to `.d.cts`
// so that `require` consumers get declarations of the matching format.

import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";

const GENERATED_NOTE = "// Generated from the matching .d.ts by scripts/build.mjs – do not edit.\n";

await writeFile(
  "fn.d.cts",
  GENERATED_NOTE + (await readFile("fn.d.ts", "utf8"))
);
await writeFile(
  "index.d.cts",
  GENERATED_NOTE +
    (await readFile("index.d.ts", "utf8")).replace('"./fn.js"', '"./fn.cjs"')
);

/** Marks the import of `./fn.js` as external and points it at the right format. */
function externalFn(format) {
  return {
    name: "external-fn",
    setup(b) {
      b.onResolve({ filter: /^\.\/fn\.js$/ }, (args) => {
        if (args.importer.endsWith("index.ts")) {
          return { path: format === "cjs" ? "./fn.cjs" : "./fn.js", external: true };
        }
        return undefined;
      });
    },
  };
}

const formats = [
  { format: "esm", ext: "js" },
  { format: "cjs", ext: "cjs" },
];

await Promise.all(
  formats.flatMap(({ format, ext }) => [
    build({
      entryPoints: ["src/fn.ts"],
      bundle: true,
      format,
      outfile: `fn.${ext}`,
    }),
    build({
      entryPoints: ["src/index.ts"],
      bundle: true,
      format,
      outfile: `index.${ext}`,
      plugins: [externalFn(format)],
    }),
  ])
);
