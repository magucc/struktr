import { timingSafeEqual } from "node:crypto";
import jwt from "jsonwebtoken";
import type { NextFunction, Request, Response } from "express";

export function signSessionToken(
  secret: string,
  sessionId: string,
  ttlMinutes: number,
): string {
  return jwt.sign({ sid: sessionId }, secret, { expiresIn: `${ttlMinutes}m` });
}

export function verifySessionToken(secret: string, token: string): string | null {
  try {
    const payload = jwt.verify(token, secret) as { sid?: string };
    return payload.sid ?? null;
  } catch {
    return null;
  }
}

/** Bearer-token middleware for the /api routes (called by CI / the GitHub App). */
export function apiAuth(apiToken: string) {
  const expected = Buffer.from(apiToken);
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization ?? "";
    const got = Buffer.from(header.replace(/^Bearer\s+/i, ""));
    const ok =
      got.length === expected.length && timingSafeEqual(got, expected);
    if (!ok) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}
