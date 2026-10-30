import { NextResponse } from "next/server";
import { destroySession } from "@/app/lib/auth";

export async function POST(): Promise<NextResponse> {
  try {
    await destroySession();
  } catch (err: unknown) {
    console.error("[/api/auth/logout]", err instanceof Error ? err.message : err);
  }
  return NextResponse.json({ ok: true });
}
