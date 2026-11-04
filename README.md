# Invoice → Order AI worker (demo)

A reliable version of the "AI worker" that reads supplier invoices for a custom window covering business (blinds, shades, shutters, drapery), identifies each window treatment and its options, asks the salesperson about anything missing or wrong, writes the customer order, and hands it to office review. The results are measured against ground truth.

**Live:** https://invoice-order-worker-demo.vercel.app · **Eval:** https://invoice-order-worker-demo.vercel.app/eval

Everything is fictional: the dealer (Harbor & Pine Window Studio), the three suppliers (Northfold Shade Co., Bramblewood Blind & Shutter, Lumaris Window Fashions), their product docs, SKUs, customers and invoices. No real manufacturer names or documents.

## The question this demo answers

> Improve the Codex-built agent, or use an LLM API with function calling into the app's own functions?

The second. The difference isn't the model. It's what surrounds the model:

| | "Agent improvises" | This worker |
|---|---|---|
| Reading the invoice | free-form, model decides the order | model fills a **strict JSON schema** per window line and copies sizes as printed |
| Fractions (`34 5/8`, `34-5/8`, `34⅝`, `34.625`) | model converts | **deterministic parser**, exact values |
| Option rules (lift, mount, size limits, fabric/colour, motor/remote) | model "knows" | **deterministic validator** built from the supplier rules, never invents a fix |
| Values that aren't on the invoice | quietly filled in | **evidence check**: value must appear on that invoice line or it's not used |
| Missing / wrong info | guessed | **one clear question at a time** to the salesperson, stored on the order line, never repeated |
| Writing the order | direct writes | **tool calls only** (`find_customer`, `find_order`, `create_order`, `add_or_update_line`, `set_status_for_review`) with guards |
| Re-sent invoice | second order | **invoice fingerprint** (supplier + invoice no. + hash of lines) + unique key per line |
| Did the write land correctly? | unknown | **read-back verification** after every write; a mismatch blocks hand-off |

## Eval

`npm run eval -- --baseline` runs all 25 invoices through the same worker the app uses (real model, local Postgres). A simulated salesperson answers from the ground truth. The same model also runs as an "improvising agent" baseline for comparison. Results are in `data/eval/*.json` and on `/eval`.

<!-- EVAL:START -->
Run 2026-11-04 18:59 UTC · model `claude-opus-5-5` · 25 invoices (24 unique, 80 window lines) · model cost ≈ $3.13

| Metric | Result |
|---|---|
| Extraction field accuracy (13 fields per line, before any answers) | **99.6%** (1036/1040) |
| Final order field accuracy (after salesperson answers) | **100%** (1040/1040) |
| **False writes** (a wrong value ever saved to an order) | **0** across 135 verified writes |
| Lines saved with an invalid option combination | 0 |
| Invalid options caught (planted supplier mistakes) | **5/5** |
| All planted issues flagged (missing / invalid / ambiguous) | 17/17 |
| Orders that needed questions | 17/24 (15 planned, the rest from OCR'd scans) |
| Questions asked | 20 (17 planned, 3 extra from OCR'd scans, 0 repeated) |
| Duplicates prevented | **1/1** (24 orders for 24 invoices) |
| Read-back checks / mismatches | 135 / 0 |
| Orders handed to office review | 24/24 |
| Scanned PDFs read via OCR | 2/2 |
| Timing | first pass 138.2s for all invoices (concurrency 4); per invoice ≈ 8.2s extraction + 12.6s tool loop |

**Same model, "agent improvises" baseline** (one prompt, fill every field with best judgment, write directly):

| | Agent improvises | This worker |
|---|---|---|
| Final order field accuracy | 99% | 100% |
| Wrong values written to orders | **9** | **0** |
| Lines saved with an invalid option combo | 4 | 0 |
| Invoices with a planted defect handled right | 7/15 (by guessing) | 17/17 issues flagged and asked |
| Questions to salespeople | 0 | 20 |
| Re-sent invoice | new order (no idempotency key) | 1/1 detected, order untouched |
<!-- EVAL:END -->

What the improvising agent wrote: a guessed tilt side (right instead of left), a "fixed" colour that silently changed the fabric, a 52 1/4" shutter beyond the 48" max, a height of 0, and placeholder text such as "UNSPECIFIED" and "Not specified on invoice" in order fields. Its 99% accuracy looks good, but those 9 values would have gone straight to the supplier.

**Why the second approach is more reliable:** an improvising agent's mistakes look exactly like correct work. It fills a missing control side with "right", swaps an option the lift doesn't support, and turns a re-sent invoice into a second order. The office can't tell which orders to trust. In this design the model only does what it's good at: reading messy layouts and abbreviations, and choosing which app function to call. Everything that must be exactly right is code: fractions, option rules, evidence, idempotency and verification. When information is missing, the worker asks instead of guessing. False writes are therefore structurally prevented rather than merely less likely.

## Dataset

- `data/suppliers/*.md`: three fictional product reference docs (product lines, lift systems with min/max width and height, mounts, control-side rules, fabrics/colours, valances, motor ↔ remote compatibility, how each supplier abbreviates options on invoices).
- `public/samples/INV-01…25.pdf`: 25 invoices in 6 layouts (tables, packing-list blocks, sentence descriptions; space/hyphen/unicode/decimal fractions). 2 are scanned images (OCR path). 9 have missing or ambiguous options, 5 have an invalid option (lift not offered, colour not in fabric, remote incompatible with motor, inside-mount drapery, shutter wider than max), and INV-25 is a re-sent copy of INV-09.
- `data/ground-truth/*.json`: what's printed, the correct final order, expected issues and the salesperson's answers.
- Regenerate with `npm run data:generate` (seeded, deterministic).

## How the worker runs

1. **Read**: PDF text layer via `unpdf`. If there is no text layer (a scan), OCR the embedded page image with `tesseract.js` (45s timeout), falling back to a verbatim Claude vision transcription. On Vercel, tesseract.js doesn't run reliably in serverless functions, so production sets `OCR_ENGINE=vision`. The local eval uses tesseract. Either way, OCR text then goes through the same extraction, validation and evidence checks.
2. **Extract**: Claude (`claude-opus-5-5`) with structured outputs fills the per-line schema, using the matching supplier doc. Supplier detection is deterministic.
3. **Normalise + validate** (`src/lib/worker/validate.ts`): parse sizes, derive the product from the SKU, evidence-check every value against the line's text, and validate against the catalog. Invalid values are kept off the order and shown in review as "invoice said".
4. **Fingerprint**: an identical re-send is a no-op. The same invoice number with different lines updates the existing order.
5. **Act** (`src/lib/worker/tools.ts`): a tool loop where the model calls the app's functions. The model never supplies field values; `add_or_update_line` takes a `line_key` and writes the validated values. Guards reject the wrong customer (must match the sidemark), the wrong invoice, unknown tools and premature hand-off.
6. **Verify**: every write is read back in a separate query and compared field by field. Any mismatch sets the order to `blocked`.
7. **Ask** (`src/lib/worker/questions.ts`): one question at a time with the valid options. Answers are matched by rules first and by the model only when needed, constrained to the valid options. If an answer can't be used, the question is rephrased once, then escalated to the office. The same question is never asked twice (unique per line + field + text).
8. **Hand-off**: office review page shows each field's source: invoice, or which salesperson answered what, with the invoice value struck through.

## Tests

```bash
npm test                                   # vitest: fractions, validation, fingerprint, tool-call tests with mocked model output (local Postgres iow_test)
npm run build && npx playwright test       # upload → questions → order → review at 390px and desktop, fails on any console error (mock model)
npm run eval -- --baseline                 # real model, writes data/eval/*.json
```

## Run locally

```bash
createdb iow_dev && DATABASE_URL=postgres://localhost/iow_dev npm run db:migrate && DATABASE_URL=postgres://localhost/iow_dev npm run db:seed
cp .env.example .env.local   # add ANTHROPIC_API_KEY (server-side only)
npm run dev
```

Stack: Next.js 16 (TypeScript) on Vercel, Postgres (Neon via Vercel Marketplace), Claude API (structured outputs + strict tool use). Each visitor gets their own demo workspace (cookie), so samples can be re-run.

---

Demo by [DC Tech](https://dctechltd.com)
