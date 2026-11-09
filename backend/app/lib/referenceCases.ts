/**
 * Reference fraud case queries (server-only, ADMIN features).
 *
 * Cases are immutable after insert (fn_ref_case_immutable), so "edit" creates a new linked
 * version via sp_revise_reference_case (migration 003), and the old one is deactivated.
 */
import pool from "@/app/db/pool";

export type CaseStatusFilter = "active" | "inactive" | "all";

export interface ReferenceCaseSummary {
  caseId: string;
  title: string;
  excerpt: string;
  isActive: boolean;
  isConfirmed: boolean;
  createdAt: string;
  createdBy: string;
  deactivatedAt: string | null;
  modelName: string;
  modelVersion: string;
  supersedesCaseId: string | null;
  supersededByCaseId: string | null;
  matchCount: number;
  rank: number | null;
}

export interface ReferenceCaseVersion {
  caseId: string;
  title: string;
  isActive: boolean;
  createdAt: string;
  depth: number; // 0 = this case, negative = older, positive = newer
}

export interface ReferenceCaseDetail extends ReferenceCaseSummary {
  description: string;
  deactivatedBy: string | null;
  versions: ReferenceCaseVersion[];
}

type SummaryRow = {
  case_id: string;
  title: string;
  excerpt: string;
  description: string;
  is_active: boolean;
  is_confirmed: boolean;
  created_at: Date;
  created_by_name: string;
  deactivated_at: Date | null;
  deactivated_by_name: string | null;
  model_name: string;
  model_version: string;
  supersedes_case_id: string | null;
  superseded_by: string | null;
  match_count: number;
  rank: number | null;
};

const SELECT_CASES = `
  SELECT r.case_id, r.title, left(r.description, 240) AS excerpt, r.description,
         r.is_active, r.is_confirmed, r.created_at, cu.full_name AS created_by_name,
         r.deactivated_at, du.full_name AS deactivated_by_name,
         em.model_name, em.model_version, r.supersedes_case_id,
         (SELECT s.case_id FROM reference_fraud_case s
          WHERE s.supersedes_case_id = r.case_id) AS superseded_by,
         (SELECT count(*)::int FROM screening_match m
          WHERE m.reference_case_id = r.case_id) AS match_count`;

function toSummary(r: SummaryRow): ReferenceCaseSummary {
  return {
    caseId: r.case_id,
    title: r.title,
    excerpt: r.excerpt,
    isActive: r.is_active,
    isConfirmed: r.is_confirmed,
    createdAt: new Date(r.created_at).toISOString(),
    createdBy: r.created_by_name,
    deactivatedAt: r.deactivated_at ? new Date(r.deactivated_at).toISOString() : null,
    modelName: r.model_name,
    modelVersion: r.model_version,
    supersedesCaseId: r.supersedes_case_id,
    supersededByCaseId: r.superseded_by,
    matchCount: r.match_count,
    rank: r.rank === null || r.rank === undefined ? null : Number(r.rank),
  };
}

/** List with status filter and optional full-text search (GIN index ix_ref_case_fts). */
export async function listReferenceCases(
  status: CaseStatusFilter,
  q: string | null
): Promise<ReferenceCaseSummary[]> {
  const { rows } = await pool.query<SummaryRow>(
    `${SELECT_CASES},
         CASE WHEN $2::text IS NULL THEN NULL
              ELSE ts_rank(to_tsvector('english', r.title || ' ' || r.description),
                           websearch_to_tsquery('english', $2::text)) END AS rank
     FROM reference_fraud_case r
     JOIN app_user cu        ON cu.user_id  = r.created_by
     LEFT JOIN app_user du   ON du.user_id  = r.deactivated_by
     JOIN embedding_model em ON em.model_id = r.embedding_model_id
     WHERE ($1::text = 'all' OR r.is_active = ($1::text = 'active'))
       AND ($2::text IS NULL
            OR to_tsvector('english', r.title || ' ' || r.description)
               @@ websearch_to_tsquery('english', $2::text))
     ORDER BY rank DESC NULLS LAST, r.is_active DESC, r.created_at DESC
     LIMIT 200`,
    [status, q]
  );
  return rows.map(toSummary);
}

/** One case plus its full version chain, walked in both directions with WITH RECURSIVE. */
export async function getReferenceCase(caseId: string): Promise<ReferenceCaseDetail | null> {
  const { rows } = await pool.query<SummaryRow>(
    `${SELECT_CASES}, NULL::real AS rank
     FROM reference_fraud_case r
     JOIN app_user cu        ON cu.user_id  = r.created_by
     LEFT JOIN app_user du   ON du.user_id  = r.deactivated_by
     JOIN embedding_model em ON em.model_id = r.embedding_model_id
     WHERE r.case_id = $1`,
    [caseId]
  );
  const r = rows[0];
  if (!r) return null;

  const { rows: versions } = await pool.query<{
    case_id: string;
    title: string;
    is_active: boolean;
    created_at: Date;
    depth: number;
  }>(
    `WITH RECURSIVE older AS (
        SELECT case_id, supersedes_case_id, 0 AS depth
        FROM reference_fraud_case WHERE case_id = $1
        UNION ALL
        SELECT p.case_id, p.supersedes_case_id, o.depth - 1
        FROM reference_fraud_case p JOIN older o ON p.case_id = o.supersedes_case_id
     ),
     newer AS (
        SELECT case_id, 0 AS depth
        FROM reference_fraud_case WHERE case_id = $1
        UNION ALL
        SELECT s.case_id, n.depth + 1
        FROM reference_fraud_case s JOIN newer n ON s.supersedes_case_id = n.case_id
     ),
     chain AS (SELECT case_id, depth FROM older UNION SELECT case_id, depth FROM newer)
     SELECT c.case_id, r.title, r.is_active, r.created_at, c.depth
     FROM chain c JOIN reference_fraud_case r USING (case_id)
     ORDER BY c.depth`,
    [caseId]
  );

  return {
    ...toSummary(r),
    description: r.description,
    deactivatedBy: r.deactivated_by_name,
    versions: versions.map((v) => ({
      caseId: v.case_id,
      title: v.title,
      isActive: v.is_active,
      createdAt: new Date(v.created_at).toISOString(),
      depth: v.depth,
    })),
  };
}
