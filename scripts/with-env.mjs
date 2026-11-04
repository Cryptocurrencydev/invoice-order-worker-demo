// Usage: node scripts/with-env.mjs <envfile> <command...>
// Runs a command with DATABASE_URL taken from a pulled Vercel env file (values never printed).
import { config } from "dotenv";
import { spawnSync } from "node:child_process";
const [file, ...cmd] = process.argv.slice(2);
const parsed = config({ path: file, processEnv: {}, quiet: true }).parsed ?? {};
const env = { ...process.env };
env.DATABASE_URL = parsed.DATABASE_URL_UNPOOLED || parsed.DATABASE_URL;
if (!env.DATABASE_URL) throw new Error(`no DATABASE_URL in ${file}`);
const r = spawnSync(cmd[0], cmd.slice(1), { stdio: "inherit", env });
process.exit(r.status ?? 1);
