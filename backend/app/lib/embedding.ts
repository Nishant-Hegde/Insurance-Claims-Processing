/**
 * Client for the ClaimGuard embedding service (embedding-service/, FastAPI).
 * Server-only: called from route handlers and server components.
 */
import pool from "@/app/db/pool";

export const EMBEDDING_DIMENSION = 384;
const TIMEOUT_MS = 15_000;

export interface Embedding {
  modelName: string;
  modelVersion: string;
  dimension: number;
  vector: number[];
}

/** Thrown when the service is down, slow, or returns something unusable. */
export class EmbeddingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingUnavailableError";
  }
}

function serviceUrl(): string {
  return (process.env.EMBEDDING_SERVICE_URL ?? "http://127.0.0.1:8001").replace(/\/+$/, "");
}

export async function embedText(text: string): Promise<Embedding> {
  let res: Response;
  try {
    res = await fetch(`${serviceUrl()}/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "TimeoutError"
        ? `no response within ${TIMEOUT_MS / 1000} s`
        : "connection failed";
    throw new EmbeddingUnavailableError(`embedding service unavailable (${reason})`);
  }
  if (!res.ok) {
    throw new EmbeddingUnavailableError(`embedding service returned HTTP ${res.status}`);
  }
  const body = (await res.json()) as {
    model_name?: unknown;
    model_version?: unknown;
    dimension?: unknown;
    embedding?: unknown;
  };
  const vector = body.embedding;
  if (
    typeof body.model_name !== "string" ||
    typeof body.model_version !== "string" ||
    !Array.isArray(vector) ||
    vector.length !== EMBEDDING_DIMENSION ||
    !vector.every((x) => typeof x === "number" && Number.isFinite(x))
  ) {
    throw new EmbeddingUnavailableError("embedding service returned an invalid vector");
  }
  return {
    modelName: body.model_name,
    modelVersion: body.model_version,
    dimension: vector.length,
    vector: vector as number[],
  };
}

/** pgvector text literal, e.g. "[0.1,0.2,...]"; pass as a parameter and cast with ::vector. */
export function toPgVector(vector: number[]): string {
  return JSON.stringify(vector);
}

/**
 * The embedding_model row for the service's model. Returns null when it is not registered:
 * screening must then FAIL, because comparing against another model's vectors is meaningless.
 * Models are registered by the reference-case seed or scripts/reembed_reference_cases.py.
 */
export async function findModelId(e: Embedding): Promise<number | null> {
  const { rows } = await pool.query<{ model_id: number }>(
    `SELECT model_id FROM embedding_model
     WHERE model_name = $1 AND model_version = $2 AND dimension = $3`,
    [e.modelName, e.modelVersion, e.dimension]
  );
  return rows[0]?.model_id ?? null;
}
