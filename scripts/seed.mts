import "./load-env.ts";
import { readFileSync } from "node:fs";
import { Client } from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
const c = new Client({ connectionString: url, ssl: /localhost|\/tmp/.test(url) ? undefined : { rejectUnauthorized: false } });
await c.connect();
const customers = JSON.parse(readFileSync(new URL("../data/customers.json", import.meta.url), "utf8")) as { name: string; job_no: string }[];
for (const cu of customers) await c.query("insert into customers (name, job_no) values ($1,$2) on conflict (job_no) do update set name = excluded.name", [cu.name, cu.job_no]);
await c.end();
console.log(`seeded ${customers.length} customers`);
