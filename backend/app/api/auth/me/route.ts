import { NextResponse } from "next/server";
import { getSessionUser } from "@/app/lib/auth";

export async function GET(): Promise<NextResponse> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }
  return NextResponse.json({ user });
}
