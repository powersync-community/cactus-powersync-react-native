-- Demo schema for cactus-app
-- Execute in Supabase SQL editor.

create table if not exists demo_documents (
  id text primary key,
  created_at timestamptz not null default now(),
  title text not null,
  content text not null,
  embedding_json text
);

create table if not exists demo_queries (
  id text primary key,
  created_at timestamptz not null default now(),
  question text not null,
  answer text not null,
  context_doc_ids_json text,
  cloud_handoff integer not null default 0,
  total_tokens integer not null default 0,
  total_time_ms integer not null default 0
);

create table if not exists demo_transcripts (
  id text primary key,
  created_at timestamptz not null default now(),
  audio_path text not null,
  transcript text not null,
  cloud_handoff integer not null default 0,
  total_tokens integer not null default 0,
  total_time_ms integer not null default 0
);

create table if not exists demo_files (
  id text primary key,
  created_at timestamptz not null default now(),
  label text not null,
  attachment_id text,
  mime_type text,
  size_bytes integer not null default 0,
  file_extension text
);

create table if not exists demo_cost_events (
  id text primary key,
  created_at timestamptz not null default now(),
  feature text not null,
  total_tokens integer not null default 0,
  total_time_ms integer not null default 0,
  cloud_handoff integer not null default 0,
  cloud_cost_usd real not null default 0,
  device_cost_usd real not null default 0,
  saved_usd real not null default 0
);

create table if not exists demo_operations (
  id text primary key,
  created_at timestamptz not null default now(),
  note text not null,
  offline_mode integer not null default 0
);

-- Demo-only permissive RLS policies.
alter table demo_documents enable row level security;
alter table demo_queries enable row level security;
alter table demo_transcripts enable row level security;
alter table demo_files enable row level security;
alter table demo_cost_events enable row level security;
alter table demo_operations enable row level security;

drop policy if exists demo_documents_all on demo_documents;
drop policy if exists demo_queries_all on demo_queries;
drop policy if exists demo_transcripts_all on demo_transcripts;
drop policy if exists demo_files_all on demo_files;
drop policy if exists demo_cost_events_all on demo_cost_events;
drop policy if exists demo_operations_all on demo_operations;

create policy demo_documents_all on demo_documents for all to authenticated using (true) with check (true);
create policy demo_queries_all on demo_queries for all to authenticated using (true) with check (true);
create policy demo_transcripts_all on demo_transcripts for all to authenticated using (true) with check (true);
create policy demo_files_all on demo_files for all to authenticated using (true) with check (true);
create policy demo_cost_events_all on demo_cost_events for all to authenticated using (true) with check (true);
create policy demo_operations_all on demo_operations for all to authenticated using (true) with check (true);
