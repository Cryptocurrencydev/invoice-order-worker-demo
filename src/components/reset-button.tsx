"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ResetButton() {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  return (
    <button type="button" className={`text-sm px-3 py-2 rounded-md ${armed ? "bg-bad-soft text-bad font-semibold" : "text-muted hover:bg-black/5"}`}
      onClick={async () => {
        if (!armed) return setArmed(true);
        await fetch("/api/workspace", { method: "DELETE" });
        setArmed(false);
        router.refresh();
      }}>
      {armed ? "Confirm: clear my demo data" : "Reset demo"}
    </button>
  );
}
