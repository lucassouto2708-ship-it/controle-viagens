-- Controle de Viagens — schema (idempotente; pode rodar mais de uma vez)
-- Tudo com prefixo cv_ para conviver com outros apps no mesmo projeto Supabase.

create table if not exists public.cv_perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  papel text not null check (papel in ('tecnico','financeiro')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.cv_viagens (
  id uuid primary key default gen_random_uuid(),
  tecnico_id uuid not null references public.cv_perfis(id),
  cidades text[] not null check (array_length(cidades,1) >= 1),
  ida date not null,
  volta date not null check (volta >= ida),
  finalidade text not null default '',
  adiantamento jsonb not null default '{}'::jsonb,
  status text not null default 'em_viagem'
    check (status in ('em_viagem','enviada','correcao','conferida','encerrada')),
  assinatura jsonb,
  acerto jsonb,
  correcao text not null default '',
  criado_em timestamptz not null default now()
);
create index if not exists cv_viagens_tecnico on public.cv_viagens(tecnico_id);

create table if not exists public.cv_despesas (
  id uuid primary key default gen_random_uuid(),
  viagem_id uuid not null references public.cv_viagens(id) on delete cascade,
  data date not null,
  categoria text not null check (categoria in ('alimentacao','abastecimento','hospedagem','outros')),
  valor numeric(12,2) not null check (valor > 0),
  obs text not null default '',
  arquivo_path text,
  arquivo_nome text,
  criado_em timestamptz not null default now()
);
create index if not exists cv_despesas_viagem on public.cv_despesas(viagem_id);

create table if not exists public.cv_historico (
  id bigint generated always as identity primary key,
  viagem_id uuid not null references public.cv_viagens(id) on delete cascade,
  em timestamptz not null default now(),
  por text not null,
  texto text not null
);
create index if not exists cv_historico_viagem on public.cv_historico(viagem_id);

-- ---------- funções auxiliares ----------
create or replace function public.cv_papel() returns text
language sql stable security definer set search_path = public as $$
  select papel from public.cv_perfis where id = auth.uid() and ativo
$$;
create or replace function public.cv_is_fin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.cv_papel() = 'financeiro', false)
$$;

-- técnico não pode alterar dono nem o acerto financeiro
create or replace function public.cv_guard_viagem() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.cv_is_fin() then
    new.tecnico_id := old.tecnico_id;
    new.acerto := old.acerto;
  end if;
  return new;
end $$;
drop trigger if exists cv_guard_viagem on public.cv_viagens;
create trigger cv_guard_viagem before update on public.cv_viagens
  for each row execute function public.cv_guard_viagem();

-- ---------- RLS ----------
alter table public.cv_perfis    enable row level security;
alter table public.cv_viagens   enable row level security;
alter table public.cv_despesas  enable row level security;
alter table public.cv_historico enable row level security;

drop policy if exists cv_perfis_sel on public.cv_perfis;
drop policy if exists cv_perfis_ins on public.cv_perfis;
drop policy if exists cv_perfis_upd on public.cv_perfis;
create policy cv_perfis_sel on public.cv_perfis for select to authenticated
  using (id = auth.uid() or public.cv_is_fin());
create policy cv_perfis_ins on public.cv_perfis for insert to authenticated
  with check (public.cv_is_fin());
create policy cv_perfis_upd on public.cv_perfis for update to authenticated
  using (public.cv_is_fin()) with check (public.cv_is_fin());

drop policy if exists cv_viagens_sel on public.cv_viagens;
drop policy if exists cv_viagens_ins on public.cv_viagens;
drop policy if exists cv_viagens_upd_tec on public.cv_viagens;
drop policy if exists cv_viagens_upd_fin on public.cv_viagens;
drop policy if exists cv_viagens_del on public.cv_viagens;
create policy cv_viagens_sel on public.cv_viagens for select to authenticated
  using (public.cv_papel() is not null and (tecnico_id = auth.uid() or public.cv_is_fin()));
create policy cv_viagens_ins on public.cv_viagens for insert to authenticated
  with check (public.cv_papel() is not null and status = 'em_viagem'
              and (tecnico_id = auth.uid() or public.cv_is_fin()));
create policy cv_viagens_upd_tec on public.cv_viagens for update to authenticated
  using (public.cv_papel() = 'tecnico' and tecnico_id = auth.uid() and status in ('em_viagem','correcao'))
  with check (tecnico_id = auth.uid() and status in ('em_viagem','correcao','enviada'));
create policy cv_viagens_upd_fin on public.cv_viagens for update to authenticated
  using (public.cv_is_fin() and status <> 'encerrada') with check (public.cv_is_fin());
create policy cv_viagens_del on public.cv_viagens for delete to authenticated
  using (public.cv_papel() is not null and
         ((tecnico_id = auth.uid() and status = 'em_viagem') or (public.cv_is_fin() and status <> 'encerrada')));

drop policy if exists cv_despesas_sel on public.cv_despesas;
drop policy if exists cv_despesas_ins on public.cv_despesas;
drop policy if exists cv_despesas_del on public.cv_despesas;
create policy cv_despesas_sel on public.cv_despesas for select to authenticated
  using (exists (select 1 from public.cv_viagens v where v.id = viagem_id));
create policy cv_despesas_ins on public.cv_despesas for insert to authenticated
  with check (exists (select 1 from public.cv_viagens v where v.id = viagem_id
              and v.tecnico_id = auth.uid() and v.status in ('em_viagem','correcao')));
create policy cv_despesas_del on public.cv_despesas for delete to authenticated
  using (exists (select 1 from public.cv_viagens v where v.id = viagem_id
        and v.tecnico_id = auth.uid() and v.status in ('em_viagem','correcao')));

drop policy if exists cv_historico_sel on public.cv_historico;
drop policy if exists cv_historico_ins on public.cv_historico;
create policy cv_historico_sel on public.cv_historico for select to authenticated
  using (exists (select 1 from public.cv_viagens v where v.id = viagem_id));
create policy cv_historico_ins on public.cv_historico for insert to authenticated
  with check (exists (select 1 from public.cv_viagens v where v.id = viagem_id));

-- ---------- Storage (comprovantes) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cv-comprovantes', 'cv-comprovantes', false, 5242880, array['image/*','application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types, public = false;

drop policy if exists cv_files_sel on storage.objects;
drop policy if exists cv_files_ins on storage.objects;
drop policy if exists cv_files_del on storage.objects;
create policy cv_files_sel on storage.objects for select to authenticated
  using (bucket_id = 'cv-comprovantes' and exists (
    select 1 from public.cv_viagens v where v.id::text = (storage.foldername(name))[1]));
create policy cv_files_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'cv-comprovantes' and exists (
    select 1 from public.cv_viagens v where v.id::text = (storage.foldername(name))[1]
      and v.tecnico_id = auth.uid() and v.status in ('em_viagem','correcao')));
create policy cv_files_del on storage.objects for delete to authenticated
  using (bucket_id = 'cv-comprovantes' and exists (
    select 1 from public.cv_viagens v where v.id::text = (storage.foldername(name))[1]
      and (v.tecnico_id = auth.uid() or public.cv_is_fin())));
