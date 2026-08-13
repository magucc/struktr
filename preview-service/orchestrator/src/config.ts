export interface Config {
  port: number;
  publicUrl: string;
  sessionJwtSecret: string;
  apiToken: string;
  emulatorImage: string;
  emulatorWebPort: number;
  maxSessions: number;
  sessionTtlMinutes: number;
  poolHours: string;
  poolDays: string;
  poolTz: string;
  apkCacheDir: string;
  dockerNetwork: string;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export function loadConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 8080),
    publicUrl: process.env.PUBLIC_URL ?? "http://localhost:8080",
    sessionJwtSecret: required("SESSION_JWT_SECRET"),
    apiToken: required("ORCHESTRATOR_API_TOKEN"),
    emulatorImage: process.env.EMULATOR_IMAGE ?? "struktr-emulator:latest",
    emulatorWebPort: Number(process.env.EMULATOR_WEB_PORT ?? 8080),
    maxSessions: Number(process.env.MAX_SESSIONS ?? 4),
    sessionTtlMinutes: Number(process.env.SESSION_TTL_MINUTES ?? 30),
    poolHours: process.env.POOL_HOURS ?? "08:00-18:30",
    poolDays: process.env.POOL_DAYS ?? "1-5",
    poolTz: process.env.POOL_TZ ?? "Europe/Amsterdam",
    apkCacheDir: process.env.APK_CACHE_DIR ?? "/var/cache/struktr-apks",
    dockerNetwork: process.env.DOCKER_NETWORK ?? "struktr",
  };
}
