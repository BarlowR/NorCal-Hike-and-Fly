// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Vite does not inject .env.local into process.env (only into import.meta.env),
// so we read it manually here before any plugin code runs.
// We read from the project root .env.local so tracklog_handler and site share one file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvLocal = path.join(__dirname, "..", ".env.local");
try {
  const localEnv = fs.readFileSync(rootEnvLocal, "utf8");
  for (const line of localEnv.split("\n")) {
    const m = line.match(/^([^#=\s][^=]*)=(.*)/);
    if (m) process.env[m[1].trim()] ??= m[2].trim();
  }
} catch { /* .env.local doesn't exist — that's fine */ }

/**
 * Vite plugin that serves files from LOCAL_DATA_DIR during dev.
 * Set LOCAL_DATA_DIR in site/.env.local to enable local data serving.
 */
function localDataPlugin() {
  const localDataDir = process.env.LOCAL_DATA_DIR;
  if (!localDataDir) return null;

  console.log(`[local-data] Serving data from ${localDataDir}`);
  return {
    name: "local-data-server",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        const filePath = path.join(localDataDir, url);
        try {
          if (fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType =
              ext === ".json" ? "application/json" :
              ext === ".igc"  ? "text/plain" :
              ext === ".gpx"  ? "application/gpx+xml" :
              "application/octet-stream";
            res.setHeader("Content-Type", contentType);
            res.end(fs.readFileSync(filePath));
            return;
          }
        } catch { /* file not found — fall through */ }
        next();
      });
    },
  };
}

const PRODUCTION_R2_URL = "https://pub-2abaa3842a424242839ca552587a7957.r2.dev";

// When LOCAL_DATA_DIR is set, serve data locally via relative paths.
// The user only needs to set LOCAL_DATA_DIR — PUBLIC_R2_URL is derived automatically.
const r2PublicUrl = process.env.LOCAL_DATA_DIR ? "" : PRODUCTION_R2_URL;

// https://astro.build/config
export default defineConfig({
  vite: {
    plugins: [tailwindcss(), localDataPlugin()],
    define: {
      global: 'globalThis',
      'import.meta.env.PUBLIC_R2_URL': JSON.stringify(r2PublicUrl),
    },
    resolve: {
      preserveSymlinks: true,
    },
  },
  site: 'https://norcalhf.com',
  integrations: [sitemap()],
});
