import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { createServer } from "http";
import { seedDatabase } from "./seed";

const app = express();

app.set("trust proxy", 1);

app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

let initialized = false;
let initPromise: Promise<void> | null = null;

async function initialize() {
  if (initialized) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await seedDatabase();
    const httpServer = createServer(app);
    await registerRoutes(httpServer, app);
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      console.error("Internal Server Error:", err);
      if (!res.headersSent) {
        res.status(status).json({ message });
      }
    });
    initialized = true;
  })();
  return initPromise;
}

export default async function handler(req: Request, res: Response) {
  await initialize();
  app(req, res);
}
