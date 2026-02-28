import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, mkdir } from "fs/promises";

async function buildAll() {
  await rm("dist", { recursive: true, force: true });
  await mkdir("api", { recursive: true });

  console.log("Building frontend with Vite...");
  await viteBuild();

  console.log("Building API serverless function...");
  await esbuild({
    entryPoints: ["server/vercel-handler.ts"],
    platform: "node",
    bundle: true,
    format: "esm",
    outfile: "api/index.mjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: [],
    alias: {
      "@shared": "./shared",
    },
    logLevel: "info",
    target: "node18",
    banner: {
      js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
    },
  });

  console.log("Build complete!");
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
