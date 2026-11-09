// Re-exports the official diagrams from their SVG sources with headless Chromium.
//   docs/ClaimGuard_ER_Diagram_Chen.svg          -> .png (2x) and .pdf
//   docs/ClaimGuard_Relational_Schema_v6.svg     -> .png (2x) and .pdf
// Usage: node scripts/export_diagrams.mjs   (Playwright is a dev dependency of backend/)
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, "..", "backend", "package.json"));
const { chromium } = require("playwright");
const docs = path.join(here, "..", "docs");

const browser = await chromium.launch({ headless: true });
try {
  for (const name of ["ClaimGuard_ER_Diagram_Chen", "ClaimGuard_Relational_Schema_v6"]) {
    const svgPath = path.join(docs, `${name}.svg`);
    const svg = readFileSync(svgPath, "utf8");
    const [, w, h] = svg.match(/<svg[^>]*\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
    const width = Number(w), height = Number(h);

    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
    await page.goto(pathToFileURL(svgPath).href);
    await page.screenshot({ path: path.join(docs, `${name}.png`), clip: { x: 0, y: 0, width, height } });

    // PDF: wrap the SVG in a page of exactly its size so nothing is scaled or cut.
    await page.goto("about:blank"); // setContent needs an HTML document, not the SVG one
    await page.setContent(`<html><head><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0}</style></head><body>${svg}</body></html>`);
    await page.pdf({ path: path.join(docs, `${name}.pdf`), width: `${width}px`, height: `${height}px`, printBackground: true, pageRanges: "1" });
    await page.close();
    console.log(`exported ${name}.png (${width * 2}x${height * 2}) and ${name}.pdf`);
  }
} finally {
  await browser.close();
}
