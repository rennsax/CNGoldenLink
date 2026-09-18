import { rm, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { minify } from "html-minifier-terser";

const directory = path.dirname(fileURLToPath(import.meta.url));
const overlayRoot = path.resolve(directory, "..");
const sourceRoot = path.join(overlayRoot, "src");
const outputRoot = path.join(overlayRoot, "dist");

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

await Promise.all([
  build({
    entryPoints: [path.join(sourceRoot, "app.mjs")],
    outfile: path.join(outputRoot, "app.mjs"),
    bundle: true,
    format: "esm",
    target: "es2020",
    minify: true,
    legalComments: "none",
  }),
  build({
    entryPoints: [path.join(sourceRoot, "style.css")],
    outfile: path.join(outputRoot, "style.css"),
    bundle: true,
    minify: true,
  }),
]);

const sourceHtml = await readFile(path.join(sourceRoot, "index.html"), "utf8");
const outputHtml = await minify(sourceHtml, {
  collapseWhitespace: true,
  removeComments: true,
  removeRedundantAttributes: true,
  useShortDoctype: true,
});

await writeFile(path.join(outputRoot, "index.html"), outputHtml);
