/** Small helpers shared by the API route handlers (server-only). */
import { NextResponse } from "next/server";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function jsonError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status });
}

/** Reads a JSON object body, or returns null when the body is not a JSON object. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Trimmed string within [min, max] characters, or null. */
export function cleanText(value: unknown, min: number, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().replace(/\s+/g, " ");
  return text.length >= min && text.length <= max ? text : null;
}

interface PgError {
  code?: string;
  message?: string;
  constraint?: string;
}

export function pgErrorCode(err: unknown): string | undefined {
  return (err as PgError | null)?.code;
}

/**
 * Plain-language versions of the messages our triggers and constraints raise.
 * The database stays the source of truth: these only reword its decision for the user.
 */
const FRIENDLY: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  [/HIGH-risk claim needs an information request/,
    "This claim is flagged HIGH risk. Request information from the policyholder and wait for their answer before approving it."],
  [/information request on this HIGH-risk claim is still unanswered/,
    "The policyholder has not answered the latest information request yet, so this HIGH-risk claim cannot be approved."],
  [/approval blocked: screening status is (\w+)/,
    (m) => `Approval is blocked because the automatic screening is ${m[1]}. Re-run the screening first.`],
  [/review did not examine a completed assessment/,
    "Approval is blocked because the review is not based on a completed screening of this claim."],
  [/is already decided|is decided and final/, "This claim has already been decided; it cannot be changed."],
  [/must be an active CLAIMS_ADJUSTER/, "Only an active claims adjuster can record a review."],
  [/must be an active POLICYHOLDER/, "Policies can only be issued to active policyholders."],
  [/must be an active ADMIN/, "Only an active administrator can do this."],
  [/outside the policy period or in the future/,
    "The incident date must fall inside the policy's coverage period and cannot be in the future."],
  [/policy .* is not active/, "That policy is not active."],
  [/claimant .* is not an active user/, "Your account is not active."],
  [/only the policyholder who submitted this claim/, "Only the policyholder who submitted this claim can answer it."],
  [/no outstanding information request/, "There is no open information request on this claim."],
  [/already been answered/, "You have already answered this information request."],
  [/is not waiting for information/, "This claim is not waiting for information."],
  [/last active administrator/, "You cannot deactivate the last active administrator."],
  [/already has a completed screening/, "This claim already has a completed screening."],
  [/must be marked read before dismissal/, "Mark the notification as read before dismissing it."],
  [/dismissed notification cannot be reopened/, "This notification was already dismissed."],
];

const FRIENDLY_CONSTRAINT: Record<string, string> = {
  policy_policy_number_key: "That policy number is already in use.",
  ck_policy_dates: "The expiry date must be after the effective date.",
  ck_claim_amount: "The claimed amount must be greater than zero.",
  ck_review_notes: "Notes cannot be empty.",
  ck_information_response_body: "The response cannot be empty.",
};

export function friendlyDbMessage(err: unknown): string | null {
  const e = err as PgError | null;
  if (e?.constraint && FRIENDLY_CONSTRAINT[e.constraint]) return FRIENDLY_CONSTRAINT[e.constraint];
  const message = e?.message ?? "";
  for (const [pattern, text] of FRIENDLY) {
    const m = message.match(pattern);
    if (m) return typeof text === "string" ? text : text(m);
  }
  return null;
}

/**
 * Maps database errors to HTTP responses. Rule violations raised by our triggers and
 * constraints are the caller's fault (4xx, with a readable message); anything else is
 * logged and reported as a generic 503 without internal details.
 */
export function dbErrorResponse(err: unknown, logTag: string): NextResponse {
  const code = pgErrorCode(err);
  const friendly = friendlyDbMessage(err);
  // The record's state, not the input, is the problem: 409 Conflict whatever the SQLSTATE.
  if (/already decided|decided and final|already has a completed screening|already been answered/.test(
    (err as PgError | null)?.message ?? "")) {
    return jsonError(409, friendly ?? "The record cannot be changed in its current state.");
  }
  // check_violation (23514): the values break a business rule
  if (code === "23514") return jsonError(422, friendly ?? "The request breaks a business rule.");
  // restrict_violation (23001): the record's current state forbids the change
  if (code === "23001") return jsonError(409, friendly ?? "The record cannot be changed in its current state.");
  if (code === "23503") return jsonError(400, "A referenced record does not exist.");
  if (code === "23505") return jsonError(409, friendly ?? "That record already exists.");
  if (code === "23502") return jsonError(400, "A required value is missing.");
  if (code === "22P02" || code === "22007" || code === "22008" || code === "22003")
    return jsonError(400, "One of the values has an invalid format.");
  console.error(`[${logTag}]`, err instanceof Error ? err.message : err);
  return jsonError(503, "The database is unavailable right now.");
}

/** Validates a YYYY-MM-DD date string. */
export function isIsoDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().startsWith(value)
  );
}
