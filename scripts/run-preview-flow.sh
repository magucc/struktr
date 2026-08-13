#!/usr/bin/env bash
# Runs inside the emulator-runner step as a single command (that action executes
# each script line as a separate `sh -c`, so all multi-line logic lives here).
# Env: STRUKTR_APK_PATH, STRUKTR_FLOWS, STRUKTR_AGENT_FLOWS, STRUKTR_APP_ID,
#      STRUKTR_ACTION_PATH, MAESTRO_BIN, GITHUB_WORKSPACE (+ provider creds)
set -uo pipefail

set -e
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 1000
adb shell am broadcast -a com.android.systemui.demo -e command battery -e level 100 -e plugged false
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e mobile hide
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
adb install -r "$STRUKTR_APK_PATH"
set +e

FLOWS="$STRUKTR_FLOWS"
if [ "${STRUKTR_AGENT_FLOWS:-false}" = "true" ]; then
  if node "$STRUKTR_ACTION_PATH/agent-capture/src/cli.js" --agentic \
      --app-id "$STRUKTR_APP_ID" \
      --context /tmp/struktr-ctx.json \
      --out .maestro/generated/agent-flow.yaml \
      --workspace "$GITHUB_WORKSPACE"; then
    FLOWS=".maestro/generated/agent-flow.yaml"
  else
    echo "::warning::agent-capture failed; using committed flows"
  fi
fi

"${MAESTRO_BIN:-maestro}" test "$FLOWS"
STATUS=$?

mkdir -p screenshots
echo "--- locating captured PNGs ---"
find "$HOME/.maestro" -name '*.png' -exec cp -v {} screenshots/ \; 2>/dev/null || true
ls -la screenshots/
exit $STATUS
