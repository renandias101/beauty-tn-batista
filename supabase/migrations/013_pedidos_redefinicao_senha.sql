-- "Esqueci a senha" na tela de entrada (pedido de 04/10/2026).
-- O login usa e-mail interno (.invalid), que não recebe mensagens: a pessoa não redefine a senha sozinha.
-- O pedido vira um aviso para a administração, que define a nova senha pelo fluxo já existente
-- (função gerenciar-usuarios) e informa a pessoa por um canal seguro.
-- Depende apenas de perfis e private.exigir_papel (migrações 001–003); independe da 011 e da 012.

create table public.pedidos_redefinicao_senha (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users (id) on delete cascade,
  solicitado_em timestamptz not null default now(),
  encerrado_em timestamptz,
  encerrado_por uuid references auth.users (id) on delete set null,
  resolucao text check (resolucao in ('senha_redefinida', 'descartado')),
  constraint pedidos_senha_encerramento check ((encerrado_em is null) = (resolucao is null))
);

-- No máximo um pedido em aberto por conta: repetir o pedido não gera novos avisos.
create unique index pedidos_senha_um_aberto on public.pedidos_redefinicao_senha (usuario_id) where encerrado_em is null;

-- Sem acesso direto: leitura e gravação somente pelas funções abaixo.
revoke all on table public.pedidos_redefinicao_senha from public, anon, authenticated;
alter table public.pedidos_redefinicao_senha enable row level security;

-- Chamado sem login. A resposta é sempre a mesma, exista a conta ou não, para a tela não revelar quais
-- usuários existem. Contas desconhecidas ou desativadas não geram pedido.
create function public.solicitar_redefinicao_senha(p_usuario text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_login text := lower(btrim(coalesce(p_usuario, '')));
  v_usuario_id uuid;
begin
  if v_login = '' or char_length(v_login) > 254 then return; end if;
  -- Mesma conversão de src/lib/acesso.ts (emailDeAcesso) e da função gerenciar-usuarios.
  if position('@' in v_login) = 0 then v_login := v_login || '@usuarios.beautytn.invalid'; end if;

  select u.id into v_usuario_id
  from auth.users u
  join public.perfis pf on pf.usuario_id = u.id
  where lower(u.email) = v_login and pf.ativo;
  if v_usuario_id is null then return; end if;

  insert into public.pedidos_redefinicao_senha (usuario_id) values (v_usuario_id)
  on conflict (usuario_id) where encerrado_em is null do nothing;
end $$;

-- Pedidos em aberto, para o aviso da administração.
create function public.listar_pedidos_senha()
returns table (id uuid, usuario_id uuid, nome text, email text, ativo boolean, solicitado_em timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin']::public.papel_usuario[]);
  return query
  select p.id, p.usuario_id, pf.nome, u.email::text, pf.ativo, p.solicitado_em
  from public.pedidos_redefinicao_senha p
  join public.perfis pf on pf.usuario_id = p.usuario_id
  join auth.users u on u.id = p.usuario_id
  where p.encerrado_em is null
  order by p.solicitado_em, p.id;
end $$;

-- Encerra o pedido em aberto da conta: depois de redefinir a senha ou ao descartar um pedido indevido.
-- Sem pedido em aberto, não faz nada (a senha também pode ser redefinida sem pedido).
create function public.encerrar_pedido_senha(p_usuario_id uuid, p_resolucao text)
returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform private.exigir_papel(array['admin']::public.papel_usuario[]);
  if p_resolucao is null or p_resolucao not in ('senha_redefinida', 'descartado') then
    raise exception 'Resolução inválida.';
  end if;
  update public.pedidos_redefinicao_senha
     set encerrado_em = now(), encerrado_por = (select auth.uid()), resolucao = p_resolucao
   where usuario_id = p_usuario_id and encerrado_em is null;
end $$;

revoke execute on function public.solicitar_redefinicao_senha(text) from public, anon, authenticated;
revoke execute on function public.listar_pedidos_senha() from public, anon, authenticated;
revoke execute on function public.encerrar_pedido_senha(uuid, text) from public, anon, authenticated;
grant execute on function public.solicitar_redefinicao_senha(text) to anon, authenticated;
grant execute on function public.listar_pedidos_senha() to authenticated;
grant execute on function public.encerrar_pedido_senha(uuid, text) to authenticated;
