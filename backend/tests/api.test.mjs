// ClaimGuard end-to-end API tests (node:test + fetch against a running dev server).
//
// Needs: a fresh database built with the full apply order (schema v4, seed v1, migration 001,
// demo passwords, migrations 002-004, reference cases v2), the embedding service, and the
// Next.js server. The tests change data, so use a disposable database.
//
//   API_BASE_URL=http://127.0.0.1:3000 node --test tests/api.test.mjs
//
// Tests run in file order and share state (one claim walks through the whole workflow).
import { test, before } from "node:test";
import assert from "node:assert/strict";

const BASE = (process.env.API_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const PW = { POLICYHOLDER: "POLICYHOLDER!Test2026", CLAIMS_ADJUSTER: "CLAIMS_ADJUSTER!Test2026", ADMIN: "ADMIN!Test2026" };
const ACCOUNTS = {
  holder: ["holder.ananya@example.com", PW.POLICYHOLDER],
  otherHolder: ["holder.suresh@example.com", PW.POLICYHOLDER],
  adjuster: ["adjuster.arjun@claimguard.internal", PW.CLAIMS_ADJUSTER],
  admin: ["admin.priya@claimguard.internal", PW.ADMIN],
};
const ANANYA_POLICY = "b1000000-0000-0000-0000-000000000001";
const SURESH_CLAIM = "d1000000-0000-0000-0000-000000000002";
const PARAPHRASE =
  "Minor collision damaged my front bumper and one headlight. The insurer approved that estimate, but the garage " +
  "(my wife's brother runs it) later billed a new radiator, both airbags and an engine mount as well.";

/** Signs in and returns a fetch helper that sends the session cookie. */
async function signIn(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `login ${email}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie?.startsWith("cg_session="), "session cookie set");
  return async (path, { method = "GET", body } = {}) => {
    const r = await fetch(`${BASE}${path}`, {
      method,
      redirect: "manual",
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = r.headers.get("content-type") ?? "";
    return { status: r.status, location: r.headers.get("location"), body: type.includes("json") ? await r.json() : await r.text() };
  };
}

const as = {};
const state = {};

before(async () => {
  for (const [key, [email, password]] of Object.entries(ACCOUNTS)) as[key] = await signIn(email, password);
});

// ---------------------------------------------------------------- authentication (FR-01)
test("01 each demo role signs in and /api/auth/me returns its role", async () => {
  const roles = { holder: "POLICYHOLDER", adjuster: "CLAIMS_ADJUSTER", admin: "ADMIN" };
  for (const [key, role] of Object.entries(roles)) {
    const r = await as[key]("/api/auth/me");
    assert.equal(r.status, 200);
    assert.equal(r.body.user.role, role);
  }
});

test("02 wrong password and deactivated user get the same 401", async () => {
  for (const [email, password] of [["holder.ananya@example.com", "wrong"], ["admin.deepa@claimguard.internal", PW.ADMIN]]) {
    const r = await fetch(`${BASE}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(r.status, 401);
    assert.equal((await r.json()).error, "Incorrect email or password.");
  }
});

test("03 no session: API returns 401, pages redirect to /login", async () => {
  assert.equal((await fetch(`${BASE}/api/claims`)).status, 401);
  const page = await fetch(`${BASE}/adjuster/queue`, { redirect: "manual" });
  assert.equal(page.status, 307);
  assert.match(page.headers.get("location") ?? "", /\/login$/);
});

// ---------------------------------------------------------------- authorization (FR-02, BR-01, AC-03)
test("04 policyholder cannot read another policyholder's claim (404, nothing revealed)", async () => {
  const r = await as.holder(`/api/claims/${SURESH_CLAIM}`);
  assert.equal(r.status, 404);
  assert.deepEqual(Object.keys(r.body), ["error"]);
});

test("05 policyholder cannot claim against someone else's policy (403)", async () => {
  const r = await as.otherHolder("/api/claims", {
    method: "POST",
    body: { policyId: ANANYA_POLICY, incidentDate: "2026-10-20", claimedAmount: 100, description: "Not my policy, trying anyway." },
  });
  assert.equal(r.status, 403);
});

test("06 policyholder is refused staff APIs (403)", async () => {
  assert.equal((await as.holder("/api/similar?text=staged%20crash")).status, 403);
  assert.equal((await as.holder("/api/reference-cases")).status, 403);
});

test("07 adjuster is refused admin APIs (403) and admin pages (redirect)", async () => {
  assert.equal((await as.adjuster("/api/reference-cases")).status, 403);
  assert.equal((await as.adjuster("/api/admin/policies", { method: "POST", body: {} })).status, 403);
  assert.equal((await as.adjuster("/api/admin/users/a3000000-0000-0000-0000-000000000003", { method: "PATCH", body: { isActive: false } })).status, 403);
  for (const path of ["/admin", "/admin/audit", "/admin/policies", "/admin/users"]) {
    const r = await as.adjuster(path);
    assert.equal(r.status, 307, path);
    assert.equal(r.location, "/", path);
  }
});

test("08 admin cannot record a review (only claims adjusters decide)", async () => {
  const r = await as.admin(`/api/claims/${SURESH_CLAIM}/review`, { method: "POST", body: { action: "REJECTED", notes: "Admin should not decide." } });
  assert.equal(r.status, 403);
});

// ---------------------------------------------------------------- validation (FR-15, AC-02)
test("09 invalid claims are rejected with readable messages", async () => {
  const base = { policyId: ANANYA_POLICY, incidentDate: "2026-10-20", claimedAmount: 100, description: "A valid description of the incident." };
  const cases = [
    [{ claimedAmount: -5 }, 400],
    [{ description: "short" }, 400],
    [{ incidentDate: "2026-02-30" }, 400],
    [{ incidentDate: "2099-01-01" }, 422], // database trigger: outside policy period / in the future
  ];
  for (const [patch, status] of cases) {
    const r = await as.holder("/api/claims", { method: "POST", body: { ...base, ...patch } });
    assert.equal(r.status, status, JSON.stringify(patch));
    assert.ok(typeof r.body.error === "string" && r.body.error.length > 10);
  }
});

// ---------------------------------------------------------------- submission and screening (FR-03/05/06/07/16, AC-01/10)
test("10 policyholder submits a paraphrased fraud pattern; response hides the risk result", async () => {
  const r = await as.holder("/api/claims", {
    method: "POST",
    body: { policyId: ANANYA_POLICY, incidentDate: "2026-10-20", claimedAmount: 184500, description: PARAPHRASE },
  });
  assert.equal(r.status, 201);
  assert.equal(r.body.claimStatus, "SUBMITTED");
  assert.equal(r.body.screening.status, "COMPLETED");
  assert.ok(!JSON.stringify(r.body).match(/HIGH|similar|riskIndicator/i), "no fraud evidence in the response");
  state.claimId = r.body.claimId;
});

test("11 adjuster sees MATCHES_FOUND, HIGH risk, review_required and the matching pattern ranked first", async () => {
  const r = await as.adjuster(`/api/claims/${state.claimId}`);
  assert.equal(r.status, 200);
  const { evidence } = r.body.claim;
  assert.equal(evidence.reviewRequired, true);
  const [latest] = evidence.assessments;
  assert.equal(latest.status, "COMPLETED");
  assert.equal(latest.outcome, "MATCHES_FOUND");
  assert.equal(latest.riskIndicator, "HIGH");
  assert.equal(latest.riskRuleVersion, "v2.0-minilm");
  assert.equal(latest.matches[0].rank, 1);
  assert.match(latest.matches[0].title, /Repair invoice inflated/);
  assert.ok(latest.matches[0].similarity >= 0.65, `top similarity ${latest.matches[0].similarity}`);
  for (let i = 1; i < latest.matches.length; i++) assert.ok(latest.matches[i - 1].similarity >= latest.matches[i].similarity, "ranked by similarity");
});

test("12 policyholder's view of the same claim has no fraud evidence", async () => {
  const r = await as.holder(`/api/claims/${state.claimId}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.claim.evidence, undefined);
});

test("13 an unrelated claim scores low", async () => {
  const r = await as.holder("/api/claims", {
    method: "POST",
    body: { policyId: ANANYA_POLICY, incidentDate: "2026-10-28", claimedAmount: 3200.5,
            description: "My daughter's school laptop slipped off the dining table at home and the screen cracked." },
  });
  assert.equal(r.status, 201);
  const d = await as.adjuster(`/api/claims/${r.body.claimId}`);
  const [latest] = d.body.claim.evidence.assessments;
  assert.equal(latest.riskIndicator, "LOW");
  assert.ok(latest.matches[0].similarity < 0.55, `top similarity ${latest.matches[0].similarity}`);
  assert.equal(d.body.claim.evidence.reviewRequired, false);
});

test("14 /api/similar ranks the matching pattern first for an ad-hoc description", async () => {
  const text = encodeURIComponent("my brother-in-law's garage padded the repair bill with parts that were never broken");
  const r = await as.adjuster(`/api/similar?k=3&text=${text}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.results.length, 3);
  assert.match(r.body.results[0].title, /Repair invoice inflated/);
});

// ---------------------------------------------------------------- HIGH-risk workflow (FR-08/09/18, BR-08, AC-06/12)
test("15 approving the HIGH-risk claim straight away is blocked by the database", async () => {
  const r = await as.adjuster(`/api/claims/${state.claimId}/review`, { method: "POST", body: { action: "APPROVED", notes: "Approving immediately." } });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /flagged HIGH risk/);
});

test("16 adjuster requests information; claim waits for the policyholder", async () => {
  const r = await as.adjuster(`/api/claims/${state.claimId}/review`, {
    method: "POST", body: { action: "INFO_REQUESTED", notes: "Please upload the itemised garage invoice and photos of the removed parts." },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.decisionId, null);
  const d = await as.adjuster(`/api/claims/${state.claimId}`);
  assert.equal(d.body.claim.claimStatus, "AWAITING_INFO");
});

test("17 approval is still blocked while the request is unanswered", async () => {
  const r = await as.adjuster(`/api/claims/${state.claimId}/review`, { method: "POST", body: { action: "APPROVED", notes: "Approving before the answer." } });
  assert.equal(r.status, 422);
  assert.match(r.body.error, /not answered/);
});

test("18 another policyholder cannot answer the request", async () => {
  const r = await as.otherHolder(`/api/claims/${state.claimId}/responses`, { method: "POST", body: { body: "I am not the claimant." } });
  assert.equal(r.status, 404);
});

test("19 the claimant answers once; the claim returns to UNDER_REVIEW; a second answer is refused", async () => {
  const ok = await as.holder(`/api/claims/${state.claimId}/responses`, { method: "POST", body: { body: "Itemised invoice and photos of the removed parts attached." } });
  assert.equal(ok.status, 201);
  const again = await as.holder(`/api/claims/${state.claimId}/responses`, { method: "POST", body: { body: "Sending it a second time." } });
  assert.equal(again.status, 409);
  const d = await as.adjuster(`/api/claims/${state.claimId}`);
  assert.equal(d.body.claim.claimStatus, "UNDER_REVIEW");
  const notes = await as.adjuster("/api/notifications");
  assert.ok(notes.body.notifications.some((n) => n.type === "INFO_RECEIVED" && n.claimId === state.claimId), "adjuster notified");
});

test("20 approval now succeeds; the decision is final", async () => {
  const ok = await as.adjuster(`/api/claims/${state.claimId}/review`, { method: "POST", body: { action: "APPROVED", notes: "Invoice verified against the photos." } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.decisionId);
  const again = await as.adjuster(`/api/claims/${state.claimId}/review`, { method: "POST", body: { action: "REJECTED", notes: "Trying to change the decision." } });
  assert.equal(again.status, 409);
  const d = await as.holder(`/api/claims/${state.claimId}`);
  assert.equal(d.body.claim.decisionStatus, "APPROVED");
});

// ---------------------------------------------------------------- notifications (FR-19, AC-13)
test("21 policyholder reads and dismisses own notifications; another user cannot touch them", async () => {
  const list = await as.holder("/api/notifications");
  assert.equal(list.status, 200);
  const approved = list.body.notifications.find((n) => n.type === "CLAIM_APPROVED" && n.claimId === state.claimId);
  assert.ok(approved, "approval notification present");
  assert.equal(approved.readAt, null);

  assert.equal((await as.otherHolder(`/api/notifications/${approved.notificationId}`, { method: "PATCH", body: { action: "dismiss" } })).status, 404);

  const read = await as.holder(`/api/notifications/${approved.notificationId}`, { method: "PATCH", body: { action: "read" } });
  assert.equal(read.status, 200);
  assert.ok(read.body.readAt);
  const dismissed = await as.holder(`/api/notifications/${approved.notificationId}`, { method: "PATCH", body: { action: "dismiss" } });
  assert.equal(dismissed.status, 200);
  assert.ok(dismissed.body.dismissedAt);

  const inbox = await as.holder("/api/notifications");
  assert.ok(!inbox.body.notifications.some((n) => n.notificationId === approved.notificationId), "hidden from inbox");
  const all = await as.holder("/api/notifications?all=1");
  assert.ok(all.body.notifications.some((n) => n.notificationId === approved.notificationId), "kept as history");
});

// ---------------------------------------------------------------- admin (FR-11/17)
test("22 admin issues a policy; duplicate number and non-policyholder holder are refused", async () => {
  const body = { holderId: "a3000000-0000-0000-0000-000000000003", policyNumber: "POL-2026-9101", effectiveDate: "2026-11-01", expiryDate: "2027-11-01" };
  assert.equal((await as.admin("/api/admin/policies", { method: "POST", body })).status, 201);
  assert.equal((await as.admin("/api/admin/policies", { method: "POST", body })).status, 409);
  const adj = await as.admin("/api/admin/policies", { method: "POST", body: { ...body, policyNumber: "POL-2026-9102", holderId: "a2000000-0000-0000-0000-000000000001" } });
  assert.equal(adj.status, 422);
});

test("23 deactivating a user revokes their live session; reactivation restores sign-in", async () => {
  const kavitha = await signIn("holder.kavitha@example.com", PW.POLICYHOLDER);
  assert.equal((await kavitha("/api/auth/me")).status, 200);
  const id = "a3000000-0000-0000-0000-000000000003";
  assert.equal((await as.admin(`/api/admin/users/${id}`, { method: "PATCH", body: { isActive: false } })).status, 200);
  assert.equal((await kavitha("/api/auth/me")).status, 401);
  assert.equal((await as.admin(`/api/admin/users/${id}`, { method: "PATCH", body: { isActive: true } })).status, 200);
  assert.equal((await as.admin("/api/admin/users/a1000000-0000-0000-0000-000000000001", { method: "PATCH", body: { isActive: false } })).status, 409);
});
