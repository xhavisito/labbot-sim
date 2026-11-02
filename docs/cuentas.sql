-- Cuentas de LabBot Sim (docs/cuentas.md §4). Ejecutar una vez en el editor SQL de Supabase.
create table if not exists public.user_data (
  user_id    uuid not null references auth.users on delete cascade,
  key        text not null check (char_length(key) <= 64),
  value      jsonb not null check (pg_column_size(value) <= 262144),  -- 256 KB por documento
  version    int  not null default 1,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_data enable row level security;
drop policy if exists "solo lo mio" on public.user_data;
create policy "solo lo mio" on public.user_data
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
