import { describe, expect, it } from "vitest";
import { FlowValidationError, serializeFlow, validateSteps } from "../src/serialize.js";

const GOOD_STEPS = [
  { command: "assertVisible", value: "Welcome" },
  { command: "takeScreenshot", value: "home" },
  { command: "tapOn_text", value: "Settings" },
  { command: "waitForAnimationToEnd", value: "" },
  { command: "takeScreenshot", value: "Settings Screen!" },
];

describe("validateSteps", () => {
  it("accepts a valid flow", () => {
    expect(() => validateSteps(GOOD_STEPS)).not.toThrow();
  });

  it("rejects empty flows", () => {
    expect(() => validateSteps([])).toThrow(FlowValidationError);
  });

  it("rejects unknown commands (injection guard)", () => {
    expect(() =>
      validateSteps([{ command: "runScript", value: "evil.js" }]),
    ).toThrow(/Unknown command/);
  });

  it("rejects flows without screenshots", () => {
    expect(() =>
      validateSteps([{ command: "tapOn_text", value: "OK" }]),
    ).toThrow(/no screenshots/);
  });

  it("rejects oversized flows", () => {
    const many = Array.from({ length: 31 }, () => ({ command: "scroll", value: "" }));
    many.push({ command: "takeScreenshot", value: "x" });
    expect(() => validateSteps(many)).toThrow(/max 30/);
  });
});

describe("serializeFlow", () => {
  it("produces a valid Maestro flow with numbered screenshots", () => {
    const yaml = serializeFlow("app.struktr.example", GOOD_STEPS);
    expect(yaml).toContain("appId: app.struktr.example");
    expect(yaml).toContain("- launchApp:\n    clearState: true");
    expect(yaml).toContain("- takeScreenshot: screenshots/01-home");
    expect(yaml).toContain("- takeScreenshot: screenshots/02-settings-screen");
    expect(yaml).toContain('- tapOn: "Settings"');
    expect(yaml).toContain("- waitForAnimationToEnd:\n    timeout: 3000");
  });

  it("quotes values so text cannot break YAML structure", () => {
    const yaml = serializeFlow("app.x", [
      { command: "assertVisible", value: 'evil: "\ninjected: yes' },
      { command: "takeScreenshot", value: "s" },
    ]);
    expect(yaml).toContain('- assertVisible: "evil: \\"\\ninjected: yes"');
  });
});
