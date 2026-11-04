import path from "node:path";
import { expect, test } from "./fixtures";

const sample = (id: string) => path.join(process.cwd(), "public/samples", `${id}.pdf`);
const status = (page: import("@playwright/test").Page, s: string) => page.locator(`header [data-status="${s}"]`).first();

test("upload → question → answer → order → office review → approve", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Supplier invoices in/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "DC Tech" })).toHaveAttribute("href", "https://dctechltd.com");
  await page.getByTestId("file-input").setInputFiles(sample("INV-04"));
  await page.waitForURL(/\/invoices\//);
  await expect(status(page, "needs_info")).toBeVisible();

  // extracted lines with the flagged issue
  await expect(page.getByTestId("lines").locator("li[data-testid^=line-]")).toHaveCount(3);
  await expect(page.getByTestId("issue").first()).toContainText("Continuous loop is not offered");

  // one question at a time, answered from a quick-reply option
  const chat = page.getByTestId("chat");
  await expect(chat.getByTestId("question")).toHaveCount(1);
  await expect(chat.getByTestId("question")).toContainText("Which lift system");
  await chat.getByRole("button", { name: "Cordless" }).click();
  await expect(chat.getByTestId("answer")).toContainText("saved Cordless on line 1");
  await expect(status(page, "in_review")).toBeVisible();
  await expect(chat.getByTestId("chat-done")).toBeVisible();
  await expect(page.getByText("waiting on answer")).toHaveCount(0);

  // office review: diff shows who answered what
  await page.getByRole("link", { name: /open in office review/ }).click();
  await page.waitForURL(/\/review\//);
  const answered = page.getByTestId("diff-answered");
  await expect(answered).toHaveCount(1);
  await expect(answered).toContainText("Cordless");
  await expect(answered).toContainText("Maya Ortiz (sales)");
  await expect(answered.locator("s")).toHaveText("Continuous loop");
  await page.getByRole("button", { name: "Approve order" }).click();
  await expect(page.locator('[data-status="approved"]')).toBeVisible();
  await page.goto("/review");
  await expect(page.getByTestId("review-list")).toContainText("Graham Whitlock");
});

test("free-text answer, then send back with a note", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("sample-INV-02").click();
  await page.waitForURL(/\/invoices\//);
  await expect(status(page, "needs_info")).toBeVisible();
  await page.getByTestId("answer-input").fill("left hand tilt please");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(status(page, "in_review")).toBeVisible();
  await page.getByRole("link", { name: /open in office review/ }).click();
  await page.getByTestId("review-note").fill("Client wants to confirm the Den colour");
  await page.getByRole("button", { name: "Send back" }).click();
  await expect(page.locator('[data-status="sent_back"]')).toBeVisible();
  await expect(page.getByText("Client wants to confirm the Den colour")).toBeVisible();
});

test("clean invoice goes straight to review; re-sent copy is detected as a duplicate", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("sample-INV-09").click();
  await page.waitForURL(/\/invoices\//);
  await expect(status(page, "in_review")).toBeVisible();
  await expect(page.getByText("No questions needed")).toBeVisible();
  await page.goto("/");
  await page.getByTestId("sample-INV-25").click();
  await page.waitForURL(/\/invoices\//);
  await expect(status(page, "duplicate")).toBeVisible();
  await expect(page.getByTestId("duplicate-banner")).toContainText("INV-09.pdf");
  await page.goto("/review");
  await expect(page.getByTestId("review-list").locator("li")).toHaveCount(1);
});

test("eval page shows the measured results", async ({ page }) => {
  await page.goto("/eval");
  await expect(page.getByRole("heading", { name: "Measured, not promised" })).toBeVisible();
  await expect(page.getByTestId("eval-cards")).toContainText("False writes");
  await expect(page.getByTestId("comparison")).toContainText("Agent improvises");
  await expect(page.getByTestId("per-invoice").locator("tbody tr")).toHaveCount(25);
});

test("rejects non-PDF uploads", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles({ name: "notes.pdf", mimeType: "application/pdf", buffer: Buffer.from("hello") });
  await expect(page.getByText("That file is not a PDF.")).toBeVisible();
});
