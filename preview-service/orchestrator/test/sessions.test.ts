import { beforeEach, describe, expect, it, vi } from "vitest";
import { SessionManager, type ExecFn } from "../src/sessions.js";
import type { Config } from "../src/config.js";

const cfg: Config = {
  port: 8080,
  publicUrl: "https://preview.test",
  sessionJwtSecret: "s",
  apiToken: "t",
  emulatorImage: "struktr-emulator:latest",
  emulatorWebPort: 8080,
  maxSessions: 2,
  sessionTtlMinutes: 30,
  poolHours: "00:00-23:59", // always open for tests
  poolDays: "1-7",
  poolTz: "UTC",
  apkCacheDir: "/tmp/struktr-test-apks",
  dockerNetwork: "struktr",
};

function fakeDocker() {
  const containers: Record<string, { stopped: boolean }> = {};
  let n = 0;
  return {
    containers,
    createContainer: vi.fn(async () => {
      const id = `container-${++n}`;
      containers[id] = { stopped: false };
      return {
        id,
        start: vi.fn(async () => {}),
        inspect: vi.fn(async () => ({
          NetworkSettings: { Networks: { struktr: { IPAddress: `10.0.0.${n}` } } },
        })),
      };
    }),
    getContainer: vi.fn((id: string) => ({
      stop: vi.fn(async () => {
        containers[id].stopped = true;
      }),
    })),
  };
}

// exec fake that resolves instantly; provisioning stops before fetchApk by
// stubbing it per-test when needed.
const okExec: ExecFn = async () => "";

describe("SessionManager", () => {
  let docker: ReturnType<typeof fakeDocker>;
  let clock: number;
  let manager: SessionManager;

  beforeEach(() => {
    docker = fakeDocker();
    clock = 1_000_000;
    manager = new SessionManager(docker as never, cfg, okExec, () => clock);
    // Skip the real APK download in provision()
    vi.spyOn(manager as never as { fetchApk: () => Promise<string> }, "fetchApk")
      .mockResolvedValue("/tmp/fake.apk");
  });

  it("creates a session with container, ip and booting status", async () => {
    const s = await manager.create({ prHash: "abc123", device: "pixel-7", apkUrl: "http://x/app.apk" });
    expect(s.id).toMatch(/^abc123-pixel-7-/);
    expect(s.ip).toBe("10.0.0.1");
    expect(s.status).toBe("booting");
    expect(docker.createContainer).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(manager.get(s.id)?.status).toBe("ready"));
  });

  it("is idempotent per PR + device", async () => {
    const a = await manager.create({ prHash: "abc", device: "pixel-7", apkUrl: "http://x" });
    const b = await manager.create({ prHash: "abc", device: "pixel-7", apkUrl: "http://x" });
    expect(b.id).toBe(a.id);
    expect(docker.createContainer).toHaveBeenCalledOnce();
  });

  it("rejects unknown devices", async () => {
    await expect(
      manager.create({ prHash: "abc", device: "iphone-15", apkUrl: "http://x" }),
    ).rejects.toThrow(/Unknown device/);
  });

  it("enforces the max session cap", async () => {
    await manager.create({ prHash: "a", device: "pixel-7", apkUrl: "http://x" });
    await manager.create({ prHash: "b", device: "pixel-7", apkUrl: "http://x" });
    await expect(
      manager.create({ prHash: "c", device: "pixel-7", apkUrl: "http://x" }),
    ).rejects.toMatchObject({ code: "pool_full" });
  });

  it("refuses creation when the pool is closed", async () => {
    const closed = new SessionManager(
      docker as never,
      { ...cfg, poolHours: "08:00-08:01", poolDays: "1", poolTz: "UTC" },
      okExec,
    );
    await expect(
      closed.create({ prHash: "x", device: "pixel-7", apkUrl: "http://x" }),
    ).rejects.toMatchObject({ code: "pool_closed" });
  });

  it("reaps idle sessions and stops their containers", async () => {
    const s = await manager.create({ prHash: "abc", device: "pixel-7", apkUrl: "http://x" });
    clock += 31 * 60_000;
    const reaped = await manager.reap();
    expect(reaped).toEqual([s.id]);
    expect(manager.get(s.id)).toBeUndefined();
    expect(docker.containers[s.containerId].stopped).toBe(true);
  });

  it("touch keeps a session alive past the TTL", async () => {
    const s = await manager.create({ prHash: "abc", device: "pixel-7", apkUrl: "http://x" });
    clock += 29 * 60_000;
    manager.touch(s.id);
    clock += 2 * 60_000;
    expect(await manager.reap()).toEqual([]);
    expect(manager.get(s.id)).toBeDefined();
  });
});
