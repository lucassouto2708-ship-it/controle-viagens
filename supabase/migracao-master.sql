-- Migração: papel master (admin), e-mail no perfil e gestão de equipe só pelo master.
-- Rode uma vez em bancos criados com a versão anterior do schema.sql.
alter table public.cv_perfis add column if not exists email text;
alter table public.cv_perfis drop constraint if exists cv_perfis_papel_check;
alter table public.cv_perfis add constraint cv_perfis_papel_check check (papel in ('tecnico','financeiro','admin'));

create or replace function public.cv_is_fin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.cv_papel() in ('financeiro','admin'), false)
$$;
create or replace function public.cv_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.cv_papel() = 'admin', false)
$$;

drop policy if exists cv_perfis_ins on public.cv_perfis;
drop policy if exists cv_perfis_upd on public.cv_perfis;
create policy cv_perfis_ins on public.cv_perfis for insert to authenticated
  with check (public.cv_is_admin());
create policy cv_perfis_upd on public.cv_perfis for update to authenticated
  using (public.cv_is_admin()) with check (public.cv_is_admin());

-- Lucas vira master
update public.cv_perfis set papel = 'admin', email = 'lucassouto2708@gmail.com'
where id = 'd86db4c1-2b71-4074-ad41-d2e7d083cf81';
