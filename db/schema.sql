-- Invoice-to-order worker demo schema. Idempotent.
-- `ws` = demo workspace (one per visitor browser / eval run) so public visitors don't collide.
create extension if not exists pgcrypto;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  job_no text not null unique
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  ws text not null,
  file_name text not null,
  pdf bytea not null,
  status text not null default 'processing', -- processing | needs_info | in_review | duplicate | error | approved | sent_back
  stage text,
  supplier text,
  invoice_no text,
  invoice_no_norm text,
  sidemark text,
  fingerprint text,
  lines_hash text,
  text_method text,
  ocr_confidence int,
  raw_text text,
  extraction jsonb,
  order_id uuid,
  duplicate_of uuid references invoices(id),
  error text,
  timings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- an exact re-send (same supplier + invoice number + lines) is processed once per workspace
create unique index if not exists invoices_fingerprint_uq on invoices (ws, fingerprint) where fingerprint is not null and duplicate_of is null;
create index if not exists invoices_ws_idx on invoices (ws, created_at desc);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  ws text not null,
  order_no text not null,
  customer_id uuid not null references customers(id),
  supplier text not null,
  invoice_no_norm text not null,
  status text not null default 'draft', -- draft | needs_info | in_review | approved | sent_back | blocked
  review_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ws, supplier, invoice_no_norm),
  unique (ws, order_no)
);

create table if not exists order_lines (
  id uuid primary key default gen_random_uuid(),
  ws text not null,
  order_id uuid not null references orders(id) on delete cascade,
  line_key text not null,
  line_no int not null,
  status text not null, -- complete | needs_info
  room text,
  product_type text,
  sku text,
  product_name text,
  width numeric(7,4),
  height numeric(7,4),
  mount text,
  lift text,
  control_side text,
  fabric_code text,
  colour_code text,
  valance text,
  motor_code text,
  remote_code text,
  provenance jsonb not null default '{}'::jsonb, -- field -> {source: invoice|salesperson, by, at, invoice_value}
  verified_ok boolean not null default false,
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (ws, line_key)
);

create table if not exists invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references invoices(id) on delete cascade,
  line_no int not null,
  line_key text not null,
  extracted jsonb not null,
  normalized jsonb not null,
  pre_issues jsonb not null default '[]'::jsonb,
  issues jsonb not null default '[]'::jsonb,
  unique (invoice_id, line_no)
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  ws text not null,
  invoice_id uuid not null references invoices(id) on delete cascade,
  order_line_id uuid references order_lines(id) on delete cascade,
  line_key text not null,
  line_no int not null,
  field text not null,
  kind text not null,
  attempt int not null default 1,
  text text not null,
  status text not null default 'open', -- open | answered | superseded | escalated
  created_at timestamptz not null default now(),
  -- the same question is never asked twice about the same line
  unique (ws, line_key, field, text)
);

create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  ws text not null,
  question_id uuid not null references questions(id) on delete cascade,
  order_line_id uuid references order_lines(id) on delete cascade,
  line_key text not null,
  field text not null,
  answer_text text not null,
  value jsonb, -- interpreted value (null = could not interpret)
  interpreted_by text not null, -- rules | model
  answered_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists tool_calls (
  id bigserial primary key,
  ws text not null,
  invoice_id uuid references invoices(id) on delete cascade,
  stage text not null,
  tool text not null,
  input jsonb not null,
  output jsonb,
  ok boolean not null,
  ms int,
  created_at timestamptz not null default now()
);

create table if not exists verifications (
  id bigserial primary key,
  ws text not null,
  invoice_id uuid references invoices(id) on delete cascade,
  order_line_id uuid references order_lines(id) on delete cascade,
  intended jsonb not null,
  saved jsonb not null,
  mismatches jsonb not null,
  ok boolean not null,
  created_at timestamptz not null default now()
);

create table if not exists events (
  id bigserial primary key,
  ws text not null,
  invoice_id uuid references invoices(id) on delete cascade,
  order_id uuid,
  kind text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists events_invoice_idx on events (invoice_id, id);
