"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { InvoiceState } from "@/lib/state";
import { formatInches } from "@/lib/fractions";
import { describeValue } from "@/lib/worker/questions";
import { FIELD_LABEL, type LineField } from "@/lib/worker/types";
import { IssueBadge, Section, SourceTag, StatusPill } from "./ui";

const STAGES = [
  ["reading", "Read"],
  ["extracting", "Extract"],
  ["validating", "Validate"],
  ["writing", "Write + verify"],
  ["asking", "Ask"],
  ["done", "Hand-off"],
] as const;

function stageIndex(s: InvoiceState["invoice"]) {
  if (s.status === "in_review" || s.status === "approved" || s.status === "sent_back" || s.status === "duplicate") return STAGES.length;
  const i = STAGES.findIndex(([k]) => k === s.stage);
  return i < 0 ? 0 : i;
}

export function InvoiceView({ initial }: { initial: InvoiceState }) {
  const [state, setState] = useState(initial);
  const [pending, setPending] = useState(false);
  const inv = state.invoice;
  const busy = inv.status === "processing" || inv.stage === "writing" || pending;

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/invoices/${initial.invoice.id}`, { cache: "no-store" });
    if (r.ok) setState(await r.json());
  }, [initial.invoice.id]);

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(refresh, 1500);
    return () => clearInterval(t);
  }, [busy, refresh]);

  const openQuestion = state.questions.find((q) => q.status === "open");

  return (
    <div className="space-y-5">
      <header className="card p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted"><Link href="/" className="hover:underline">Inbox</Link> / invoice</p>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight break-all">{inv.file_name}</h1>
            <p className="text-sm text-muted mt-1">
              {inv.supplier_name ?? "Identifying supplier…"}
              {inv.invoice_no && <> · <span className="kbd text-ink">{inv.invoice_no}</span></>}
              {inv.sidemark && <> · sidemark <span className="kbd text-ink">{inv.sidemark}</span></>}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noopener" className="text-sm text-accent font-semibold hover:underline">View PDF</a>
            <StatusPill status={inv.status} />
          </div>
        </div>
        <ol className="grid grid-cols-6 gap-1" aria-label="Progress">
          {STAGES.map(([k, label], i) => {
            const at = stageIndex(inv);
            const done = i < at;
            const now = i === at && inv.status !== "error";
            return (
              <li key={k} className="min-w-0">
                <div className={`h-1.5 rounded-full ${done ? "bg-accent" : now ? "bg-accent/40 pulse-dot" : "bg-line"}`} />
                <div className={`mt-1 text-[11px] sm:text-xs truncate ${done || now ? "text-ink" : "text-faint"}`}>{label}</div>
              </li>
            );
          })}
        </ol>
        {inv.text_method === "ocr" && <p className="text-sm text-muted">Scanned PDF: text recovered with OCR ({inv.ocr_confidence}% confidence).</p>}
        {inv.status === "duplicate" && inv.duplicate_of && (
          <p className="rounded-lg bg-[#ebe8e1] p-3 text-sm" data-testid="duplicate-banner">
            <b>Duplicate re-send.</b> Same supplier, invoice number and lines as{" "}
            <Link className="underline" href={`/invoices/${inv.duplicate_of.id}`}>{inv.duplicate_of.file_name}</Link>. The existing order was left untouched.
          </p>
        )}
        {inv.status === "error" && <p role="alert" className="rounded-lg bg-bad-soft text-bad p-3 text-sm"><b>Stopped:</b> {inv.error}</p>}
      </header>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
        <div className="lg:col-start-2 lg:row-start-1 lg:sticky lg:top-20">
          <Chat state={state} openQuestion={openQuestion} onAnswered={refresh} setPending={setPending} />
        </div>
        <div className="space-y-5 lg:col-start-1 lg:row-start-1 min-w-0">
          <Lines state={state} />
          <Order state={state} />
          <Activity state={state} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Lines({ state }: { state: InvoiceState }) {
  if (!state.lines.length)
    return (
      <Section title="Extracted lines">
        <p className="text-sm text-muted">{state.invoice.status === "processing" ? "Reading the invoice…" : state.invoice.status === "duplicate" ? "Not re-extracted into the order: identical to the original." : "No lines."}</p>
      </Section>
    );
  const flagged = state.lines.reduce((a, l) => a + l.invoice_issues.length, 0);
  return (
    <Section title="Extracted lines" aside={`${state.lines.length} line${state.lines.length > 1 ? "s" : ""} · ${flagged ? `${flagged} flagged` : "no issues"}`}>
      <ul className="space-y-3" data-testid="lines">
        {state.lines.map((l) => {
          const v = l.values;
          const ex = l.extracted as { width_text?: string | null; height_text?: string | null };
          return (
            <li key={l.line_key} className="rounded-xl border border-line p-3 fade-in" data-testid={`line-${l.line_no}`}>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="kbd text-faint">L{l.line_no}</span>
                <span className="font-semibold">{v.room ?? <span className="text-warn">room?</span>}</span>
                <span className="text-sm text-muted">{l.product_name ?? "unknown product"}</span>
                <span className="kbd text-muted ml-auto">{v.sku ?? "—"}</span>
              </div>
              <dl className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                <Field label="Size (W × H)">
                  {formatInches(v.width)} × {formatInches(v.height)}
                  {(ex.width_text || ex.height_text) && <span className="block text-xs text-faint kbd">printed “{ex.width_text ?? "—"}” × “{ex.height_text ?? "—"}”</span>}
                </Field>
                <Field label="Mount">{describeValue("mount", v.mount)}</Field>
                <Field label="Lift">{v.product_type === "shutter" ? "n/a (shutter)" : describeValue("lift", v.lift)}</Field>
                <Field label="Control side">{describeValue("control_side", v.control_side)}</Field>
                <Field label="Fabric / colour"><span className="kbd">{v.fabric_code ?? "—"} / {v.colour_code ?? "—"}</span></Field>
                <Field label="Valance">{describeValue("valance", v.valance)}</Field>
                <Field label="Motor / remote"><span className="kbd">{v.motor_code ?? "—"} / {v.remote_code ?? "—"}</span></Field>
              </dl>
              {l.invoice_issues.length > 0 && (
                <ul className="mt-3 space-y-1.5">
                  {l.invoice_issues.map((i) => {
                    const open = l.open_issues.some((o) => o.field === i.field);
                    return (
                      <li key={i.field} className="flex items-start gap-2 text-sm" data-testid="issue">
                        <IssueBadge kind={i.kind} />
                        <span className={open ? "" : "text-muted line-through decoration-muted/40"}>{i.message}</span>
                        {!open && <span className="pill bg-ok-soft text-ok ml-auto">resolved</span>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="truncate-none">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Chat({ state, openQuestion, onAnswered, setPending }: { state: InvoiceState; openQuestion?: InvoiceState["questions"][number]; onAnswered: () => Promise<void>; setPending: (b: boolean) => void }) {
  const [name, setName] = useState("Maya Ortiz (sales)");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state.questions.length) endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [state.questions.length]);

  async function send(answer: string) {
    if (!openQuestion || !answer.trim()) return;
    setSending(true);
    setPending(true);
    setError(null);
    try {
      const r = await fetch(`/api/questions/${openQuestion.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ answer, by: name }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      setText("");
      await onAnswered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setSending(false);
      setPending(false);
    }
  }

  const inv = state.invoice;
  const asked = state.questions.filter((q) => q.status !== "escalated");
  const escalated = state.questions.filter((q) => q.status === "escalated");
  return (
    <section className="card flex flex-col" aria-label="Salesperson chat" data-testid="chat">
      <div className="px-4 pt-4 pb-3 border-b border-line flex items-center gap-2">
        <span className="size-2 rounded-full bg-model" aria-hidden />
        <h2 className="font-semibold text-[15px]">Worker ↔ salesperson</h2>
        <span className="ml-auto text-xs text-muted">{asked.length} question{asked.length === 1 ? "" : "s"}</span>
      </div>
      <div className="p-4 space-y-3 max-h-[52vh] lg:max-h-[56vh] overflow-y-auto">
        {inv.status === "processing" && asked.length === 0 && <p className="text-sm text-muted"><span className="pulse-dot">●</span> Reading and checking the invoice…</p>}
        {inv.status !== "processing" && asked.length === 0 && inv.status !== "duplicate" && inv.status !== "error" && (
          <p className="text-sm text-muted">No questions needed: every line had complete, valid information.</p>
        )}
        {inv.status === "duplicate" && <p className="text-sm text-muted">Nothing to ask: this invoice was already processed.</p>}
        {asked.map((q) => (
          <div key={q.id} className="space-y-2 fade-in" data-testid="question">
            <div className="max-w-[92%] rounded-2xl rounded-tl-sm bg-model-soft px-3.5 py-2.5 text-sm leading-relaxed">
              <div className="text-[11px] font-semibold text-model mb-0.5">Worker · line {q.line_no} · {FIELD_LABEL[q.field as LineField] ?? q.field}</div>
              {q.text}
            </div>
            {q.answer && (
              <div className="ml-auto max-w-[85%] w-fit rounded-2xl rounded-tr-sm bg-accent text-white px-3.5 py-2.5 text-sm" data-testid="answer">
                <div className="text-[11px] font-semibold opacity-80 mb-0.5">{q.answer.by}</div>
                {q.answer.text}
                <div className="text-[11px] opacity-80 mt-1">
                  {q.answer.value == null ? "not usable, will rephrase" : `→ saved ${describeValue(q.field as LineField, q.answer.value)} on line ${q.line_no} (${q.answer.interpreted_by === "rules" ? "matched by rules" : "interpreted by model"})`}
                </div>
              </div>
            )}
          </div>
        ))}
        {escalated.map((q) => (
          <p key={q.id} className="text-sm rounded-lg bg-bad-soft text-bad p-2.5">{q.text}</p>
        ))}
        {inv.stage === "writing" && inv.status === "needs_info" && <p className="text-sm text-muted"><span className="pulse-dot">●</span> Updating the order and verifying…</p>}
        {(inv.status === "in_review" || inv.status === "approved" || inv.status === "sent_back") && asked.length > 0 && (
          <p className="text-sm text-ok font-semibold" data-testid="chat-done">All answered. Order handed to office review.</p>
        )}
        <div ref={endRef} />
      </div>
      {openQuestion && (
        <form className="border-t border-line p-3 space-y-2" onSubmit={(e) => { e.preventDefault(); send(text); }}>
          {openQuestion.options.length > 0 && openQuestion.options.length <= 8 && (
            <div className="flex flex-wrap gap-1.5">
              {openQuestion.options.map((o) => (
                <button key={o.value} type="button" disabled={sending} onClick={() => send(o.label)} className="text-xs px-2.5 py-1.5 min-h-[36px] rounded-full border border-line hover:border-accent hover:text-accent">
                  {o.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <label className="sr-only" htmlFor="answer">Your answer</label>
            <input id="answer" value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer…" autoComplete="off" data-testid="answer-input"
              className="flex-1 min-w-0 rounded-lg border border-line bg-white px-3 py-2.5 text-[16px] sm:text-sm" />
            <button className="btn btn-primary" disabled={sending || !text.trim()}>{sending ? "…" : "Send"}</button>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted">
            Answering as
            <input value={name} onChange={(e) => setName(e.target.value)} className="flex-1 min-w-0 rounded border border-line px-2 py-1 text-[16px] sm:text-xs" aria-label="Your name" />
          </label>
          {error && <p role="alert" className="text-xs text-bad">{error}</p>}
        </form>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
function Order({ state }: { state: InvoiceState }) {
  const o = state.order;
  if (!o) return null;
  return (
    <Section title={<>Customer order <span className="kbd ml-1">{o.order_no}</span></>} aside={<StatusPill status={o.status} />}>
      <p className="text-sm text-muted -mt-1 mb-3">
        {o.customer} · <span className="kbd">{o.job_no}</span>
        {o.status === "in_review" && <> · <Link href={`/review/${o.id}`} className="text-accent font-semibold hover:underline">open in office review →</Link></>}
        {o.review_note && <span className="block mt-1 text-bad">Office: {o.review_note} ({o.reviewed_by})</span>}
      </p>
      <ul className="sm:hidden divide-y divide-line" data-testid="order-lines-mobile">
        {o.lines.map((l) => (
          <li key={l.line_no} className="py-2.5 text-sm">
            <div className="flex items-baseline gap-2">
              <span className="kbd text-faint">L{l.line_no}</span>
              <span className="font-medium">{l.room ?? "—"}</span>
              <span className="ml-auto text-xs font-semibold">{l.status === "complete" ? <span className="text-ok">{l.verified_ok ? "✓ verified" : "✗ mismatch"}</span> : <span className="text-warn">waiting on answer</span>}</span>
            </div>
            <div className="text-muted">{l.product_name} · {formatInches(l.width)} × {formatInches(l.height)}</div>
            <div className="text-[13px]">{[describeValue("mount", l.mount), l.lift && describeValue("lift", l.lift), l.control_side && `${describeValue("control_side", l.control_side)} control`, `${l.fabric_code ?? "?"}/${l.colour_code ?? "?"}`, l.valance && describeValue("valance", l.valance), l.motor_code && `${l.motor_code} + ${l.remote_code ?? "?"}`].filter(Boolean).join(" · ")}</div>
            {Object.entries(l.provenance ?? {}).filter(([, p]) => p.source === "salesperson").map(([f, p]) => <span key={f} className="mt-1 mr-1 inline-block"><SourceTag source={p.source} by={`${p.by} → ${FIELD_LABEL[f as LineField]}`} /></span>)}
          </li>
        ))}
      </ul>
      <div className="hidden sm:block">
        <table className="w-full text-sm" data-testid="order-lines">
          <thead>
            <tr className="text-left text-xs text-faint border-b border-line">
              <th className="py-2 px-4 sm:pl-0 font-medium">Line</th><th className="py-2 pr-3 font-medium">Product</th><th className="py-2 pr-3 font-medium">Size</th><th className="py-2 pr-3 font-medium">Options</th><th className="py-2 pr-4 sm:pr-0 font-medium text-right">Saved</th>
            </tr>
          </thead>
          <tbody>
            {o.lines.map((l) => {
              const answered = Object.entries(l.provenance ?? {}).filter(([, p]) => p.source === "salesperson");
              return (
                <tr key={l.line_no} className="border-b border-line last:border-0 align-top">
                  <td className="py-2.5 px-4 sm:pl-0"><span className="kbd text-faint">L{l.line_no}</span><div className="font-medium">{l.room ?? "—"}</div></td>
                  <td className="py-2.5 pr-3">{l.product_name ?? "—"}<div className="kbd text-xs text-muted">{l.sku}</div></td>
                  <td className="py-2.5 pr-3 whitespace-nowrap">{formatInches(l.width)} × {formatInches(l.height)}</td>
                  <td className="py-2.5 pr-3 text-[13px] leading-snug">
                    {[describeValue("mount", l.mount), l.lift && describeValue("lift", l.lift), l.control_side && `${describeValue("control_side", l.control_side)} control`, `${l.fabric_code ?? "?"}/${l.colour_code ?? "?"}`, l.valance && describeValue("valance", l.valance), l.motor_code && `${l.motor_code} + ${l.remote_code ?? "?"}`].filter(Boolean).join(" · ")}
                    {answered.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{answered.map(([f, p]) => <SourceTag key={f} source={p.source} by={`${p.by} → ${FIELD_LABEL[f as LineField]}`} />)}</div>}
                  </td>
                  <td className="py-2.5 pr-4 sm:pr-0 text-right whitespace-nowrap">
                    {l.status === "complete" ? <span className="text-ok text-xs font-semibold">{l.verified_ok ? "✓ verified" : "✗ mismatch"}</span> : <span className="text-warn text-xs font-semibold">waiting on answer</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
function Activity({ state }: { state: InvoiceState }) {
  if (!state.events.length && !state.tool_calls.length) return null;
  return (
    <Section title="Worker activity" aside={`${state.tool_calls.length} tool call${state.tool_calls.length === 1 ? "" : "s"}`}>
      <ol className="space-y-1.5 text-sm">
        {state.events.map((e, i) => (
          <li key={i} className="flex gap-2"><span className="text-faint kbd text-xs pt-0.5 w-14 shrink-0">{new Date(e.created_at).toLocaleTimeString("en-GB")}</span><span>{e.message}</span></li>
        ))}
      </ol>
      {state.tool_calls.length > 0 && (
        <details className="mt-3 group">
          <summary className="cursor-pointer text-sm font-semibold text-accent select-none">Tool calls (what the model asked the app to do)</summary>
          <ul className="mt-2 space-y-1" data-testid="tool-calls">
            {state.tool_calls.map((t, i) => (
              <li key={i}>
                <details className="rounded-lg border border-line">
                  <summary className="cursor-pointer px-3 py-2 text-sm flex items-center gap-2">
                    <span className={`size-2 rounded-full shrink-0 ${t.ok ? "bg-ok" : "bg-bad"}`} />
                    <span className="kbd">{t.tool}</span>
                    <span className="text-xs text-faint">{t.stage}</span>
                    <span className="ml-auto text-xs text-faint">{t.ms} ms</span>
                  </summary>
                  <pre className="px-3 pb-3 text-[11px] leading-snug overflow-x-auto whitespace-pre-wrap break-all kbd text-muted">{JSON.stringify({ input: t.input, output: t.output }, null, 1)}</pre>
                </details>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
