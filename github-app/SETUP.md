# struktr GitHub App — admin setup

One-time admin task: register the GitHub App, generate its credentials, deploy the
server, and install the App on the repos that should get previews.

> **Preferred: the manifest flow (~2 minutes, one browser click).** GitHub has no
> API to create an App outright, but `create-app.mjs` automates everything except
> the single confirmation click:
>
> ```bash
> node github-app/create-app.mjs \
>   --webhook-url https://app-preview.kju.ai/api/github/webhooks \
>   --org kju-ai \
>   --host <this-machine's-tailscale-name>   # so your browser can reach the callback
> ```
>
> Open the printed URL in a logged-in browser, click **Create App on GitHub**,
> and the script captures the App ID, private key, and webhook secret into `.env`
> automatically, then prints the install link. No webhook endpoint needs to exist
> yet — point it at a [smee.io](https://smee.io) channel and change it later in
> App settings. Skip to §4 (install) and §5 (wire up a repo) below.
>
> The manual form walk-through below (§1–§2) and `setup-wizard.sh` remain as the
> fallback path.

## Install on more repos (no browser needed)

The *first* install of the App on an account needs one browser approval. After
that, adding repos to the existing installation is pure `gh`:

```bash
# Find the installation id for your account/org
gh api /user/installations --jq '.installations[] | "\(.id) \(.app_slug) \(.account.login)"'

# Add a repo to it
REPO_ID=$(gh api repos/kju-ai/some-app --jq .id)
gh api -X PUT /user/installations/<INSTALLATION_ID>/repositories/$REPO_ID

# Remove one
gh api -X DELETE /user/installations/<INSTALLATION_ID>/repositories/$REPO_ID
```

Then drop a `.struktr.yml` in the repo (§5) and label a PR — that's the whole
onboarding for each additional repo.

## 1. Register the App

Go to **https://github.com/settings/apps/new** (personal account) or
`https://github.com/organizations/<ORG>/settings/apps/new` (org-owned — use the org
if the consuming repos live there).

Fill in exactly:

| Field | Value |
|---|---|
| **GitHub App name** | `struktr-previews` (must be globally unique — suffix if taken) |
| **Homepage URL** | `https://github.com/magucc/struktr` |
| **Webhook → Active** | ✅ checked |
| **Webhook URL** | `https://<PREVIEW_DOMAIN>/api/github/webhooks` (e.g. `https://app-preview.kju.ai/api/github/webhooks`) |
| **Webhook secret** | generate one: `openssl rand -hex 32` — keep it, you'll need it as `GITHUB_APP_WEBHOOK_SECRET` |

**Repository permissions** (leave everything else "No access"):

| Permission | Access | Why |
|---|---|---|
| Actions | **Read-only** | find the APK artifact CI built |
| Contents | **Read-only** | read `.struktr.yml` |
| Pull requests | **Read & write** | post/update the preview comment |
| Metadata | Read-only | mandatory, auto-selected |

**Subscribe to events**: ✅ `Pull request` · ✅ `Workflow run`

**Where can this App be installed?** → *Only on this account* (fine for now; widen later for SaaS).

Click **Create GitHub App**.

## 2. Capture credentials

On the App's settings page after creation:

1. **App ID** — shown at the top ("App ID: 123456") → env var `GITHUB_APP_ID`.
2. **Private key** — scroll to *Private keys* → **Generate a private key** → a `.pem`
   downloads. Store it safely (this is the App's identity). Provide it to the server
   as **one** of:
   - `GITHUB_APP_PRIVATE_KEY_PATH=/path/to/key.pem`, or
   - `GITHUB_APP_PRIVATE_KEY=$(base64 -w0 key.pem)` (base64 accepted), or
   - the raw PEM in `GITHUB_APP_PRIVATE_KEY`.
3. **Webhook secret** — the value you generated in step 1 → `GITHUB_APP_WEBHOOK_SECRET`.

## 3. Deploy the server

The app server ships in `preview-service/docker/docker-compose.yml` as the
`github-app` service and is routed by Caddy at `/api/github/*`. It needs these in
the shared `.env`:

```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=<base64 pem>
GITHUB_APP_WEBHOOK_SECRET=<from step 1>
ORCHESTRATOR_URL=https://<PREVIEW_DOMAIN>
ORCHESTRATOR_API_TOKEN=<from provision-vm.sh>
```

Then `docker compose up -d --build github-app` on the VM.

**Local development instead:** use [smee.io](https://smee.io) — create a channel,
set it as the Webhook URL, run `npx smee-client -u https://smee.io/<channel> -t http://localhost:3000/api/github/webhooks`,
and `npm run dev` in `github-app/`.

## 4. Install the App on repos

App settings → **Install App** → choose the account → **Only select repositories**
→ pick the app repo(s) → Install.

## 5. Wire up a repo

In each installed repo:

1. Add `.struktr.yml` (all keys optional — defaults shown):

```yaml
app_id: ai.kju.app                              # Android applicationId (enables auto-launch)
label: app-preview                               # PR label that triggers pickup
artifact: preview-apk                            # CI artifact name containing the APK
devices: [pixel-7, samsung-a16]
backend_url: "https://pr-{number}.preview.kju.ai"  # {number}/{sha} substituted per PR
flows: .maestro/preview
agent_capture: false
```

2. Make CI upload the APK as an artifact with that name:

```yaml
- uses: actions/upload-artifact@v4
  with:
    name: preview-apk
    path: app/build/outputs/apk/debug/app-debug.apk
```

3. Create the `app-preview` label, add it to a PR → the App posts the preview
   comment ("waiting for CI" until the artifact lands, then per-device
   **▶ Open interactive preview** links).

## Sanity checks

- `https://<PREVIEW_DOMAIN>/healthz` → orchestrator OK.
- App settings → **Advanced** → *Recent Deliveries* shows each webhook with the
  server's response; redeliver from there when debugging.
