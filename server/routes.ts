import type { Express } from "express";
import { Router } from "express";
import type { Server } from "http";
import { setupSession, registerAuthRoutes } from "./auth";
import { registerEmployeeRoutes } from "./routes/employees";
import { registerShiftRoutes } from "./routes/shifts";
import { registerTimeTrackingRoutes } from "./routes/time-tracking";
import { registerManagementRoutes } from "./routes/management";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  setupSession(app);

  const router = Router();

  router.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.removeHeader("ETag");
    next();
  });

  app.set("etag", false);

  registerAuthRoutes(router);
  registerEmployeeRoutes(router);
  registerShiftRoutes(router);
  registerTimeTrackingRoutes(router);
  registerManagementRoutes(router);

  app.use(router);

  return httpServer;
}
