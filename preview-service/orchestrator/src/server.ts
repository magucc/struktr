import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import httpProxy from "http-proxy";
import type { Server } from "node:http";
import type { Config } from "./config.js";
import { apiAuth, signSessionToken, verifySessionToken } from "./auth.js";
import type { SessionManager } from "./sessions.js";
import { DEVICES } from "./devices.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp(manager: SessionManager, cfg: Config) {
  const app = express();
  app.use(express.json());

  const playerTemplate = readFileSync(
    path.join(__dirname, "..", "static", "player.html"),
    "utf8",
  );

  app.get("/healthz", (_req, res) => {
    res.json({
      ok: true,
      poolOpen: manager.poolOpen(),
      sessions: manager.list().length,
    });
  });

  // ── API (GitHub App / CI) ────────────────────────────────────────────────
  const api = express.Router();
  api.use(apiAuth(cfg.apiToken));

  api.post("/sessions", async (req, res) => {
    try {
      const { prHash, device, apkUrl, appId, backendUrl } = req.body ?? {};
      if (!prHash || !device || !apkUrl) {
        res.status(400).json({ error: "prHash, device and apkUrl are required" });
        return;
      }
      const session = await manager.create({ prHash, device, apkUrl, appId, backendUrl });
      const token = signSessionToken(cfg.sessionJwtSecret, session.id, cfg.sessionTtlMinutes);
      res.status(201).json({
        id: session.id,
        status: session.status,
        playerUrl: `${cfg.publicUrl}/pr/${encodeURIComponent(prHash)}/${device}?t=${token}`,
      });
    } catch (err) {
      const e = err as Error & { statusCode?: number; code?: string };
      res.status(e.statusCode ?? 500).json({ error: e.message, code: e.code });
    }
  });

  api.get("/sessions", (_req, res) => {
    res.json(manager.list().map(({ containerId: _c, ...rest }) => rest));
  });

  api.delete("/sessions/:id", async (req, res) => {
    await manager.destroy(req.params.id);
    res.status(204).end();
  });

  app.use("/api", api);

  // ── Player ───────────────────────────────────────────────────────────────
  app.get("/pr/:prHash/:device", (req, res) => {
    const token = String(req.query.t ?? "");
    const sid = verifySessionToken(cfg.sessionJwtSecret, token);
    const session = sid ? manager.get(sid) : undefined;

    if (!manager.poolOpen() && !session) {
      res.status(503).send(renderClosed(cfg));
      return;
    }
    if (!session || session.prHash !== req.params.prHash) {
      res.status(404).send("Unknown or expired preview session. Re-run the preview from the PR.");
      return;
    }
    manager.touch(session.id);
    const device = DEVICES[session.device];
    res.send(
      playerTemplate
        .replaceAll("{{SESSION_ID}}", session.id)
        .replaceAll("{{TOKEN}}", token)
        .replaceAll("{{PR}}", session.prHash)
        .replaceAll("{{DEVICE_LABEL}}", device?.label ?? session.device)
        .replaceAll("{{STATUS}}", session.status),
    );
  });

  app.get("/pr/:prHash/:device/status", (req, res) => {
    const sid = verifySessionToken(cfg.sessionJwtSecret, String(req.query.t ?? ""));
    const session = sid ? manager.get(sid) : undefined;
    if (!session) {
      res.status(404).json({ error: "unknown session" });
      return;
    }
    manager.touch(session.id);
    res.json({ status: session.status, error: session.error ?? null });
  });

  return app;
}

/** Attach the /s/:id/* reverse proxy (HTTP + WebSocket) that fronts each
 * session's emulator web UI. Call after http.createServer(app). */
export function attachSessionProxy(server: Server, manager: SessionManager, cfg: Config): void {
  const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: true });
  proxy.on("error", () => {
    /* target gone; the player will show status=error */
  });

  const targetFor = (url: string): { target: string; rest: string } | null => {
    const m = url.match(/^\/s\/([^/]+)(\/.*)?$/);
    if (!m) return null;
    const session = manager.get(m[1]);
    if (!session || !session.ip) return null;
    manager.touch(session.id);
    return {
      target: `http://${session.ip}:${cfg.emulatorWebPort}`,
      rest: m[2] ?? "/",
    };
  };

  server.on("upgrade", (req, socket, head) => {
    const t = req.url ? targetFor(req.url) : null;
    if (!t) {
      socket.destroy();
      return;
    }
    req.url = t.rest;
    proxy.ws(req, socket, head, { target: t.target });
  });

  server.on("request", (req, res) => {
    if (!req.url?.startsWith("/s/")) return; // express handles everything else
    const t = targetFor(req.url);
    if (!t) {
      res.statusCode = 404;
      res.end("unknown session");
      return;
    }
    req.url = t.rest;
    proxy.web(req, res, { target: t.target });
  });
}

function renderClosed(cfg: Config): string {
  return `<!doctype html><meta charset="utf-8"><title>struktr — pool closed</title>
<body style="font-family:system-ui;background:#FAFAFC;color:#1A1A2E;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1 style="color:#5B4CF5">😴 Preview pool is asleep</h1>
<p>Interactive previews run ${cfg.poolHours} (${cfg.poolTz}, days ${cfg.poolDays}).</p>
<p>Static screenshots on the PR are always available.</p></div></body>`;
}
