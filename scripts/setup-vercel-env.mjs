// Copies the Anthropic key from .env.local to Vercel (production + preview) without printing it.
import { config } from "dotenv";
import { spawnSync } from "node:child_process";

const local = config({ path: ".env.local", processEnv: {}, quiet: true }).parsed ?? {};
const key = local.ANTHROPIC_API_KEY;
if (!key) throw new Error("ANTHROPIC_API_KEY not found in .env.local");
for (const env of ["production", "preview"]) {
  spawnSync("vercel", ["env", "rm", "ANTHROPIC_API_KEY", env, "--yes"], { stdio: "ignore" });
  const r = spawnSync("vercel", ["env", "add", "ANTHROPIC_API_KEY", env], { input: key, stdio: ["pipe", "ignore", "pipe"] });
  console.log("ANTHROPIC_API_KEY", env, r.status === 0 ? "set" : `FAILED ${r.stderr}`);
}
