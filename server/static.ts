import express, { type Express } from "express";
import fs from "fs";
import path from "path";

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  app.use(
    express.static(distPath, {
      setHeaders: (res, filePath) => {
        // Hashed Vite bundles in /assets/ are content-addressed — safe to cache
        // forever. Their filenames change whenever the contents change.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          return;
        }
        // Service worker must always be revalidated so new versions roll out.
        if (filePath.endsWith("sw.js")) {
          res.setHeader("Cache-Control", "no-cache");
          return;
        }
        // index.html and other unhashed shell files must revalidate too,
        // otherwise users get stuck on a stale shell after a deploy.
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
          return;
        }
      },
    }),
  );

  // fall through to index.html if the file doesn't exist
  app.use("/{*path}", (_req, res) => {
    res.set("Cache-Control", "no-cache");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
