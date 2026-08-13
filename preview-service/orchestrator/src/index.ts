import http from "node:http";
import { execFile } from "node:child_process";
import Dockerode from "dockerode";
import { loadConfig } from "./config.js";
import { SessionManager, type ExecFn } from "./sessions.js";
import { attachSessionProxy, createApp } from "./server.js";

const cfg = loadConfig();
const docker = new Dockerode({ socketPath: process.env.DOCKER_SOCKET ?? "/var/run/docker.sock" });

const exec: ExecFn = (cmd, args) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 180_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(" ")} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });

const manager = new SessionManager(docker, cfg, exec);
const app = createApp(manager, cfg);
const server = http.createServer(app);
attachSessionProxy(server, manager, cfg);

setInterval(() => {
  manager.reap().then((ids) => {
    if (ids.length) console.log(`[reaper] destroyed idle sessions: ${ids.join(", ")}`);
  }).catch((err) => console.error("[reaper]", err));
}, 60_000);

server.listen(cfg.port, () => {
  console.log(`struktr orchestrator on :${cfg.port} (pool ${cfg.poolHours} ${cfg.poolTz})`);
});
