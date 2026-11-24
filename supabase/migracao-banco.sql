-- Migração: edição de despesas, exclusão de viagens encerradas pelo financeiro e banco do técnico.
-- Rode uma vez em bancos criados com a versão anterior do schema.sql (é idempotente).
-- Banco do técnico: sobra deixada no banco (acerto.tipo = 'banco') menos o que já foi
-- usado como adiantamento em viagens (adiantamento.banco). Só o próprio técnico e o financeiro enxergam.
create or replace function public.cv_banco(p_tec uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when auth.uid() = p_tec or public.cv_is_fin() then
    coalesce(sum(case when acerto->>'tipo' = 'banco' then (acerto->>'valor')::numeric else 0 end), 0)
    - coalesce(sum(coalesce((adiantamento->>'banco')::numeric, 0)), 0)
  else 0 end
  from public.cv_viagens where tecnico_id = p_tec
$$;

-- técnico não pode alterar dono, acerto financeiro nem o crédito do banco
create or replace function public.cv_guard_viagem() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.cv_is_fin() then
    new.tecnico_id := old.tecnico_id;
    new.acerto := old.acerto;
    new.adiantamento := jsonb_set(coalesce(new.adiantamento, '{}'::jsonb), '{banco}',
                                  coalesce(old.adiantamento->'banco', '0'::jsonb));
  end if;
  return new;
end $$;
drop trigger if exists cv_guard_viagem on public.cv_viagens;
create trigger cv_guard_viagem before update on public.cv_viagens
  for each row execute function public.cv_guard_viagem();

-- ao criar a viagem, o servidor soma o saldo do banco ao adiantamento (ignora o valor enviado)
create or replace function public.cv_viagem_banco() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.adiantamento := jsonb_set(coalesce(new.adiantamento, '{}'::jsonb), '{banco}',
                                to_jsonb(greatest(0, public.cv_banco(new.tecnico_id))));
  return new;
end $$;
drop trigger if exists cv_viagem_banco on public.cv_viagens;
create trigger cv_viagem_banco before insert on public.cv_viagens
  for each row execute function public.cv_viagem_banco();

drop policy if exists cv_viagens_del on public.cv_viagens;
create policy cv_viagens_del on public.cv_viagens for delete to authenticated
  using (public.cv_papel() is not null and
         ((tecnico_id = auth.uid() and status = 'em_viagem') or public.cv_is_fin()));

drop policy if exists cv_despesas_upd on public.cv_despesas;
create policy cv_despesas_upd on public.cv_despesas for update to authenticated
  using (exists (select 1 from public.cv_viagens v where v.id = viagem_id
        and ((v.tecnico_id = auth.uid() and v.status in ('em_viagem','correcao'))
             or (public.cv_is_fin() and v.status <> 'encerrada'))))
  with check (exists (select 1 from public.cv_viagens v where v.id = viagem_id
        and ((v.tecnico_id = auth.uid() and v.status in ('em_viagem','correcao'))
             or (public.cv_is_fin() and v.status <> 'encerrada'))));

drop policy if exists cv_files_ins on storage.objects;
create policy cv_files_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'cv-comprovantes' and exists (
    select 1 from public.cv_viagens v where v.id::text = (storage.foldername(name))[1]
      and ((v.tecnico_id = auth.uid() and v.status in ('em_viagem','correcao'))
           or (public.cv_is_fin() and v.status <> 'encerrada'))));
