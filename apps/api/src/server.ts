import cors from "cors";
import express from "express";
import { config } from "./config.js";

const app = express();
app.disable("x-powered-by");
app.use(cors({ origin: config.WEB_ORIGIN, credentials: true }));
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", service: "rateforces-api", timestamp: new Date().toISOString() });
});

app.use((_request, response) => {
  response.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

app.listen(config.API_PORT, () => {
  console.info(`RateForces API listening on http://localhost:${config.API_PORT}`);
});
