-- Níveis de acesso (admin, secretaria, profissional) e consulta pública de disponibilidade (visitante sem login).
-- Somente acréscimos: nenhum dado existente é apagado ou substituído.

-- ---------------------------------------------------------------------------
-- Configuração da clínica usada pela consulta pública
-- ---------------------------------------------------------------------------
alter table public.configuracao_clinica
  add column whatsapp_clinica text check (whatsapp_clinica is null or whatsapp_clinica ~ '^[0-9]{10,15}$'),
  add column horizonte_publico_dias integer not null default 30 check (horizonte_publico_dias between 1 and 90),
  add column atualizado_por uuid references auth.users (id) on delete set null;

create trigger configuracao_atualizada_em before update on public.configuracao_clinica
for each row execute function private.tocar_atualizado_em();

-- Remover bloqueio passa a registrar o motivo. Perfis guardam quem alterou (gravações da função de usuários).
alter table public.bloqueios add column motivo_remocao text check (motivo_remocao is null or char_length(motivo_remocao) <= 300);
alter table public.perfis add column atualizado_por uuid references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- Auditoria geral dos cadastros (agendamentos têm histórico próprio). Somente leitura pela aplicação.
-- ---------------------------------------------------------------------------
create table public.auditoria (
  id bigint generated always as identity primary key,
  tabela text not null,
  registro_id text,
  operacao text not null check (operacao in ('insert', 'update', 'delete')),
  usuario_id uuid,
  ocorrido_em timestamptz not null default now(),
  valores_anteriores jsonb,
  valores_novos jsonb
);
create index auditoria_ocorrido_idx on public.auditoria (ocorrido_em desc);
create index auditoria_tabela_idx on public.auditoria (tabela, ocorrido_em desc);
alter table public.auditoria enable row level security;
grant select on public.auditoria to authenticated;
create policy "admin le auditoria" on public.auditoria
  for select to authenticated using ((select private.papel_atual()) = 'admin');

create function private.auditar() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_antes jsonb;
  v_depois jsonb;
  v_registro jsonb;
  v_usuario uuid := (select auth.uid());
begin
  if tg_op in ('UPDATE', 'DELETE') then v_antes := to_jsonb(old); end if;
  if tg_op in ('INSERT', 'UPDATE') then v_depois := to_jsonb(new); end if;
  if tg_op = 'UPDATE' and v_antes = v_depois then return null; end if;
  v_registro := coalesce(v_depois, v_antes);
  -- Gravações feitas pela função de usuários (chave de serviço) informam o autor em atualizado_por.
  if v_usuario is null and v_registro ? 'atualizado_por' then
    v_usuario := nullif(v_registro ->> 'atualizado_por', '')::uuid;
  end if;
  insert into public.auditoria (tabela, registro_id, operacao, usuario_id, valores_anteriores, valores_novos)
  values (
    tg_table_name,
    coalesce(v_registro ->> 'id', v_registro ->> 'usuario_id', concat_ws(':', v_registro ->> 'profissional_id', v_registro ->> 'servico_id')),
    lower(tg_op), v_usuario, v_antes, v_depois
  );
  return null;
end $$;

create trigger auditar_configuracao after insert or update or delete on public.configuracao_clinica for each row execute function private.auditar();
create trigger auditar_perfis after insert or update or delete on public.perfis for each row execute function private.auditar();
create trigger auditar_profissionais after insert or update or delete on public.profissionais for each row execute function private.auditar();
create trigger auditar_servicos after insert or update or delete on public.servicos for each row execute function private.auditar();
create trigger auditar_habilitacoes after insert or update or delete on public.profissional_servicos for each row execute function private.auditar();
create trigger auditar_disponibilidades after insert or update or delete on public.disponibilidades for each row execute function private.auditar();
create trigger auditar_excecoes after insert or update or delete on public.excecoes_disponibilidade for each row execute function private.auditar();
create trigger auditar_bloqueios after insert or update or delete on public.bloqueios for each row execute function private.auditar();
create trigger auditar_clientes after insert or update or delete on public.clientes for each row execute function private.auditar();

create function public.listar_auditoria(p_limite integer default 100, p_tabela text default null)
returns table (id bigint, tabela text, registro_id text, operacao text, usuario_nome text, ocorrido_em timestamptz, valores_anteriores jsonb, valores_novos jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin']::public.papel_usuario[]);
  return query
  select a.id, a.tabela, a.registro_id, a.operacao, coalesce(pf.nome, 'Sistema'), a.ocorrido_em, a.valores_anteriores, a.valores_novos
  from public.auditoria a
  left join public.perfis pf on pf.usuario_id = a.usuario_id
  where p_tabela is null or a.tabela = p_tabela
  order by a.ocorrido_em desc, a.id desc
  limit least(greatest(coalesce(p_limite, 100), 1), 500);
end $$;

-- ---------------------------------------------------------------------------
-- Perfis e vínculo com o cadastro de profissional
-- ---------------------------------------------------------------------------
-- O vínculo vale para qualquer perfil ativo (ex.: administradora que também atende), sem conceder acesso extra:
-- as permissões continuam vindo somente de perfis.papel.
create or replace function private.profissional_atual() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.id
  from public.profissionais p
  join public.perfis pf on pf.usuario_id = p.usuario_id
  where p.usuario_id = (select auth.uid()) and pf.ativo
$$;

-- Nunca deixa a clínica sem administrador ativo, mesmo com alterações simultâneas.
create function private.preservar_ultimo_admin() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.papel = 'admin' and old.ativo and (tg_op = 'DELETE' or new.papel <> 'admin' or not new.ativo) then
    perform pg_advisory_xact_lock(hashtextextended('perfis:ultimo-admin', 0));
    if not exists (select 1 from public.perfis where papel = 'admin' and ativo and usuario_id <> old.usuario_id) then
      raise exception 'Não é possível desativar ou remover o último administrador ativo.';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger perfis_preservar_ultimo_admin before update or delete on public.perfis
for each row execute function private.preservar_ultimo_admin();

-- ---------------------------------------------------------------------------
-- Secretária: histórico dos agendamentos e bloqueios pontuais
-- ---------------------------------------------------------------------------
create or replace function public.historico_do_agendamento(p_id uuid)
returns table (id bigint, acao text, usuario_nome text, ocorrido_em timestamptz, motivo text, valores_anteriores jsonb, valores_novos jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  return query
  select h.id, h.acao, coalesce(pf.nome, 'Usuário removido'), h.ocorrido_em, h.motivo, h.valores_anteriores, h.valores_novos
  from public.historico_agendamentos h
  left join public.perfis pf on pf.usuario_id = h.usuario_id
  where h.agendamento_id = p_id
  order by h.ocorrido_em, h.id;
end $$;

create or replace function public.criar_bloqueio(
  p_profissional_id uuid, p_data_inicio date, p_data_fim date,
  p_hora_inicio time, p_hora_fim time, p_motivo text, p_dia_inteiro boolean default false
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_fuso text := private.fuso();
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_periodos tstzrange[];
  v_ids uuid[];
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if not exists (select 1 from public.profissionais where id = p_profissional_id) then
    raise exception 'Profissional não encontrado.';
  end if;
  if char_length(v_motivo) < 3 or char_length(v_motivo) > 200 then
    raise exception 'Informe o motivo do bloqueio (de 3 a 200 caracteres).';
  end if;
  if p_data_inicio is null or p_data_fim is null or p_data_fim < p_data_inicio then
    raise exception 'Informe um período de datas válido.';
  end if;
  if p_data_fim - p_data_inicio > 366 then
    raise exception 'O bloqueio pode abranger no máximo um ano.';
  end if;

  if coalesce(p_dia_inteiro, false) then
    v_periodos := array[tstzrange(p_data_inicio::timestamp at time zone v_fuso, (p_data_fim + 1)::timestamp at time zone v_fuso, '[)')];
  else
    if p_hora_inicio is null or p_hora_fim is null or p_hora_inicio >= p_hora_fim then
      raise exception 'O horário final deve ser posterior ao inicial.';
    end if;
    select array_agg(tstzrange((d::date + p_hora_inicio) at time zone v_fuso, (d::date + p_hora_fim) at time zone v_fuso, '[)') order by d)
    into v_periodos
    from generate_series(p_data_inicio::timestamp, p_data_fim::timestamp, interval '1 day') d;
  end if;

  perform private.travar_profissional(p_profissional_id);

  -- RN08: nunca cancela reservas automaticamente; exige resolução explícita.
  select array_agg(a.id order by a.inicio) into v_ids
  from public.agendamentos a
  where a.profissional_id = p_profissional_id
    and private.ocupa_horario(a.status)
    and exists (select 1 from unnest(v_periodos) per where per && tstzrange(a.inicio, a.fim, '[)'));
  if v_ids is not null then
    raise exception 'O bloqueio atinge % agendamento(s): %. Reagende ou cancele essas reservas antes de bloquear.',
      cardinality(v_ids), private.descrever_agendamentos(v_ids);
  end if;

  begin
    insert into public.bloqueios (profissional_id, inicio, fim, motivo, criado_por)
    select p_profissional_id, lower(per), upper(per), v_motivo, (select auth.uid()) from unnest(v_periodos) per;
  exception
    when exclusion_violation then
      raise exception 'Já existe um bloqueio sobreposto nesse período.';
  end;
  return cardinality(v_periodos);
end $$;

-- Remoção com motivo, responsável e data; o registro permanece.
create function public.remover_bloqueio(p_id uuid, p_motivo text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_motivo text := btrim(coalesce(p_motivo, ''));
begin
  perform private.exigir_papel(array['admin', 'secretaria']::public.papel_usuario[]);
  if char_length(v_motivo) < 3 or char_length(v_motivo) > 300 then
    raise exception 'Informe o motivo da remoção do bloqueio (de 3 a 300 caracteres).';
  end if;
  update public.bloqueios
  set removido_em = now(), removido_por = (select auth.uid()), motivo_remocao = v_motivo
  where id = p_id and removido_em is null;
  if not found then
    raise exception 'Bloqueio não encontrado.';
  end if;
end $$;

-- A versão sem motivo deixa de ser chamável pela aplicação.
revoke execute on function public.remover_bloqueio(uuid) from authenticated;

-- ---------------------------------------------------------------------------
-- Consulta pública (visitante sem login). Retorna somente o necessário à disponibilidade.
-- ---------------------------------------------------------------------------
create function public.configuracao_publica()
returns table (whatsapp text, horizonte_dias integer, fuso_horario text)
language sql stable security definer set search_path = '' as $$
  select whatsapp_clinica, horizonte_publico_dias, fuso_horario from public.configuracao_clinica limit 1
$$;

create function public.servicos_publicos()
returns table (id uuid, nome text, duracao_minutos integer, categoria text, descricao text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.nome, s.duracao_minutos, s.categoria, s.descricao
  from public.servicos s
  where s.ativo
    and exists (
      select 1 from public.profissional_servicos ps
      join public.profissionais p on p.id = ps.profissional_id
      where ps.servico_id = s.id and p.ativo
    )
  order by s.categoria nulls last, s.nome
$$;

create function public.profissionais_publicos(p_servico_id uuid)
returns table (id uuid, nome text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.nome
  from public.profissionais p
  join public.profissional_servicos ps on ps.profissional_id = p.id
  join public.servicos s on s.id = ps.servico_id
  where ps.servico_id = p_servico_id and p.ativo and s.ativo
  order by p.nome
$$;

-- Horários em que o serviço inteiro cabe, encaixados um após o outro a partir do início de cada
-- faixa de trabalho, pulando para o fim de cada ocupação (bloqueio ou reserva que ocupa horário).
-- O passo é a própria duração do serviço (decisão de 04/10/2026). Nunca retorna horários passados.
create function public.horarios_disponiveis(p_servico_id uuid, p_profissional_id uuid, p_data_inicio date, p_data_fim date)
returns table (dia date, horario text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_fuso text := private.fuso();
  v_hoje date := (now() at time zone v_fuso)::date;
  v_horizonte integer;
  v_duracao integer;
  v_data date;
  v_ate date;
  v_faixa record;
  v_cursor timestamp;
  v_fim_faixa timestamp;
  v_ini timestamptz;
  v_fim timestamptz;
  v_ocupado_ate timestamptz;
begin
  select horizonte_publico_dias into v_horizonte from public.configuracao_clinica limit 1;
  select s.duracao_minutos into v_duracao from public.servicos s where s.id = p_servico_id and s.ativo;
  if v_duracao is null then
    raise exception 'Serviço indisponível para consulta.';
  end if;
  if not exists (
    select 1 from public.profissionais p
    join public.profissional_servicos ps on ps.profissional_id = p.id
    where p.id = p_profissional_id and p.ativo and ps.servico_id = p_servico_id
  ) then
    raise exception 'Profissional indisponível para este serviço.';
  end if;
  if p_data_inicio is null or p_data_fim is null or p_data_fim < p_data_inicio then
    raise exception 'Período inválido.';
  end if;
  if p_data_fim - p_data_inicio > 62 then
    raise exception 'Consulte no máximo 62 dias por vez.';
  end if;

  v_data := greatest(p_data_inicio, v_hoje);
  v_ate := least(p_data_fim, v_hoje + v_horizonte);
  while v_data <= v_ate loop
    for v_faixa in
      select d.hora_inicio as ini, d.hora_fim as fim from public.disponibilidades d
      where d.profissional_id = p_profissional_id and d.removido_em is null and d.dia_semana = extract(dow from v_data)::smallint
      union all
      select e.hora_inicio, e.hora_fim from public.excecoes_disponibilidade e
      where e.profissional_id = p_profissional_id and e.removido_em is null and e.data = v_data
      order by 1
    loop
      v_cursor := v_data + v_faixa.ini;
      v_fim_faixa := v_data + v_faixa.fim;
      while v_cursor + make_interval(mins => v_duracao) <= v_fim_faixa loop
        v_ini := v_cursor at time zone v_fuso;
        v_fim := v_ini + make_interval(mins => v_duracao);
        select max(ocupacao.fim) into v_ocupado_ate from (
          select b.fim from public.bloqueios b
          where b.profissional_id = p_profissional_id and b.removido_em is null
            and tstzrange(b.inicio, b.fim, '[)') && tstzrange(v_ini, v_fim, '[)')
          union all
          select a.fim from public.agendamentos a
          where a.profissional_id = p_profissional_id and private.ocupa_horario(a.status)
            and tstzrange(a.inicio, a.fim, '[)') && tstzrange(v_ini, v_fim, '[)')
        ) ocupacao;
        if v_ocupado_ate is not null then
          v_cursor := v_ocupado_ate at time zone v_fuso;
        else
          if v_ini > now() then
            dia := v_data;
            horario := to_char(v_cursor, 'HH24:MI');
            return next;
          end if;
          v_cursor := v_cursor + make_interval(mins => v_duracao);
        end if;
      end loop;
    end loop;
    v_data := v_data + 1;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------------
-- Configuração: administração altera WhatsApp e horizonte; o fuso só muda pelo painel do banco.
create policy "admin altera configuracao" on public.configuracao_clinica
  for update to authenticated
  using ((select private.papel_atual()) = 'admin') with check ((select private.papel_atual()) = 'admin');
grant update (whatsapp_clinica, horizonte_publico_dias, atualizado_por) on public.configuracao_clinica to authenticated;

grant execute on function public.listar_auditoria(integer, text) to authenticated;
grant execute on function public.remover_bloqueio(uuid, text) to authenticated;
grant execute on function public.configuracao_publica() to anon, authenticated;
grant execute on function public.servicos_publicos() to anon, authenticated;
grant execute on function public.profissionais_publicos(uuid) to anon, authenticated;
grant execute on function public.horarios_disponiveis(uuid, uuid, date, date) to anon, authenticated;
