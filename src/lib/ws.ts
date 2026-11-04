import "server-only";
import { cookies } from "next/headers";

export const WS_COOKIE = "iow_ws";
/** Demo workspace id for this browser (set by src/proxy.ts). */
export async function currentWs() {
  const c = (await cookies()).get(WS_COOKIE)?.value;
  return c && /^w-[0-9a-f-]{36}$/.test(c) ? c : null;
}
