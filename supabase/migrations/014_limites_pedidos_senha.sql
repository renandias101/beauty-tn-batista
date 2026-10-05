-- Pedidos de nova senha (013), ajustes de 04/10/2026:
-- 1. Depois que a administração DESCARTA um pedido, a mesma conta só gera outro aviso após 30 minutos.
--    Evita que alguém repita pedidos indevidos logo após o descarte. Pedido atendido (senha redefinida) não tem espera.
-- 2. Retenção: pedidos encerrados há mais de 180 dias são apagados (dado mínimo, sem utilidade depois disso),
--    no momento em que a administração encerra um pedido.
-- Mesmas assinaturas e permissões da 013; a resposta para quem pede continua sempre igual.

create or replace function public.solicitar_redefinicao_senha(p_usuario text)
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

  if exists (select 1 from public.pedidos_redefinicao_senha
             where usuario_id = v_usuario_id and resolucao = 'descartado' and encerrado_em > now() - interval '30 minutes') then
    return;
  end if;

  insert into public.pedidos_redefinicao_senha (usuario_id) values (v_usuario_id)
  on conflict (usuario_id) where encerrado_em is null do nothing;
end $$;

create or replace function public.encerrar_pedido_senha(p_usuario_id uuid, p_resolucao text)
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
  delete from public.pedidos_redefinicao_senha where encerrado_em < now() - interval '180 days';
end $$;
