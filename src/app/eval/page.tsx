import type { Metadata } from "next";
import results from "../../../data/eval/results.json";
import baselineJson from "../../../data/eval/baseline.json";

export const metadata: Metadata = { title: "Eval · invoice → order worker" };

type Baseline = {
  summary: null | {
    final_order_field_accuracy: number;
    final_fields: { ok: number; total: number };
    false_writes: number;
    invalid_lines_written: number;
    invoices_with_defects: number;
    defect_invoices_fully_correct: number;
    model: string;
  };
  invoices: { id: string; ok: number; total: number; false_writes: number; invalid_lines_written: number }[];
};

export default function EvalPage() {
  const s = results.summary;
  const b = (baselineJson as Baseline).summary;
  const bRows = (baselineJson as Baseline).invoices;
  const cards = [
    { k: "Extraction field accuracy", v: `${s.extraction_field_accuracy}%`, d: `${s.extraction_fields.ok}/${s.extraction_fields.total} fields read correctly, before any answers` },
    { k: "Final order accuracy", v: `${s.final_order_field_accuracy}%`, d: `${s.final_fields.ok}/${s.final_fields.total} fields on the saved orders match ground truth` },
    { k: "False writes", v: String(s.false_writes), d: `wrong values saved to an order, across ${s.writes} verified writes`, good: s.false_writes === 0 },
    { k: "Invalid options caught", v: `${s.invalid_options_caught}/${s.invalid_options_expected}`, d: "deliberate supplier mistakes flagged and kept off the order" },
    { k: "Duplicates prevented", v: `${s.duplicates_prevented}/${s.duplicates_sent}`, d: `re-sent invoice → no new order (${s.orders_created} orders for ${s.unique_invoices} invoices)` },
    { k: "Orders needing questions", v: `${s.orders_needing_questions}/${s.unique_invoices}`, d: `${s.questions_asked} questions asked (${s.questions_expected} planned + ${s.unplanned_questions} from OCR'd scans), ${s.repeated_questions} repeated` },
    { k: "Read-back checks", v: `${s.readback_checks}`, d: `${s.readback_mismatches} mismatches · every write read back before hand-off` },
    { k: "Handed to office", v: `${s.orders_handed_to_review}/${s.unique_invoices}`, d: `${s.errors.length} stopped · OCR used on ${s.ocr_used}/${s.scanned_invoices} scans` },
  ];
  return (
    <div className="space-y-6">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-accent uppercase tracking-wide">Evaluation</p>
        <h1 className="text-3xl font-semibold tracking-tight">Measured, not promised</h1>
        <p className="text-muted mt-2 leading-relaxed">
          All 25 invoices (3 suppliers, 6 layouts, 2 scans, 5 with invalid options, 1 re-sent duplicate) run through the same worker that powers this app, against a ground-truth file per invoice. A simulated salesperson answers the worker&apos;s questions from the ground truth. Model: <span className="kbd">{s.model}</span>. Run {new Date(s.run_at).toUTCString().replace(" GMT", " UTC")}.
        </p>
      </div>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="eval-cards">
        {cards.map((c) => (
          <div key={c.k} className="card p-4">
            <div className="text-xs text-muted">{c.k}</div>
            <div className={`text-3xl font-semibold tracking-tight mt-1 ${c.good ? "text-ok" : ""}`}>{c.v}</div>
            <div className="text-xs text-muted mt-1 leading-snug">{c.d}</div>
          </div>
        ))}
      </section>

      <section className="card p-4 sm:p-5">
        <h2 className="font-semibold text-lg">Two ways to build the worker</h2>
        <p className="text-sm text-muted mt-1 mb-4">Same model, same invoices, same product docs. The only difference is the architecture around the model.</p>
        <div data-testid="comparison" className="text-sm">
          <div className="grid grid-cols-2 gap-3 pb-2 border-b border-line text-xs">
            <div className="font-semibold text-bad">“Agent improvises”<span className="block font-normal text-muted">one prompt fills every field and writes</span></div>
            <div className="font-semibold text-accent">This worker<span className="block font-normal text-muted">schema + validation + tools + read-back</span></div>
          </div>
          {[
            ["Final order field accuracy", b ? `${b.final_order_field_accuracy}%` : "—", `${s.final_order_field_accuracy}%`],
            ["Wrong values written to orders", b ? String(b.false_writes) : "—", String(s.false_writes)],
            ["Lines saved with an invalid option combo", b ? String(b.invalid_lines_written) : "—", String(s.invalid_writes)],
            ["Missing / invalid / ambiguous options", b ? `${b.defect_invoices_fully_correct}/${b.invoices_with_defects} invoices right, by guessing` : "—", `${s.issues_caught}/${s.issues_expected} flagged and asked`],
            ["Questions to salespeople", "0: it guesses instead", `${s.questions_asked}, one at a time, ${s.repeated_questions} repeated`],
            ["Re-sent invoice", "new order every time (no idempotency key)", `${s.duplicates_prevented}/${s.duplicates_sent} detected, order untouched`],
            ["Proof the write landed as intended", "none", `${s.readback_checks} read-backs; a mismatch blocks hand-off`],
          ].map(([label, base, ours]) => (
            <div key={label} className="py-2.5 border-b border-line last:border-0">
              <div className="text-xs text-muted mb-1">{label}</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="font-medium">{base}</div>
                <div className="font-semibold">{ours}</div>
              </div>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-4 mt-5 text-sm leading-relaxed">
          <div className="rounded-xl bg-bad-soft/60 p-4">
            <h3 className="font-semibold mb-1">Why “improve the agent” stays inconsistent</h3>
            <p className="text-muted">
              When one prompt both reads the invoice and decides the order, every gap gets filled with a plausible guess. A missing control side becomes “right”, an option the lift doesn&apos;t support gets quietly swapped, a re-sent invoice becomes a second order. Its mistakes look exactly like correct work, so the office can&apos;t tell which orders to trust. Better prompting moves the error rate around. It doesn&apos;t give you a guarantee.
            </p>
          </div>
          <div className="rounded-xl bg-accent-soft/70 p-4">
            <h3 className="font-semibold mb-1">Why this design is reliable</h3>
            <ul className="text-muted space-y-1 list-disc pl-4">
              <li><b className="text-ink">Strict schema:</b> the model only transcribes into typed fields, and copies sizes as text.</li>
              <li><b className="text-ink">Deterministic code</b> parses fractions exactly and checks every option, combo and size limit against the supplier rules. It never invents a fix.</li>
              <li><b className="text-ink">Evidence check:</b> a value the model reports must appear on that invoice line, or it isn&apos;t used.</li>
              <li><b className="text-ink">Tools only:</b> the model calls the app&apos;s own functions, which carry guards (right customer, right invoice, idempotent keys).</li>
              <li><b className="text-ink">Read-back:</b> every saved line is re-read and compared. Any mismatch blocks hand-off.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="card p-4 sm:p-5">
        <h2 className="font-semibold text-lg mb-3">Per invoice</h2>
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm min-w-[720px]" data-testid="per-invoice">
            <thead>
              <tr className="text-left text-xs text-faint border-b border-line">
                <th className="py-2 px-4 sm:pl-0 font-medium">Invoice</th><th className="py-2 pr-3 font-medium">Layout</th><th className="py-2 pr-3 font-medium">Extraction</th><th className="py-2 pr-3 font-medium">Flags raised</th><th className="py-2 pr-3 font-medium">Qs</th><th className="py-2 pr-3 font-medium">Final</th><th className="py-2 pr-3 font-medium">Improvised</th><th className="py-2 pr-4 sm:pr-0 font-medium text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {results.invoices.map((r) => {
                const row = r as typeof r & { extraction?: { ok: number; total: number }; final?: { ok: number; total: number }; raised_issues?: string[]; duplicate_detected?: boolean };
                const br = bRows.find((x) => x.id === r.id);
                return (
                  <tr key={r.id} className="border-b border-line last:border-0 align-top">
                    <td className="py-2 px-4 sm:pl-0 kbd font-semibold">{r.id}</td>
                    <td className="py-2 pr-3 text-muted">{r.layout}{r.scanned ? " · scan" : ""}</td>
                    <td className="py-2 pr-3">{row.extraction ? `${row.extraction.ok}/${row.extraction.total}` : "—"}</td>
                    <td className="py-2 pr-3 text-[13px] text-muted">{row.duplicate_of ? (row.duplicate_detected ? "duplicate detected" : "MISSED duplicate") : row.raised_issues?.length ? row.raised_issues.join(", ") : "none"}</td>
                    <td className="py-2 pr-3">{r.questions}</td>
                    <td className="py-2 pr-3">{row.final ? `${row.final.ok}/${row.final.total}` : "—"}</td>
                    <td className="py-2 pr-3">{br ? <span className={br.false_writes ? "text-bad" : ""}>{br.ok}/{br.total}{br.false_writes ? ` · ${br.false_writes} wrong` : ""}</span> : "—"}</td>
                    <td className="py-2 pr-4 sm:pr-0 text-right text-muted whitespace-nowrap">{(r.ms / 1000).toFixed(1)}s</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card p-4 sm:p-5 text-sm text-muted leading-relaxed space-y-2">
        <h2 className="font-semibold text-ink text-lg">Method</h2>
        <p><b className="text-ink">Extraction accuracy</b> compares each of 13 fields per line (room, product, SKU, width, height, mount, lift, control side, fabric, colour, valance, motor, remote) after deterministic normalisation with what is actually printed on the invoice. A field correctly left empty (missing on the invoice) counts as correct.</p>
        <p><b className="text-ink">False write</b> = any non-empty value ever saved to an order line (checked on every read-back snapshot, not just the final state) that differs from the ground truth, plus any saved line that fails the product rules. Empty fields waiting for an answer are not writes.</p>
        <p><b className="text-ink">Baseline</b> = the same model given the same invoice text and product docs, told to fill every field with its best judgment, scored on the same final ground truth. Wrong non-empty values count as false writes, because that approach writes what it decides.</p>
        <p>Timing: first pass {s.timing.first_pass_wall_s}s for all invoices at concurrency {s.timing.concurrency}; average {s.timing.avg_extract_s}s extraction and {s.timing.avg_act_s}s for the tool loop per invoice. Model cost for the full run ≈ ${s.est_cost_usd}. Reproduce with <span className="kbd">npm run eval -- --baseline</span>.</p>
      </section>
    </div>
  );
}
