import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "../src/auth.js";

describe("session tokens", () => {
  it("round-trips a session id", () => {
    const token = signSessionToken("secret", "pr1-pixel-7-abc", 30);
    expect(verifySessionToken("secret", token)).toBe("pr1-pixel-7-abc");
  });

  it("rejects a tampered token", () => {
    const token = signSessionToken("secret", "pr1-pixel-7-abc", 30);
    expect(verifySessionToken("other-secret", token)).toBeNull();
    expect(verifySessionToken("secret", token + "x")).toBeNull();
  });
});
