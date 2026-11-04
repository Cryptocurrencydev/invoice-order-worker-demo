"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

interface Sample { id: string; file: string; supplier: string; invoice_number: string; scanned: boolean; layout: string; note: string }

export function Uploader({ samples }: { samples: Sample[] }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  async function upload(file: File | Blob, name: string) {
    setError(null);
    setBusy(name);
    try {
      const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (String.fromCharCode(...head) !== "%PDF-") throw new Error("That file is not a PDF.");
      const fd = new FormData();
      fd.append("file", file, name);
      const r = await fetch("/api/invoices", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "upload failed");
      router.push(`/invoices/${j.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
      setBusy(null);
    }
  }

  async function runSample(s: Sample) {
    setBusy(s.file);
    const blob = await (await fetch(`/samples/${s.file}`)).blob();
    await upload(blob, s.file);
  }

  return (
    <div className="card p-4 sm:p-5 space-y-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) upload(f, f.name); }}
        className={`rounded-xl border-2 border-dashed p-5 text-center transition-colors ${drag ? "border-accent bg-accent-soft" : "border-line"}`}
      >
        <p className="font-semibold">Upload a supplier invoice</p>
        <p className="text-sm text-muted mt-1">PDF, text or scanned · up to 8 MB</p>
        <button type="button" className="btn btn-primary mt-3" disabled={!!busy} onClick={() => input.current?.click()}>
          {busy && !samples.some((s) => s.file === busy) ? "Uploading…" : "Choose PDF"}
        </button>
        <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" data-testid="file-input" aria-label="Invoice PDF"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, f.name); }} />
      </div>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div>
        <div className="flex items-baseline gap-2 mb-2">
          <h2 className="font-semibold text-[15px]">Or try a sample</h2>
          <span className="text-xs text-muted">25 fictional invoices from 3 fictional suppliers</span>
        </div>
        <ul className="max-h-[340px] overflow-y-auto -mx-1 pr-1 divide-y divide-line" data-testid="samples">
          {samples.map((s) => (
            <li key={s.id}>
              <button type="button" disabled={!!busy} onClick={() => runSample(s)} data-testid={`sample-${s.id}`}
                className="w-full text-left flex items-center gap-3 px-1 py-2.5 rounded-md hover:bg-black/[.03] min-h-[44px]">
                <span className="kbd font-semibold w-14 shrink-0">{s.id}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm truncate">{s.supplier}</span>
                  <span className={`block text-xs truncate ${s.note.includes("clean") && !s.scanned ? "text-faint" : "text-warn"}`}>{s.note}</span>
                </span>
                <span className="text-xs text-accent font-semibold shrink-0">{busy === s.file ? "Uploading…" : "Run"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
