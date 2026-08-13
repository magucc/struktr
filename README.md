# struktr

**Preview screenshots instead of preview deployments** for mobile apps.

Hook any Android repo in: on a PR label (or any trigger you choose), struktr boots a
headless emulator on a free `ubuntu-latest` runner, drives your app through a
[Maestro](https://github.com/mobile-dev-inc/Maestro) flow, captures screenshots at
defined steps, and publishes them as a gallery — a sticky PR comment in PR context,
the job summary otherwise. Screenshots are archived on a branch of *your* repo;
struktr stores nothing.

iOS leg: planned (same flow file, extra gallery column, self-hosted macOS runner).

## Hook a repo in

1. Define a flow in your repo, e.g. `.maestro/preview/main-flow.yaml`:

```yaml
appId: com.your.app
---
- launchApp:
    clearState: true
- takeScreenshot: screenshots/01-start
- tapOn: "Sign in"
- takeScreenshot: screenshots/02-after-login
```

2. Add `.github/workflows/previews.yml`:

```yaml
name: previews
on:
  pull_request:
    types: [opened, reopened, synchronize, labeled]
  workflow_dispatch: {}   # branch-state runs: manual or via API

concurrency:
  group: previews-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

permissions:
  contents: write
  pull-requests: write

jobs:
  android:
    if: github.event_name == 'workflow_dispatch' || contains(github.event.pull_request.labels.*.name, 'simulator-screenshots')
    runs-on: ubuntu-latest
    timeout-minutes: 35
    steps:
      - uses: actions/checkout@v4
      - uses: magucc/struktr@v1
        with:
          apk-path: app/build/outputs/apk/debug/app-debug.apk
```

3. Create the `simulator-screenshots` label and add it to a PR. Done.

Other systems can trigger a branch-state run via the API:

```bash
gh workflow run previews.yml --repo you/your-app --ref your-branch
```

## Inputs

| Input | Default | Notes |
|---|---|---|
| `apk-path` | — (required) | APK to install on the emulator |
| `flows` | `.maestro/preview` | Maestro flow file or directory |
| `build-command` | `gradle assembleDebug` | Set to `skip` if the APK is prebuilt |
| `api-level` | `34` | Emulator API level (AVD snapshot cached per level) |
| `java-version` | `17` | JDK for the build |
| `gradle-version` | `8.9` | Provisioned Gradle for `build-command` |
| `archive-branch` | `screenshot-archive` | Branch in your repo where PNGs are pushed |
| `comment` | `true` | Upsert the PR gallery comment |
| `github-token` | `github.token` | Needs `contents: write` + `pull-requests: write` |

## Examples & self-test

- **React Native (Expo)**: [`examples/react-native`](examples/react-native) — native project generated in CI via `expo prebuild`, release APK (bundled JS, no Metro), same flow shape as the native POC. The [`self-test`](.github/workflows/self-test.yml) workflow runs the action from the local checkout against this example on every PR and push to main — the repo dogfoods itself.
- **Native Android (Kotlin)**: [struktr-poc](https://github.com/magucc/struktr-poc) — the original reference integration with the `MOCK_AUTH` build flavor.

## Beyond static galleries

The repo also contains the full interactive-preview platform (Appetize-style emulator-in-browser wired to per-PR backends) — see [`docs/architecture.md`](docs/architecture.md):

- **`preview-service/`** — session orchestrator + WebRTC emulator containers + player at `app-preview.<domain>/pr/{hash}/{device}`; business-hours pool; provision with `preview-service/deploy/provision-vm.sh`.
- **`github-app/`** — full abstraction: install the App, add `.struktr.yml`, label a PR — no workflow YAML needed. Admin setup: [`github-app/SETUP.md`](github-app/SETUP.md) or `github-app/setup-wizard.sh`.
- **`agent-capture/`** — pass `agent-flows: true` + `anthropic-api-key` to the action and a Claude agent derives the capture flow from the PR context (validated, whitelisted, falls back to committed flows).

## Notes

- Runs entirely in *your* repo's Actions — free on public repos, ~$0.03/run private.
- Deterministic pixels: animations disabled, status bar pinned via demo mode (fixed clock, full battery).
- Gallery images are raw URLs into the archive branch — they render in PR comments on **public repos**; for private repos use the job-summary gallery or the uploaded artifact.
- Mock your login with a build flavor (e.g. a `MOCK_AUTH` `buildConfigField`) so flows start from a seeded session — see [struktr-poc](https://github.com/magucc/struktr-poc) for the reference integration.
