/**
 * Server-side authentication helpers.
 *
 * Sessions live in the `user_session` table (database/migrations/001).
 * The browser cookie holds a random token; only its SHA-256 hash is stored.
 * Every request re-checks the session and role in the database, so a
 * revoked session or a deactivated user loses access immediately.
 *
 * Import this only from server code (route handlers, server components).
 */
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import type { Role, SessionUser } from "@/app/types";

export const SESSION_COOKIE = "cg_session";
const SESSION_HOURS = 8;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Creates a session row and sets the login cookie. */
export async function createSession(
  userId: string,
  userAgent: string | null
): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  await pool.query(
    `INSERT INTO user_session (user_id, token_hash, expires_at, user_agent)
     VALUES ($1, $2, now() + make_interval(hours => $3), $4)`,
    [userId, hashToken(token), SESSION_HOURS, userAgent?.slice(0, 300) ?? null]
  );
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

/** Returns the signed-in user, or null. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const { rows } = await pool.query<{
    user_id: string;
    email: string;
    full_name: string;
    role_name: Role;
  }>(
    `SELECT user_id, email, full_name, role_name
     FROM fn_session_principal($1)`,
    [hashToken(token)]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    userId: r.user_id,
    email: r.email,
    fullName: r.full_name,
    role: r.role_name,
  };
}

/** Revokes the current session in the database and clears the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await pool.query(
      `UPDATE user_session SET revoked_at = now()
       WHERE token_hash = $1 AND revoked_at IS NULL`,
      [hashToken(token)]
    );
  }
  store.delete(SESSION_COOKIE);
}

/**
 * Guard for API route handlers.
 * Returns the user when allowed, otherwise a 401/403 response to return as-is.
 */
export async function requireRole(
  ...allowed: Role[]
): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const user = await getSessionUser();
  if (!user) {
    return {
      response: NextResponse.json({ error: "Please sign in." }, { status: 401 }),
    };
  }
  if (!allowed.includes(user.role)) {
    return {
      response: NextResponse.json(
        { error: "You do not have access to this resource." },
        { status: 403 }
      ),
    };
  }
  return { user };
}

/** Where each role lands after signing in. */
export function homePathFor(role: Role): string {
  return role === "POLICYHOLDER" ? "/my-claims" : "/";
}
