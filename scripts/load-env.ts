import { config } from "dotenv";
// .env.local holds secrets (never printed); shell env wins over files.
config({ path: [".env.local", ".env"], quiet: true });
