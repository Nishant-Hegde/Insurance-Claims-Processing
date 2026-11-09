import { NextResponse } from "next/server";
import pool from "@/app/db/pool";
import { requireRole } from "@/app/lib/auth";
import {
  embedText,
  EmbeddingUnavailableError,
  findModelId,
  toPgVector,
} from "@/app/lib/embedding";
import { cleanText, dbErrorResponse, isUuid, jsonError, readJsonObject } from "@/app/lib/http";
import { getReferenceCase } from "@/app/lib/referenceCases";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/reference-cases/[id]   (ADMIN) — details plus the version chain. */
export async function GET(_request: Request, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireRole("ADMIN");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Reference case not found.");

  try {
    const referenceCase = await getReferenceCase(id);
    if (!referenceCase) return jsonError(404, "Reference case not found.");
    return NextResponse.json({ case: referenceCase });
  } catch (err) {
    return dbErrorResponse(err, "GET /api/reference-cases/[id]");
  }
}

/**
 * PATCH /api/reference-cases/[id]   (ADMIN)
 * body: { title?, description? }
 *
 * The schema makes reference cases immutable (fn_ref_case_immutable): past screening
 * matches must keep pointing at the exact evidence the adjuster saw. So an edit is
 * stored as a NEW version: CALL sp_revise_reference_case deactivates this row and inserts
 * a re-embedded copy with supersedes_case_id = this id, in one transaction.
 * Returns the new case id; the old id stays readable as history.
 */
export async function PATCH(request: Request, { params }: Ctx): Promise<NextResponse> {
  const auth = await requireRole("ADMIN");
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (!isUuid(id)) return jsonError(404, "Reference case not found.");

  const body = await readJsonObject(request);
  if (!body) return jsonError(400, "Send a JSON object.");
  if (body.title === undefined && body.description === undefined) {
    return jsonError(400, "Send a new title and/or description.");
  }

  try {
    const { rows } = await pool.query<{ title: string; description: string; is_active: boolean }>(
      `SELECT title, description, is_active FROM reference_fraud_case WHERE case_id = $1`,
      [id]
    );
    const current = rows[0];
    if (!current) return jsonError(404, "Reference case not found.");
    if (!current.is_active) {
      return jsonError(409, "Only the active version of a reference case can be edited.");
    }

    const title = body.title === undefined ? current.title : cleanText(body.title, 5, 150);
    const description =
      body.description === undefined ? current.description : cleanText(body.description, 30, 5000);
    if (!title) return jsonError(400, "Title must be 5 to 150 characters.");
    if (!description) return jsonError(400, "Description must be 30 to 5000 characters.");
    if (title === current.title && description === current.description) {
      return jsonError(400, "Nothing changed.");
    }

    // Always re-embed: the new version may also move the case onto the current model.
    const embedding = await embedText(description);
    const modelId = await findModelId(embedding);
    if (modelId === null) {
      return jsonError(503, `Embedding model ${embedding.modelName} (${embedding.modelVersion}) is not registered.`);
    }

    const result = await pool.query<{ p_new_case_id: string }>(
      `CALL sp_revise_reference_case($1::uuid, $2::uuid, $3::varchar, $4::text, $5::integer, $6::vector, NULL)`,
      [id, auth.user.userId, title, description, modelId, toPgVector(embedding.vector)]
    );
    return NextResponse.json({
      caseId: result.rows[0].p_new_case_id,
      supersededCaseId: id,
      note: "Reference cases are immutable; the edit was saved as a new version and the old one was deactivated.",
    });
  } catch (err) {
    if (err instanceof EmbeddingUnavailableError) return jsonError(503, err.message);
    return dbErrorResponse(err, "PATCH /api/reference-cases/[id]");
  }
}
