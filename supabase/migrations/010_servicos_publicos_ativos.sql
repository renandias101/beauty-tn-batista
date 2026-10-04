-- Página pública (pedido de 04/10/2026): todos os serviços ativos aparecem. Quando o serviço não tem
-- profissional ativo habilitado, a página informa "Não há profissionais disponíveis para este serviço."
create or replace function public.servicos_publicos()
returns table (id uuid, nome text, duracao_minutos integer, categoria text, descricao text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.nome, s.duracao_minutos, s.categoria, s.descricao
  from public.servicos s
  where s.ativo
  order by s.categoria nulls last, s.nome
$$;
