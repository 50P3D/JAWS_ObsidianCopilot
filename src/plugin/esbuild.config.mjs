import esbuild from "esbuild";
import { copyFileSync, mkdirSync } from "fs";

const outdir = "dist/plugin";
mkdirSync(outdir, { recursive: true });

await esbuild.build({
  entryPoints: ["src/plugin/main.ts"],
  bundle: true,
  external: ["obsidian"],
  outfile: `${outdir}/main.js`,
  format: "cjs",
  target: "es2022",
  sourcemap: "inline",
  logLevel: "info",
});

copyFileSync("src/plugin/manifest.json", `${outdir}/manifest.json`);
copyFileSync("src/plugin/styles.css", `${outdir}/styles.css`);
console.log(`[NoteCheck build] Successfully compiled plugin and copied manifest.json + styles.css to ${outdir}`);

