// Usage: node scripts/shots.mjs <baseUrl> <outdir> [flow]
// Drives the upload → questions → order → review flow with screenshots at 390px and desktop.
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
const [base, out, sample = "INV-04"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const [name, vp] of [["m", { width: 390, height: 844 }], ["d", { width: 1280, height: 860 }]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: name === "m" ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + "/");
  await page.screenshot({ path: `${out}/${name}-home.png`, fullPage: true });
  await page.getByTestId(`sample-${sample}`).click();
  await page.waitForURL(/\/invoices\//);
  await page.locator('[data-status="needs_info"],[data-status="in_review"],[data-status="error"],[data-status="duplicate"]').first().waitFor({ timeout: 120000 });
  await page.screenshot({ path: `${out}/${name}-invoice.png`, fullPage: true });
  for (let i = 0; i < 4 && (await page.getByTestId("answer-input").count()); i++) {
    const chip = page.locator('[data-testid="chat"] form button[type="button"]').first();
    if (await chip.count()) await chip.click(); else { await page.getByTestId("answer-input").fill("left"); await page.getByRole("button", { name: "Send" }).click(); }
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => !document.body.innerText.includes("Updating the order"), null, { timeout: 120000 });
  }
  await page.locator('[data-status="in_review"]').first().waitFor({ timeout: 120000 });
  await page.screenshot({ path: `${out}/${name}-answered.png`, fullPage: true });
  await page.getByText("open in office review").click();
  await page.waitForURL(/\/review\//);
  await page.screenshot({ path: `${out}/${name}-review.png`, fullPage: true });
  await page.goto(base + "/eval");
  await page.screenshot({ path: `${out}/${name}-eval.png`, fullPage: true });
  console.log(name, "console errors:", errors.length ? errors : "none");
  await ctx.close();
}
await browser.close();
