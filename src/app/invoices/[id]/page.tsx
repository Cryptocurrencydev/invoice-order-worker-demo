import { notFound } from "next/navigation";
import { currentWs } from "@/lib/ws";
import { getInvoiceState } from "@/lib/state";
import { InvoiceView } from "@/components/invoice-view";

export const dynamic = "force-dynamic";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const ws = await currentWs();
  const state = ws ? await getInvoiceState(ws, (await params).id) : null;
  if (!state) notFound();
  return <InvoiceView initial={state} />;
}
