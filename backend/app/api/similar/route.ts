import { NextResponse } from "next/server";
import { requireRole } from "@/app/lib/auth";
import { EmbeddingUnavailableError } from "@/app/lib/embedding";
import { cleanText, dbErrorResponse, jsonError } from "@/app/lib/http";
import { findSimilarCases } from "@/app/lib/similarity";

/**
 * GET /api/similar?text=...&k=5   (CLAIMS_ADJUSTER, ADMIN)
 * Ad-hoc semantic search: embeds the text and returns the k nearest active, confirmed
 * reference cases by cosine similarity (pgvector <=>, HNSW index). Read-only.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireRole("CLAIMS_ADJUSTER", "ADMIN");
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const text = cleanText(url.searchParams.get("text"), 3, 2000);
  if (!text) return jsonError(400, "Enter 3 to 2000 characters of text to search for.");
  const k = Number(url.searchParams.get("k") ?? 5);
  if (!Number.isInteger(k) || k < 1 || k > 20) {
    return jsonError(400, "k must be a whole number from 1 to 20.");
  }

  try {
    return NextResponse.json(await findSimilarCases(text, k));
  } catch (err) {
    if (err instanceof EmbeddingUnavailableError) return jsonError(503, err.message);
    return dbErrorResponse(err, "GET /api/similar");
  }
}
