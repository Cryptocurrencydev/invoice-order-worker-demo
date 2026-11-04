# Timelog — invoice-order-worker-demo

All times WAT (UTC+1), 2026-11-04.

| Phase | Start | End | Duration | Notes |
|---|---|---|---|---|
| 0. Brief, tooling check, key handoff | 19:14 | 19:19 | 5m | Anthropic key supplied instead of OpenAI → worker uses Claude (Opus 5.5) |
| 1. Scaffold (Next.js 16, TS, pg, SDK, unpdf, tesseract.js) | 19:19 | 19:22 | 3m | |
| 2. Fictional catalog + 3 supplier docs + 25 invoice PDFs + ground truth | 19:22 | 19:29 | 7m | 3 layouts × 2 variants, 2 scans, 1 re-send; generated deterministically |
| 3. Worker core (text/OCR, extraction schema, validation, fingerprint, tools, read-back, questions) | 19:29 | 19:34 | 5m | |
| 4. Unit + tool-call tests (mocked model) | 19:34 | 19:37 | 3m | 63 passing; found + fixed multi-word abbreviation bug |
| 5. Real-model eval harness + first full run (25 invoices) | 19:37 | 19:45 | 8m | 99.6% extraction, 0 false writes, 5/5 invalid caught; fixed SKU-answer product-type bug |
| 6. UI (inbox/upload, invoice view + chat, order, office review diff, /eval) | 19:45 | 19:51 | 6m | screenshot pass at 390px + desktop, fixes for mobile order list and eval comparison |
| 7. Playwright e2e (mock model, 390px + desktop, console-error guard) | 19:51 | 19:54 | 3m | 10/10 passing |
| 8. Final eval (worker + "agent improvises" baseline), README, Vercel/Neon/GitHub setup | 19:53 | 20:02 | 9m | worker 100% final / 0 false writes; baseline 99.0% / 9 wrong values written. Baseline schema enum-constrained for a fair comparison |
