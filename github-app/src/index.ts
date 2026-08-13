import { createServer } from "node:http";
import { App, createNodeMiddleware } from "octokit";
import { loadAppConfig } from "./config.js";
import {
  handlePreviewRequest,
  makeOrchestratorClient,
  type PrRef,
} from "./handler.js";

const cfg = loadAppConfig();
const app = new App({
  appId: cfg.appId,
  privateKey: cfg.privateKey,
  webhooks: { secret: cfg.webhookSecret },
});
const orchestrator = makeOrchestratorClient(cfg.orchestratorUrl, cfg.orchestratorApiToken);

function prRefFromPayload(payload: {
  repository: { owner: { login: string }; name: string };
  pull_request: {
    number: number;
    head: { sha: string };
    labels: { name: string }[];
  };
}): PrRef {
  return {
    owner: payload.repository.owner.login,
    repo: payload.repository.name,
    number: payload.pull_request.number,
    headSha: payload.pull_request.head.sha,
    labels: payload.pull_request.labels.map((l) => l.name),
  };
}

for (const event of ["pull_request.labeled", "pull_request.synchronize", "pull_request.reopened"] as const) {
  app.webhooks.on(event, async ({ octokit, payload }) => {
    const pr = prRefFromPayload(payload as never);
    const outcome = await handlePreviewRequest(octokit as never, orchestrator, pr);
    console.log(`[${event}] ${pr.owner}/${pr.repo}#${pr.number} @${pr.headSha.slice(0, 7)} → ${outcome}`);
  });
}

// CI often finishes after the label lands — retry pickup when a run completes.
app.webhooks.on("workflow_run.completed", async ({ octokit, payload }) => {
  for (const p of payload.workflow_run.pull_requests ?? []) {
    if (!p) continue;
    const { data: pull } = await (octokit as never as {
      rest: { pulls: { get: (a: object) => Promise<{ data: { number: number; head: { sha: string }; labels: { name: string }[] } }> } };
    }).rest.pulls.get({
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      pull_number: p.number,
    });
    const pr: PrRef = {
      owner: payload.repository.owner.login,
      repo: payload.repository.name,
      number: pull.number,
      headSha: pull.head.sha,
      labels: pull.labels.map((l) => l.name),
    };
    const outcome = await handlePreviewRequest(octokit as never, orchestrator, pr);
    console.log(`[workflow_run] ${pr.owner}/${pr.repo}#${pr.number} → ${outcome}`);
  }
});

app.webhooks.onError((err) => console.error("[webhook error]", err.message));

const middleware = createNodeMiddleware(app, { pathPrefix: "/api/github" });
const server = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (await middleware(req, res)) return;
  res.writeHead(404).end();
});

server.listen(cfg.port, () => {
  console.log(`struktr github-app on :${cfg.port} (webhooks at /api/github/webhooks)`);
});
