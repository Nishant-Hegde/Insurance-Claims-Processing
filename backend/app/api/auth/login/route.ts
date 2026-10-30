import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import pool from "@/app/db/pool";
import { createSession, homePathFor } from "@/app/lib/auth";
import type { Role } from "@/app/types";

// Compared against when the email is unknown, so a wrong email and a wrong
// password take the same time and return the same message.
const DUMMY_HASH =
  "$2b$12$UIVMhVRLT9oWqmNTKCrvbOObWuhpcOFrQ7XG1JptSM8HRZWzXrbCm";

export async function POST(request: Request): Promise<NextResponse> {
  let email = "";
  let password = "";
  try {
    const body = (await request.json()) as { email?: unknown; password?: unknown };
    email = typeof body.email === "string" ? body.email.trim() : "";
    password = typeof body.password === "string" ? body.password : "";
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!email || !password || email.length > 254 || password.length > 200) {
    return NextResponse.json(
      { error: "Enter your email and password." },
      { status: 400 }
    );
  }

  try {
    const { rows } = await pool.query<{
      user_id: string;
      password_hash: string;
      is_active: boolean;
      role_name: Role;
    }>(
      `SELECT u.user_id, u.password_hash, u.is_active, r.role_name
       FROM app_user u JOIN app_role r ON r.role_id = u.role_id
       WHERE lower(u.email) = lower($1)`,
      [email]
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);

    if (!user || !ok || !user.is_active) {
      return NextResponse.json(
        { error: "Incorrect email or password." },
        { status: 401 }
      );
    }

    await createSession(user.user_id, request.headers.get("user-agent"));
    return NextResponse.json({ redirectTo: homePathFor(user.role_name) });
  } catch (err: unknown) {
    console.error("[/api/auth/login]", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Sign-in is unavailable right now." },
      { status: 503 }
    );
  }
}
