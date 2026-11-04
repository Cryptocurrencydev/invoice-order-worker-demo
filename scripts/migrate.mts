import "./load-env.ts";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
const c = new Client({ connectionString: url, ssl: /localhost|\/tmp/.test(url) ? undefined : { rejectUnauthorized: false } });
await c.connect();
await c.query("set client_min_messages = warning");
await c.query(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
await c.end();
console.log("schema applied");
