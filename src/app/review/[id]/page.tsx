import Link from "next/link";
import { notFound } from "next/navigation";
import { currentWs } from "@/lib/ws";
import { getOrder } from "@/lib/state";
import { one } from "@/lib/db";
import { formatInches } from "@/lib/fractions";
import { describeValue } from "@/lib/worker/questions";
import { FIELD_LABEL, LINE_FIELDS, type LineField } from "@/lib/worker/types";
import { StatusPill } from "@/components/ui";
import { ReviewActions } from "@/components/review-actions";

export const dynamic = "force-dynamic";

const SHOW: LineField[] = LINE_FIELDS.filter((f) => f !== "product_type");

export default async function ReviewOrder({ params }: { params: Promise<{ id: string }> }) {
  const ws = await currentWs();
  const o = ws ? await getOrder(ws, (await params).id) : null;
  if (!o) notFound();
  const inv = await one<{ id: string; file_name: string; invoice_no: string }>("select id, file_name, invoice_no from invoices where order_id = $1 and duplicate_of is null order by created_at desc limit 1", [o.id]);
  const answeredCount = o.lines.reduce((a, l) => a + Object.values(l.provenance ?? {}).filter((p) => p.source === "salesperson").length, 0);
  return (
    <div className="space-y-5">
      <header className="card p-4 sm:p-5 flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted"><Link href="/review" className="hover:underline">Review queue</Link> / order</p>
          <h1 className="text-2xl font-semibold tracking-tight"><span className="kbd text-[22px]">{o.order_no}</span> · {o.customer}</h1>
          <p className="text-sm text-muted mt-1">
            Job <span className="kbd">{o.job_no}</span> · {o.lines.length} line{o.lines.length === 1 ? "" : "s"} · {answeredCount} field{answeredCount === 1 ? "" : "s"} answered by sales
            {inv && <> · from <Link href={`/invoices/${inv.id}`} className="text-accent hover:underline">{inv.file_name} ({inv.invoice_no})</Link></>}
          </p>
        </div>
        <div className="ml-auto"><StatusPill status={o.status} /></div>
      </header>

      <div className="flex flex-wrap gap-2 text-xs text-muted items-center">
        <span className="pill bg-[#ebe8e1] text-muted">invoice</span> value taken from the supplier invoice
        <span className="pill bg-model-soft text-model ml-2">answered</span> supplied by a salesperson (invoice value shown struck through)
      </div>

      {o.lines.map((l) => (
        <section key={l.line_no} className="card p-4 sm:p-5" data-testid={`review-line-${l.line_no}`}>
          <div className="flex flex-wrap items-baseline gap-2 mb-2">
            <span className="kbd text-faint">L{l.line_no}</span>
            <h2 className="font-semibold">{l.room}</h2>
            <span className="text-sm text-muted">{l.product_name}</span>
            <span className={`ml-auto text-xs font-semibold ${l.verified_ok ? "text-ok" : "text-bad"}`}>{l.verified_ok ? "✓ read-back verified" : "✗ not verified"}</span>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            {SHOW.map((f) => {
              const p = l.provenance?.[f];
              const val = (l as unknown as Record<string, unknown>)[f];
              if (val == null && !p) return null;
              const shown = f === "width" || f === "height" ? formatInches(val as number) : describeValue(f, val);
              const answered = p?.source === "salesperson";
              return (
                <div key={f} className={`flex items-start gap-3 py-2 border-b border-line ${answered ? "bg-model-soft/40 -mx-2 px-2 rounded" : ""}`} data-testid={answered ? "diff-answered" : undefined}>
                  <dt className="w-24 shrink-0 text-xs text-faint pt-0.5">{FIELD_LABEL[f]}</dt>
                  <dd className="min-w-0 flex-1 text-sm">
                    <span className="font-medium">{shown}</span>
                    {answered && (
                      <span className="block text-xs text-muted mt-0.5">
                        invoice: <s>{p.invoice_value ? (f === "width" || f === "height" ? (Number.isFinite(Number(p.invoice_value)) ? formatInches(Number(p.invoice_value)) : p.invoice_value) : describeValue(f, p.invoice_value)) : "not given"}</s> · answered by <b>{p.by}</b>: “{p.answer}”
                      </span>
                    )}
                  </dd>
                  <span className={`pill shrink-0 ${answered ? "bg-model-soft text-model" : "bg-[#ebe8e1] text-muted"}`}>{answered ? "answered" : "invoice"}</span>
                </div>
              );
            })}
          </dl>
        </section>
      ))}

      {o.status === "in_review" ? (
        <ReviewActions orderId={o.id} />
      ) : (
        <p className="card p-4 text-sm">
          {o.status === "approved" ? "Approved" : o.status === "sent_back" ? "Sent back" : o.status} {o.reviewed_by && <>by <b>{o.reviewed_by}</b></>}
          {o.review_note && <> · “{o.review_note}”</>}
        </p>
      )}
    </div>
  );
}
