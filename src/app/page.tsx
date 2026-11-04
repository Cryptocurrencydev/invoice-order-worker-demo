import Link from "next/link";
import samples from "../../data/samples.json";
import { currentWs } from "@/lib/ws";
import { listInvoices } from "@/lib/state";
import { StatusPill } from "@/components/ui";
import { Uploader } from "@/components/uploader";
import { ResetButton } from "@/components/reset-button";
import results from "../../data/eval/results.json";

export const dynamic = "force-dynamic";

const STEPS = [
  ["Read", "PDF text layer, OCR fallback for scans"],
  ["Extract", "Claude fills a strict JSON schema per window line"],
  ["Validate", "code checks every option, combo and size against the supplier rules"],
  ["Ask", "one clear question at a time when info is missing or wrong"],
  ["Act", "tool calls only: find, create, add/update lines, hand off"],
  ["Verify", "every write is read back and compared before hand-off"],
];

export default async function Home() {
  const ws = await currentWs();
  const invoices = ws ? await listInvoices(ws) : [];
  const s = results.summary;
  return (
    <div className="space-y-6">
      <section className="grid lg:grid-cols-[1.2fr_1fr] gap-6 items-start">
        <div className="space-y-4">
          <p className="text-sm font-semibold text-accent tracking-wide uppercase">Invoice → order AI worker</p>
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">Supplier invoices in. Verified customer orders out.</h1>
          <p className="text-muted text-[15px] leading-relaxed max-w-xl">
            Upload a blinds, shades or shutters invoice. The worker reads it, checks every option against the supplier&apos;s product rules, asks the salesperson only what&apos;s missing, writes the order through the app&apos;s own functions, and proves each write before the office sees it.
          </p>
          <ol className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-sm">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="card p-3">
                <div className="font-semibold"><span className="text-faint kbd mr-1">{i + 1}</span>{t}</div>
                <div className="text-muted text-[13px] leading-snug mt-0.5">{d}</div>
              </li>
            ))}
          </ol>
          <Link href="/eval" className="card p-3 flex flex-wrap gap-x-5 gap-y-1 items-center text-sm hover:border-accent transition-colors">
            <span className="font-semibold text-accent">Measured on 25 invoices →</span>
            <span><b>{s.extraction_field_accuracy}%</b> field accuracy</span>
            <span><b>{s.invalid_options_caught}/{s.invalid_options_expected}</b> invalid options caught</span>
            <span><b>{s.duplicates_prevented}/{s.duplicates_sent}</b> duplicate prevented</span>
            <span><b>{s.false_writes}</b> false writes</span>
          </Link>
        </div>
        <Uploader samples={samples} />
      </section>

      <section className="card p-4 sm:p-5">
        <div className="flex items-center gap-3 mb-3">
          <h2 className="font-semibold">Your invoices</h2>
          <span className="text-sm text-muted">this browser&apos;s demo workspace</span>
          <div className="ml-auto">{invoices.length > 0 && <ResetButton />}</div>
        </div>
        {invoices.length === 0 ? (
          <p className="text-muted text-sm">Nothing yet. Upload a PDF or pick a sample invoice above.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="invoice-list">
            {invoices.map((i) => (
              <li key={i.id}>
                <Link href={`/invoices/${i.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 hover:bg-black/[.02] -mx-2 px-2 rounded-lg">
                  <span className="font-medium kbd">{i.file_name}</span>
                  <span className="text-sm text-muted">{i.supplier ?? "…"} {i.invoice_no ?? ""}</span>
                  {i.order_no && <span className="text-sm text-muted">→ {i.order_no}</span>}
                  <span className="ml-auto flex items-center gap-2">
                    {i.open_q > 0 && <span className="pill bg-warn-soft text-warn">question waiting</span>}
                    <StatusPill status={i.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
