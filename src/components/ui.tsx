import type { ReactNode } from "react";

const STATUS: Record<string, { label: string; cls: string }> = {
  processing: { label: "Processing", cls: "bg-model-soft text-model" },
  needs_info: { label: "Needs info", cls: "bg-warn-soft text-warn" },
  in_review: { label: "In office review", cls: "bg-accent-soft text-accent" },
  approved: { label: "Approved", cls: "bg-ok-soft text-ok" },
  sent_back: { label: "Sent back", cls: "bg-bad-soft text-bad" },
  duplicate: { label: "Duplicate · no changes", cls: "bg-[#ebe8e1] text-muted" },
  error: { label: "Stopped", cls: "bg-bad-soft text-bad" },
  blocked: { label: "Blocked", cls: "bg-bad-soft text-bad" },
  draft: { label: "Draft", cls: "bg-[#ebe8e1] text-muted" },
};

export function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? { label: status, cls: "bg-[#ebe8e1] text-muted" };
  return (
    <span className={`pill ${s.cls}`} data-status={status}>
      {status === "processing" && <span className="size-1.5 rounded-full bg-current pulse-dot" />}
      {s.label}
    </span>
  );
}

const ISSUE: Record<string, { label: string; cls: string }> = {
  missing: { label: "Missing", cls: "bg-warn-soft text-warn" },
  invalid: { label: "Invalid", cls: "bg-bad-soft text-bad" },
  ambiguous: { label: "Ambiguous", cls: "bg-warn-soft text-warn" },
  unconfirmed: { label: "Not on invoice", cls: "bg-bad-soft text-bad" },
  unreadable: { label: "Unreadable", cls: "bg-warn-soft text-warn" },
};
export function IssueBadge({ kind }: { kind: string }) {
  const s = ISSUE[kind] ?? { label: kind, cls: "bg-[#ebe8e1] text-muted" };
  return <span className={`pill ${s.cls}`}>{s.label}</span>;
}

export function Section({ title, aside, children, className = "" }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      <div className="flex items-center gap-3 mb-3">
        <h2 className="font-semibold text-[15px]">{title}</h2>
        {aside && <div className="ml-auto text-sm text-muted">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export function SourceTag({ source, by }: { source?: string; by?: string }) {
  if (source === "salesperson")
    return <span className="pill bg-model-soft text-model" title={`Answered by ${by}`}>answered · {by?.replace(/ \(.*?\)/, "")}</span>;
  if (source === "invoice") return <span className="pill bg-[#ebe8e1] text-muted">invoice</span>;
  return null;
}
