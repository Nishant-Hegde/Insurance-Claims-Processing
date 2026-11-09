/** Ad-hoc similarity search over reference fraud cases (server-only). */
import pool from "@/app/db/pool";
import {
  embedText,
  EmbeddingUnavailableError,
  findModelId,
  toPgVector,
} from "@/app/lib/embedding";

export interface SimilarCase {
  caseId: string;
  title: string;
  excerpt: string;
  similarity: number;
}

export interface SimilarResult {
  query: string;
  model: { name: string; version: string; dimension: number };
  k: number;
  results: SimilarCase[];
}

export async function findSimilarCases(text: string, k: number): Promise<SimilarResult> {
  const embedding = await embedText(text);
  const modelId = await findModelId(embedding);
  if (modelId === null) {
    throw new EmbeddingUnavailableError(
      `embedding model ${embedding.modelName} (${embedding.modelVersion}) is not registered; load the reference-case seed first`
    );
  }

  // Same shape as the query documented next to ix_ref_case_embedding_hnsw: the WHERE clause
  // implies the partial index predicate and ORDER BY uses <=>, so the HNSW index is used.
  const { rows } = await pool.query<{
    case_id: string;
    title: string;
    excerpt: string;
    similarity: number;
  }>(
    `SELECT case_id, title, left(description, 220) AS excerpt,
            1 - (embedding <=> $1::vector) AS similarity
     FROM   reference_fraud_case
     WHERE  is_active AND is_confirmed AND embedding_model_id = $2
     ORDER  BY embedding <=> $1::vector
     LIMIT  $3`,
    [toPgVector(embedding.vector), modelId, k]
  );

  return {
    query: text,
    model: { name: embedding.modelName, version: embedding.modelVersion, dimension: embedding.dimension },
    k,
    results: rows.map((r) => ({
      caseId: r.case_id,
      title: r.title,
      excerpt: r.excerpt,
      similarity: Number(r.similarity),
    })),
  };
}
