# struktr architecture

Two products in one repo: **static screenshot galleries** (shipped, CI-only) and
**interactive previews** (implemented, needs a KVM VM to go live).

```
                          ┌─────────────────────────────────────────────┐
 PR labeled ──webhook──▶  │ github-app/          (Phase C)              │
                          │  reads .struktr.yml · finds APK artifact    │
                          │  → POST orchestrator /api/sessions          │
                          │  → upserts PR comment (links per device)    │
                          └───────────────┬─────────────────────────────┘
                                          │ Bearer ORCHESTRATOR_API_TOKEN
                          ┌───────────────▼─────────────────────────────┐
 app-preview.<domain> ──▶ │ preview-service/     (Phases A+B)           │
   (Caddy, auto-TLS)      │  orchestrator: sessions, JWT player URLs,   │
                          │  TTL reaper, business-hours gate, /s/* proxy│
                          │  → docker run struktr-emulator (per session)│
                          │     (google/android-emulator-container-     │
                          │      scripts image, WebRTC, KVM)            │
                          └─────────────────────────────────────────────┘

 action.yml (static leg): label → KVM emulator on ubuntu-latest → Maestro flow
   → screenshots → archive branch + PR gallery comment
   optional: agent-capture/ (Phase D) derives the flow from the PR context
```

## Components

| Path | What | State |
|---|---|---|
| `action.yml` + `scripts/` | Composite action: static screenshot galleries | **Live**, self-tested in CI on `examples/react-native` |
| `examples/react-native` | Expo app the repo dogfoods itself with | Live |
| `preview-service/orchestrator` | Session manager (Express + dockerode + JWT), player page, `/s/*` HTTP+WS proxy | Unit-tested; needs VM for e2e |
| `preview-service/docker` | Compose: orchestrator + github-app + Caddy | Needs VM |
| `preview-service/deploy/provision-vm.sh` | Interactive wizard: VM, KVM, emulator image, DNS, secrets, scheduler | Human-run |
| `github-app` | Webhook server (octokit): label pickup, `.struktr.yml`, artifact resolution, PR comments | Unit-tested; needs App registration (`github-app/SETUP.md` / `setup-wizard.sh`) |
| `agent-capture` | Claude agentic loop (Messages API + custom tools): reads changed files for screen context, test-runs candidate flows on the live emulator, self-heals from failures, submits under a strict command whitelist; single-call mode as no-emulator fallback; committed flows as the hard fallback | Unit-tested; live behind `agent-flows: true` + API key |

## Key design decisions

- **Prebuilt artifacts, not builds.** The orchestrator installs APKs it downloads;
  it never builds customer code. CI (or the action) builds.
- **Screenshots archived in the consuming repo** (archive branch) — struktr stores nothing.
- **The agent emits structured steps, not YAML.** `agent-capture` constrains the
  model to a JSON schema with a command whitelist and serializes the Maestro YAML
  itself — no YAML injection, validation before execution, hard fallback to
  committed flows on any failure.
- **Business-hours pool**: orchestrator refuses new sessions outside `POOL_HOURS`
  (app-level gate) + VM start/stop scheduling (cost gate, wizard stage 7).
- **Isolation posture**: v0 runs emulator containers side-by-side — fine for
  first-party apps. Multi-tenant (untrusted APKs) requires VM-per-session
  (Tart/Orchard) and is deliberately out of scope until then.

## What needs a human (in order)

1. `preview-service/deploy/provision-vm.sh` — provision the KVM VM (AWS M8i/C8i on credits, or Azure Dsv5 with Standard security), build the emulator image, deploy, DNS.
2. `github-app/setup-wizard.sh` — register + install the GitHub App.
3. First on-VM iteration: wire the per-session WebRTC UI (`EMULATOR_WEB_PORT` → the google web container / `android-emulator-webrtc` component) — the proxy and player are ready for it; expect 1–2 days of tuning.

## iOS (later)

Same flow files. Static leg: EC2 Mac self-hosted runner. Interactive leg:
Tapflow-style Mac agent. The gallery and session model already reserve the slots.
