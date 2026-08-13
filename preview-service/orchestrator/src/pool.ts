/** Business-hours gate. Sessions can only be created while the pool is open;
 * running sessions are allowed to finish their TTL. */

export interface PoolWindow {
  hours: string; // "08:00-18:30"
  days: string; // "1-5" (ISO: 1=Mon … 7=Sun) or "1,2,3"
  tz: string; // IANA timezone
}

const WEEKDAY: Record<string, number> = {
  Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7,
};

function localParts(now: Date, tz: string): { minutes: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    day: WEEKDAY[parts.weekday] ?? 0,
  };
}

function parseHours(hours: string): [number, number] {
  const m = hours.match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  if (!m) throw new Error(`Invalid POOL_HOURS "${hours}" (expected HH:MM-HH:MM)`);
  return [Number(m[1]) * 60 + Number(m[2]), Number(m[3]) * 60 + Number(m[4])];
}

function parseDays(days: string): Set<number> {
  const out = new Set<number>();
  for (const part of days.split(",")) {
    const range = part.match(/^(\d)-(\d)$/);
    if (range) {
      for (let d = Number(range[1]); d <= Number(range[2]); d++) out.add(d);
    } else if (/^\d$/.test(part.trim())) {
      out.add(Number(part.trim()));
    } else {
      throw new Error(`Invalid POOL_DAYS "${days}"`);
    }
  }
  return out;
}

export function isPoolOpen(window: PoolWindow, now: Date = new Date()): boolean {
  const [open, close] = parseHours(window.hours);
  const days = parseDays(window.days);
  const local = localParts(now, window.tz);
  return days.has(local.day) && local.minutes >= open && local.minutes < close;
}
