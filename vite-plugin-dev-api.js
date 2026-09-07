/* Runs the api/ Vercel functions inside the Vite dev server.
 *
 * `vite dev` does not know about Vercel functions, and `vercel dev` would replace
 * the existing dev workflow. This mounts the same handler modules as connect
 * middleware so `npm run dev` behaves like production without a second toolchain.
 *
 * Dev only — vercel.json / the platform serves api/ in production.
 */

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { config as loadEnv } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));

export default function devApiPlugin() {
  return {
    name: "smarthomes-dev-api",
    apply: "serve",

    configureServer(server) {
      // Vite only exposes VITE_-prefixed vars to the app; the handlers read
      // process.env directly, so load the file ourselves.
      for (const file of [".env.local", ".env"]) {
        const path = resolve(here, file);
        if (existsSync(path)) loadEnv({ path, override: false });
      }

      /* Endpoint modules are re-imported per request, but their static imports of
         api/_lib/* stay in Node's ESM registry for the life of the process — that
         cache cannot be invalidated from here. Rather than let a shared-library
         edit silently do nothing, say so loudly. */
      const libDir = resolve(here, "api", "_lib");
      server.watcher.add(libDir);
      server.watcher.on("change", (file) => {
        if (file.startsWith(libDir)) {
          server.config.logger.warn(
            "\n[dev-api] api/_lib changed — restart the dev server to load it " +
              "(shared modules are cached by Node for the process lifetime).\n"
          );
        }
      });

      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();

        // Reject traversal before it reaches the filesystem, and keep _-prefixed
        // paths unroutable — api/_lib holds shared modules, not endpoints. Vercel
        // skips those by convention; the dev server has to be told.
        const route = url.pathname.slice("/api/".length);
        const segments = route.split("/");
        const unsafe =
          !/^[a-z0-9/_-]+$/i.test(route) ||
          segments.some((s) => !s || s === "." || s === ".." || s.startsWith("_"));

        if (unsafe) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ error: "not_found" }));
        }

        const modulePath = resolve(here, "api", `${route}.js`);
        if (!existsSync(modulePath)) {
          res.statusCode = 404;
          res.setHeader("Content-Type", "application/json");
          return res.end(JSON.stringify({ error: "not_found" }));
        }

        try {
          // Cache-bust so handler edits take effect without restarting the server.
          const mod = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
          await mod.default(req, res);
        } catch (err) {
          server.config.logger.error(`[dev-api] ${route}: ${err.stack || err.message}`);
          if (!res.writableEnded) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ error: "internal_error", message: err.message }));
          }
        }
      });
    },
  };
}
