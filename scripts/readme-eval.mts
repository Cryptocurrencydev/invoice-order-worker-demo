// Regenerates the eval section of README.md from data/eval/*.json (between the EVAL markers).
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url).pathname;
const r = JSON.parse(readFileSync(root + "data/eval/results.json", "utf8")).summary;
const b = JSON.parse(readFileSync(root + "data/eval/baseline.json", "utf8")).summary;

const md = `<!-- EVAL:START -->
Run ${r.run_at.slice(0, 16).replace("T", " ")} UTC · model \`${r.model}\` · ${r.invoices} invoices (${r.unique_invoices} unique, ${r.lines} window lines) · model cost ≈ $${r.est_cost_usd}

| Metric | Result |
|---|---|
| Extraction field accuracy (13 fields per line, before any answers) | **${r.extraction_field_accuracy}%** (${r.extraction_fields.ok}/${r.extraction_fields.total}) |
| Final order field accuracy (after salesperson answers) | **${r.final_order_field_accuracy}%** (${r.final_fields.ok}/${r.final_fields.total}) |
| **False writes** (a wrong value ever saved to an order) | **${r.false_writes}** across ${r.writes} verified writes |
| Lines saved with an invalid option combination | ${r.invalid_writes} |
| Invalid options caught (planted supplier mistakes) | **${r.invalid_options_caught}/${r.invalid_options_expected}** |
| All planted issues flagged (missing / invalid / ambiguous) | ${r.issues_caught}/${r.issues_expected} |
| Orders that needed questions | ${r.orders_needing_questions}/${r.unique_invoices} (${r.orders_needing_questions_expected} planned, the rest from OCR'd scans) |
| Questions asked | ${r.questions_asked} (${r.questions_expected} planned, ${r.unplanned_questions} extra from OCR'd scans, ${r.repeated_questions} repeated) |
| Duplicates prevented | **${r.duplicates_prevented}/${r.duplicates_sent}** (${r.orders_created} orders for ${r.unique_invoices} invoices) |
| Read-back checks / mismatches | ${r.readback_checks} / ${r.readback_mismatches} |
| Orders handed to office review | ${r.orders_handed_to_review}/${r.unique_invoices} |
| Scanned PDFs read via OCR | ${r.ocr_used}/${r.scanned_invoices} |
| Timing | first pass ${r.timing.first_pass_wall_s}s for all invoices (concurrency ${r.timing.concurrency}); per invoice ≈ ${r.timing.avg_extract_s}s extraction + ${r.timing.avg_act_s}s tool loop |

**Same model, "agent improvises" baseline** (one prompt, fill every field with best judgment, write directly):

| | Agent improvises | This worker |
|---|---|---|
| Final order field accuracy | ${b.final_order_field_accuracy}% | ${r.final_order_field_accuracy}% |
| Wrong values written to orders | **${b.false_writes}** | **${r.false_writes}** |
| Lines saved with an invalid option combo | ${b.invalid_lines_written} | ${r.invalid_writes} |
| Invoices with a planted defect handled right | ${b.defect_invoices_fully_correct}/${b.invoices_with_defects} (by guessing) | ${r.issues_caught}/${r.issues_expected} issues flagged and asked |
| Questions to salespeople | 0 | ${r.questions_asked} |
| Re-sent invoice | new order (no idempotency key) | ${r.duplicates_prevented}/${r.duplicates_sent} detected, order untouched |
<!-- EVAL:END -->`;

const readme = readFileSync(root + "README.md", "utf8");
writeFileSync(root + "README.md", readme.replace(/<!-- EVAL:START -->[\s\S]*<!-- EVAL:END -->/, md));
console.log("README eval section updated");
