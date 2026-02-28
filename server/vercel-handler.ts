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

async function initialize() {
  if (initialized) return;
  try {
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
    console.log("Vercel handler initialized successfully");
  } catch (err) {
    console.error("Failed to initialize:", err);
    throw err;
  }
}

export default async function handler(req: Request, res: Response) {
  try {
    await initialize();
    return new Promise<void>((resolve) => {
      res.on("finish", resolve);
      app(req, res);
    });
  } catch (err: any) {
    console.error("Handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ message: "Server initialization failed: " + (err.message || "unknown error") });
    }
  }
}
