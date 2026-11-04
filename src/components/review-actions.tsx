"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ReviewActions({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [by, setBy] = useState("Jordan Lee (office)");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function act(action: "approve" | "send_back") {
    setBusy(true);
    setError(null);
    const r = await fetch(`/api/orders/${orderId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, note, by }) });
    const j = await r.json();
    setBusy(false);
    if (!r.ok) return setError(j.error ?? "failed");
    router.refresh();
  }
  return (
    <section className="card p-4 sm:p-5 space-y-3 sticky bottom-3 shadow-lg shadow-black/5">
      <div className="grid sm:grid-cols-[1fr_220px] gap-2">
        <label className="text-sm">
          <span className="text-xs text-faint">Note (required to send back)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. confirm motor side with client" className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-[16px] sm:text-sm" data-testid="review-note" />
        </label>
        <label className="text-sm">
          <span className="text-xs text-faint">Reviewer</span>
          <input value={by} onChange={(e) => setBy(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2.5 text-[16px] sm:text-sm" />
        </label>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-primary flex-1 sm:flex-none" disabled={busy} onClick={() => act("approve")}>Approve order</button>
        <button className="btn btn-ghost flex-1 sm:flex-none" disabled={busy || !note.trim()} onClick={() => act("send_back")}>Send back</button>
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
    </section>
  );
}
