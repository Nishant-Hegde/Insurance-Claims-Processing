// Captures ClaimGuard screenshots for the README with headless Chromium (Playwright).
//
// Prerequisites: PostgreSQL with the demo data, the embedding service and the Next.js
// server running. Playwright is a dev dependency of backend/ (npx playwright install chromium).
//
//   node scripts/screenshots.mjs                      # BASE_URL defaults to http://127.0.0.1:3000
//   BASE_URL=http://127.0.0.1:3100 node scripts/screenshots.mjs
//
// Output: docs/screenshots/NN-name.png (1440x900 viewport, full page).
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "backend", "package.json"));
const { chromium } = require("playwright");

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const OUT = path.join(here, "..", "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

const ACCOUNTS = {
  holder: ["holder.ananya@example.com", "POLICYHOLDER!Test2026"],
  adjuster: ["adjuster.arjun@claimguard.internal", "CLAIMS_ADJUSTER!Test2026"],
  admin: ["admin.priya@claimguard.internal", "ADMIN!Test2026"],
};

const browser = await chromium.launch({ headless: true });
const shots = [];

async function shot(page, name) {
  await page.waitForLoadState("networkidle");
  // Hide the Next.js development-mode indicator; it is not part of the app.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  shots.push(name);
  console.log("saved", path.relative(path.join(here, ".."), file));
}

/** A fresh browser context per role, signed in through the real login form. */
async function signedIn(role) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill('input[type="email"]', ACCOUNTS[role][0]);
  await page.fill('input[type="password"]', ACCOUNTS[role][1]);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/login")), page.click('button[type="submit"]')]);
  return { context, page };
}

try {
  // ---- Sign-in page
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${BASE}/login`);
    await shot(page, "01-login");
    await context.close();
  }

  // ---- Policyholder
  {
    const { context, page } = await signedIn("holder");
    await shot(page, "02-policyholder-my-claims");

    await page.goto(`${BASE}/my-claims/new`);
    await page.fill('input[type="date"]', "2026-10-20");
    await page.fill('input[type="number"]', "184500");
    await page.fill("textarea", "Minor collision damaged my front bumper and one headlight. The insurer approved that estimate, but the garage later billed a new radiator, both airbags and an engine mount as well.");
    await shot(page, "03-policyholder-submit-claim");

    // Claim with the richest timeline: the most recent decided one.
    const claims = await (await page.request.get(`${BASE}/api/claims`)).json();
    const target = claims.claims.find((c) => c.status === "Approved" || c.status === "Rejected") ?? claims.claims[0];
    await page.goto(`${BASE}/my-claims/${target.claimId}`);
    await shot(page, "04-policyholder-claim-timeline");

    await page.goto(`${BASE}/notifications?show=all`);
    await shot(page, "05-policyholder-notifications");
    await context.close();
  }

  // ---- Claims adjuster
  {
    const { context, page } = await signedIn("adjuster");
    await shot(page, "06-adjuster-dashboard");

    await page.goto(`${BASE}/adjuster/queue?q=${encodeURIComponent("fire or hospital or windshield")}&sort=relevance`);
    await shot(page, "07-adjuster-queue-search");

    // A HIGH-risk claim with matches and review history (submitted by the API tests / demo).
    const claims = await (await page.request.get(`${BASE}/api/claims`)).json();
    const high = claims.claims.find((c) => c.risk === "High" && c.type.startsWith("Minor collision")) ?? claims.claims.find((c) => c.risk === "High");
    await page.goto(`${BASE}/adjuster/claims/${high.claimId}`);
    await shot(page, "08-adjuster-claim-evidence");

    await page.goto(`${BASE}/adjuster/claims/d1000000-0000-0000-0000-000000000003`);
    await shot(page, "09-adjuster-claim-awaiting-info");

    await page.goto(`${BASE}/similar`);
    await page.click("text=Use an example");
    await page.click("text=Find similar cases");
    await page.waitForSelector("text=nearest active cases");
    await shot(page, "10-similarity-search");
    await context.close();
  }

  // ---- Admin
  {
    const { context, page } = await signedIn("admin");
    for (const [route, name] of [
      ["/admin", "11-admin-reports"],
      ["/admin/reference-cases", "12-admin-reference-cases"],
      ["/admin/audit", "13-admin-audit-log"],
      ["/admin/policies", "14-admin-policies"],
      ["/admin/users", "15-admin-users"],
    ]) {
      await page.goto(`${BASE}${route}`);
      if (route === "/admin/reference-cases") await page.waitForSelector("text=Matches");
      await shot(page, name);
    }
    await context.close();
  }
  console.log(`done: ${shots.length} screenshots in docs/screenshots/`);
} finally {
  await browser.close();
}
