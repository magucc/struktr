import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import type Dockerode from "dockerode";
import type { Config } from "./config.js";
import { getDevice } from "./devices.js";
import { isPoolOpen } from "./pool.js";

export interface CreateSessionRequest {
  prHash: string;
  device: string;
  apkUrl: string;
  appId?: string;
  backendUrl?: string;
}

export interface Session {
  id: string;
  prHash: string;
  device: string;
  containerId: string;
  ip: string;
  appId?: string;
  backendUrl?: string;
  createdAt: number;
  lastAccess: number;
  status: "booting" | "ready" | "error";
  error?: string;
}

/** Runs a host command (adb). Injected so tests don't need adb/docker. */
export type ExecFn = (cmd: string, args: string[]) => Promise<string>;

export class SessionManager {
  private sessions = new Map<string, Session>();

  constructor(
    private docker: Pick<Dockerode, "createContainer" | "getContainer">,
    private cfg: Config,
    private exec: ExecFn,
    private now: () => number = () => Date.now(),
  ) {}

  poolOpen(): boolean {
    return isPoolOpen({
      hours: this.cfg.poolHours,
      days: this.cfg.poolDays,
      tz: this.cfg.poolTz,
    });
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** Find an existing live session for the same PR + device (idempotent create). */
  find(prHash: string, device: string): Session | undefined {
    return this.list().find(
      (s) => s.prHash === prHash && s.device === device && s.status !== "error",
    );
  }

  touch(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.lastAccess = this.now();
  }

  async create(req: CreateSessionRequest): Promise<Session> {
    if (!this.poolOpen()) {
      throw Object.assign(new Error("Preview pool is outside business hours"), {
        statusCode: 503,
        code: "pool_closed",
      });
    }
    const existing = this.find(req.prHash, req.device);
    if (existing) {
      this.touch(existing.id);
      return existing;
    }
    const live = this.list().filter((s) => s.status !== "error").length;
    if (live >= this.cfg.maxSessions) {
      throw Object.assign(new Error("Session pool is full, retry shortly"), {
        statusCode: 429,
        code: "pool_full",
      });
    }

    const device = getDevice(req.device);
    const id = `${req.prHash}-${device.slug}-${randomBytes(3).toString("hex")}`;

    const container = await this.docker.createContainer({
      Image: this.cfg.emulatorImage,
      name: `struktr-session-${id}`,
      Labels: {
        "struktr.session": id,
        "struktr.pr": req.prHash,
        "struktr.device": device.slug,
      },
      Env: [
        `EMULATOR_PARAMS=${device.emulatorParams}`,
        "ADBKEY=", // emulator accepts any adb key when empty
      ],
      HostConfig: {
        NetworkMode: this.cfg.dockerNetwork,
        Devices: [
          { PathOnHost: "/dev/kvm", PathInContainer: "/dev/kvm", CgroupPermissions: "rwm" },
        ],
        Memory: 4 * 1024 * 1024 * 1024,
        AutoRemove: true,
      },
    });
    await container.start();

    const inspect = await container.inspect();
    const ip =
      inspect.NetworkSettings.Networks[this.cfg.dockerNetwork]?.IPAddress ?? "";

    const session: Session = {
      id,
      prHash: req.prHash,
      device: device.slug,
      containerId: container.id,
      ip,
      appId: req.appId,
      backendUrl: req.backendUrl,
      createdAt: this.now(),
      lastAccess: this.now(),
      status: "booting",
    };
    this.sessions.set(id, session);

    // Boot + provision in the background; the player page polls status.
    void this.provision(session, req).catch((err: Error) => {
      session.status = "error";
      session.error = err.message;
    });

    return session;
  }

  private async provision(session: Session, req: CreateSessionRequest): Promise<void> {
    const serial = `${session.ip}:5555`;
    await this.exec("adb", ["connect", serial]);
    await this.exec("adb", ["-s", serial, "wait-for-device", "shell",
      "while [ \"$(getprop sys.boot_completed)\" != \"1\" ]; do sleep 2; done"]);

    const apkPath = await this.fetchApk(req.apkUrl);
    await this.exec("adb", ["-s", serial, "install", "-r", apkPath]);

    if (req.backendUrl) {
      // Convention: preview builds read this global setting to pick their API base.
      await this.exec("adb", ["-s", serial, "shell",
        `settings put global struktr_backend_url '${req.backendUrl}'`]);
    }
    if (req.appId) {
      await this.exec("adb", ["-s", serial, "shell",
        `monkey -p ${req.appId} -c android.intent.category.LAUNCHER 1`]);
    }
    session.status = "ready";
  }

  private async fetchApk(apkUrl: string): Promise<string> {
    await mkdir(this.cfg.apkCacheDir, { recursive: true });
    const name = createHash("sha256").update(apkUrl).digest("hex").slice(0, 16);
    const dest = path.join(this.cfg.apkCacheDir, `${name}.apk`);
    const res = await fetch(apkUrl, { redirect: "follow" });
    if (!res.ok || !res.body) {
      throw new Error(`APK download failed: HTTP ${res.status}`);
    }
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
    return dest;
  }

  async destroy(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    this.sessions.delete(id);
    try {
      await this.docker.getContainer(session.containerId).stop({ t: 5 });
    } catch {
      // AutoRemove containers may already be gone.
    }
  }

  /** Kill sessions idle past the TTL. Returns the reaped ids. */
  async reap(): Promise<string[]> {
    const cutoff = this.now() - this.cfg.sessionTtlMinutes * 60_000;
    const stale = this.list().filter((s) => s.lastAccess < cutoff);
    for (const s of stale) await this.destroy(s.id);
    return stale.map((s) => s.id);
  }
}
