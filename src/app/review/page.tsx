import Link from "next/link";
import { currentWs } from "@/lib/ws";
import { reviewQueue } from "@/lib/state";
import { StatusPill } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ReviewQueue() {
  const ws = await currentWs();
  const rows = ws ? await reviewQueue(ws) : [];
  const waiting = rows.filter((r) => r.status === "in_review");
  const done = rows.filter((r) => r.status !== "in_review");
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-accent uppercase tracking-wide">Office</p>
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-muted text-sm mt-1">Orders the worker completed and verified. Each shows what came from the invoice and what a salesperson answered.</p>
      </div>
      <section className="card p-4 sm:p-5">
        <h2 className="font-semibold mb-3">Waiting for review <span className="text-muted font-normal">({waiting.length})</span></h2>
        {waiting.length === 0 ? <p className="text-sm text-muted">Nothing waiting. Process an invoice from the <Link href="/" className="text-accent underline">inbox</Link>.</p> : <List rows={waiting} />}
      </section>
      {done.length > 0 && (
        <section className="card p-4 sm:p-5">
          <h2 className="font-semibold mb-3">Reviewed</h2>
          <List rows={done} />
        </section>
      )}
    </div>
  );
}

function List({ rows }: { rows: Awaited<ReturnType<typeof reviewQueue>> }) {
  return (
    <ul className="divide-y divide-line" data-testid="review-list">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/review/${r.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 -mx-2 px-2 rounded-lg hover:bg-black/[.02]">
            <span className="kbd font-semibold">{r.order_no}</span>
            <span>{r.customer} <span className="kbd text-muted text-xs">{r.job_no}</span></span>
            <span className="text-sm text-muted">{r.supplier} · {r.lines} line{r.lines === 1 ? "" : "s"}{r.answered ? ` · ${r.answered} answered by sales` : ""}</span>
            <span className="ml-auto"><StatusPill status={r.status} /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
