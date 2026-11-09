import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import { requireRole } from "@/app/lib/auth";
import {
  embedText,
  EmbeddingUnavailableError,
  findModelId,
  toPgVector,
} from "@/app/lib/embedding";
import { cleanText, dbErrorResponse, jsonError, readJsonObject } from "@/app/lib/http";
import { listReferenceCases, type CaseStatusFilter } from "@/app/lib/referenceCases";

const STATUSES: CaseStatusFilter[] = ["active", "inactive", "all"];

/** GET /api/reference-cases?status=active|inactive|all&q=keywords   (ADMIN) */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireRole("ADMIN");
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const status = (url.searchParams.get("status") ?? "active") as CaseStatusFilter;
  if (!STATUSES.includes(status)) return jsonError(400, "status must be active, inactive or all.");
  const q = cleanText(url.searchParams.get("q"), 1, 200);

  try {
    return NextResponse.json({ cases: await listReferenceCases(status, q) });
  } catch (err) {
    return dbErrorResponse(err, "GET /api/reference-cases");
  }
}

/**
 * POST /api/reference-cases   (ADMIN)
 * body: { title, description }
 * Embeds the description first: a reference case without a vector would be unsearchable,
 * so if the embedding service is down nothing is stored (503).
 * The insert triggers check the creator is an active ADMIN and write REFERENCE_CASE_ADDED.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireRole("ADMIN");
  if ("response" in auth) return auth.response;

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, "Send a JSON object.");
  const title = cleanText(body.title, 5, 150);
  const description = cleanText(body.description, 30, 5000);
  if (!title) return jsonError(400, "Title must be 5 to 150 characters.");
  if (!description) return jsonError(400, "Description must be 30 to 5000 characters.");

  try {
    const embedding = await embedText(description);
    const modelId = await findModelId(embedding);
    if (modelId === null) {
      return jsonError(503, `Embedding model ${embedding.modelName} (${embedding.modelVersion}) is not registered.`);
    }
    const { rows } = await pool.query<{ case_id: string }>(
      `INSERT INTO reference_fraud_case
         (title, description, is_confirmed, is_active, embedding_model_id, embedding, created_by)
       VALUES ($1, $2, true, true, $3, $4::vector, $5)
       RETURNING case_id`,
      [title, description, modelId, toPgVector(embedding.vector), auth.user.userId]
    );
    return NextResponse.json({ caseId: rows[0].case_id }, { status: 201 });
  } catch (err) {
    if (err instanceof EmbeddingUnavailableError) return jsonError(503, err.message);
    return dbErrorResponse(err, "POST /api/reference-cases");
  }
}
