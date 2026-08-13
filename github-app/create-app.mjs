#!/usr/bin/env node
/** Create the struktr GitHub App via the App Manifest flow.
 *
 * GitHub has no API to create an App outright — creation requires one browser
 * confirmation. This script removes everything else: it serves a pre-filled
 * manifest form, you click one button on github.com, GitHub redirects back
 * here with a code, and the script exchanges it for the App's credentials
 * (App ID, private key, webhook secret) and writes them to .env.
 *
 * Usage:
 *   node github-app/create-app.mjs --webhook-url https://app-preview.kju.ai/api/github/webhooks \
 *     [--name struktr-previews] [--org kju-ai] [--host clawbrain] [--port 8377] [--env-out .env]
 *
 * Run it on any machine; open the printed URL from a browser that is logged in
 * to GitHub and can reach this machine (use --host with the Tailscale hostname
 * when running on a headless box). No webhook endpoint needs to exist yet —
 * point --webhook-url at a smee.io channel and update it later in App settings.
 */
import http from "node:http";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const name = arg("name", "struktr-previews");
const org = arg("org");
const webhookUrl = arg("webhook-url");
const host = arg("host", "localhost");
const port = Number(arg("port", "8377"));
const envOut = arg("env-out", ".env");

if (!webhookUrl) {
  console.error("Usage: create-app.mjs --webhook-url <url> [--name N] [--org ORG] [--host H] [--port P]");
  process.exit(1);
}

const manifest = {
  name,
  url: "https://github.com/magucc/struktr",
  description: "Preview screenshots instead of preview deployments for mobile PRs",
  hook_attributes: { url: webhookUrl, active: true },
  redirect_url: `http://${host}:${port}/callback`,
  public: false,
  default_permissions: { actions: "read", contents: "read", pull_requests: "write" },
  default_events: ["pull_request", "workflow_run"],
};

if (process.argv.includes("--print-manifest")) {
  console.log(JSON.stringify(manifest, null, 2));
  process.exit(0);
}

const formTarget = org
  ? `https://github.com/organizations/${org}/settings/apps/new`
  : "https://github.com/settings/apps/new";

function upsertEnv(file, entries) {
  let body = existsSync(file) ? readFileSync(file, "utf8") : "";
  for (const [key, value] of Object.entries(entries)) {
    const line = `${key}=${value}`;
    const re = new RegExp(`^${key}=.*$`, "m");
    body = re.test(body) ? body.replace(re, line) : body + (body.endsWith("\n") || body === "" ? "" : "\n") + line + "\n";
  }
  writeFileSync(file, body.endsWith("\n") ? body : body + "\n");
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`);

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><meta charset="utf-8"><title>Create ${name}</title>
<body style="font-family:system-ui;max-width:640px;margin:80px auto;color:#1A1A2E">
<h1 style="color:#5B4CF5">Create the <code>${name}</code> GitHub App</h1>
<p>This posts a pre-filled manifest (permissions: Actions&nbsp;R, Contents&nbsp;R, PRs&nbsp;RW ·
events: pull_request, workflow_run · webhook: <code>${webhookUrl}</code>)
to GitHub${org ? ` for the <b>${org}</b> org` : ""}. You confirm once on github.com, then land back here.</p>
<form action="${formTarget}" method="post">
  <input type="hidden" name="manifest" value='${JSON.stringify(manifest).replaceAll("'", "&#39;")}'>
  <button type="submit" style="font-size:18px;padding:12px 28px;background:#5B4CF5;color:#fff;border:none;border-radius:8px;cursor:pointer">
    Create App on GitHub →
  </button>
</form></body>`);
    return;
  }

  if (url.pathname === "/callback") {
    const code = url.searchParams.get("code");
    try {
      const resp = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
        method: "POST",
        headers: { accept: "application/vnd.github+json" },
      });
      if (!resp.ok) throw new Error(`conversion failed: HTTP ${resp.status} ${await resp.text()}`);
      const app = await resp.json();

      upsertEnv(envOut, {
        GITHUB_APP_ID: app.id,
        GITHUB_APP_SLUG: app.slug,
        GITHUB_APP_PRIVATE_KEY: Buffer.from(app.pem).toString("base64"),
        GITHUB_APP_WEBHOOK_SECRET: app.webhook_secret,
      });

      const installUrl = `https://github.com/apps/${app.slug}/installations/new`;
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<body style="font-family:system-ui;max-width:640px;margin:80px auto">
<h1 style="color:#16a34a">✓ App created — credentials written to ${envOut}</h1>
<p>App ID <b>${app.id}</b>, slug <b>${app.slug}</b>. One step left:</p>
<p><a href="${installUrl}" style="font-size:18px">Install the App on your repos →</a></p>
<p>You can close this tab afterwards.</p></body>`);

      console.log(`\n✓ App created: id=${app.id} slug=${app.slug}`);
      console.log(`✓ Credentials written to ${envOut} (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY b64, GITHUB_APP_WEBHOOK_SECRET)`);
      console.log(`→ Install it on repos: ${installUrl}`);
      console.log(`→ Add repos later without the browser: see github-app/SETUP.md §Install on more repos`);
      setTimeout(() => server.close(() => process.exit(0)), 500);
    } catch (err) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(`Failed: ${err.message}\nRe-run the script and try again (codes are single-use, 1h expiry).`);
      console.error(`✗ ${err.message}`);
    }
    return;
  }

  res.writeHead(404).end();
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Open in a logged-in browser:  http://${host}:${port}/`);
  console.log(`(GitHub will redirect back to http://${host}:${port}/callback — the browser must reach this machine)`);
});
