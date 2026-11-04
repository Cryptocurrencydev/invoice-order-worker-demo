// Unit tests never call the real model: every model response is mocked.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://localhost/iow_test";
delete process.env.ANTHROPIC_API_KEY;
export {};
