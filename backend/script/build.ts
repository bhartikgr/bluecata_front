import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, cp, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  // v25.45 ROUND 2 (BLOCKER 7) — keep server/public in lock-step with the
  // freshly built dist/public. Production serves from dist/public (see
  // server/static.ts BUNDLE_DIR → dist/public), so dist is canonical, but a
  // stale server/public/ left over from an older build referenced asset hashes
  // that no longer existed (e.g. index-DmULJAIq.js). Any deploy path that ever
  // serves server/public would then ship a broken page. We mirror dist/public
  // → server/public on every build so the two can never drift again.
  console.log("syncing server/public from dist/public...");
  await rm("server/public", { recursive: true, force: true });
  if (existsSync("dist/public")) {
    await mkdir("server/public", { recursive: true });
    await cp("dist/public", "server/public", { recursive: true });
  }

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
      // v25.43: shim import.meta.url for CJS output (used by createRequire in store/db modules)
      "import.meta.url": "__importMetaUrl",
    },
    banner: {
      js: "const __importMetaUrl = require('url').pathToFileURL(__filename).href;",
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
