import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import cookieParser from "cookie-parser";
import { setupCron } from "./server/cron/renew.js";
import apiRouter from './server/routes/api.js';

import { logger } from "./server/utils/logger.js";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  app.use(express.json());
  app.use(cookieParser());

  app.use("/api", apiRouter);

  // Initialize auto-renewal cronjob
  setupCron();

  // Vite middleware for development GUI or serve static files
  const distPath = path.join(process.cwd(), 'dist');
  const hasBuild = fs.existsSync(path.join(distPath, 'index.html'));
  
  if (!hasBuild || process.env.NODE_ENV === "development") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    logger.info(`Server running on http://localhost:${PORT}`);
  });
}
startServer();

