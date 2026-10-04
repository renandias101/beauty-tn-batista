# Operação da agenda — regras e ativação (migrações 011 e 012)

## Regras implementadas no servidor

| Tema | Regra |
| --- | --- |
| Ocupação do período | Ocupam o período previsto (atendimento + preparação): aguardando confirmação, presença confirmada, cliente presente, em atendimento e **concluído**. Concluir antes do horário não libera o restante. **Cancelado** e **faltou** liberam o período (na falta a cliente não veio; o tempo restante pode receber um encaixe). A regra não depende da hora atual. |
| Conflito da cliente | A mesma cliente não fica em dois atendimentos sobrepostos, mesmo com profissionais diferentes. Exceção só para a administração, com justificativa obrigatória, registrada no histórico. A autorização vem do perfil gravado no banco, não de parâmetro do navegador. Restrição de exclusão no banco protege gravações simultâneas. |
| Horário passado | Criar e reagendar para data/hora que já passou (fuso da clínica) é recusado pela API. Consultar histórico e atualizar atendimentos existentes continua permitido. |
| Duração por profissional | `profissional_servicos.duracao_minutos` (opcional). Sem valor, vale a duração padrão do serviço. A reserva grava a duração usada. Reagendar com o mesmo profissional mantém a duração gravada; com outro, usa a duração efetiva dele. |
| Preparação | `servicos.preparacao_minutos` (padrão 0). Atendimento + preparação precisam caber na jornada (sem invadir intervalos nem passar do expediente) e não podem cruzar bloqueios ou outras reservas. A cliente vê só a duração do atendimento. A reserva grava a preparação usada. |
| Recursos | Opcionais. Serviço sem recurso não exige cadastro. Com recurso, a reserva grava os recursos e o servidor confere a capacidade (usos simultâneos) no período ocupado. Desativar ou reduzir capacidade é recusado enquanto houver reservas futuras afetadas. |
| Versão | Cada agendamento tem `versao`. Alterações enviam a versão vista; se outra pessoa alterou antes, a gravação é recusada e a tela avisa, mantendo o que o usuário preencheu. |
| Correção de status | Somente administração, com justificativa. Registra status anterior, novo, responsável e data (`status_corrigido`). Ao voltar para um status que ocupa o período, revalida jornada, bloqueios e reservas do profissional, recursos e cliente. Para cancelado grava responsável, data e motivo; ao sair de cancelado, os dados de cancelamento saem do registro e ficam no histórico. |
| WhatsApp | Fluxo manual: a tela abre o WhatsApp com a mensagem pronta; o envio só é registrado quando a equipe clica em "Registrar envio". Registro guarda tipo, data, responsável, agendamento e o horário vigente; após reagendar, a agenda indica que é preciso avisar de novo. O texto da mensagem não é armazenado e não inclui observações internas. Nenhuma automação paga. |
| Lista de espera | Não reserva horários. Evita duplicidade em aberto (cliente + serviço + preferência). Ao cancelar ou reagendar, a agenda mostra candidatos compatíveis. Agendar pela lista revalida o horário e só marca "agendado" na mesma transação em que a reserva é criada. Contatos e mudanças de situação ficam no histórico. |
| Sincronização | Tabela-sinal `agenda_revisoes` (sem dados de clientes) publicada no Supabase Realtime, com RLS por perfil. Se a conexão falhar, a agenda é consultada a cada 30 s até reconectar, e também ao voltar o foco da janela. |
| Vários serviços (012) | Uma marcação agrupa de 2 a 6 reservas da mesma cliente (`grupo_id`), cada uma com serviço, profissional, início, duração efetiva, preparação, status e histórico próprios. A criação é atômica: se uma etapa falhar, nada é criado. Etapas consecutivas são permitidas; sobreposição da cliente só com exceção da administração. Cancelar ou reagendar o grupo inteiro é tudo ou nada (reagendar exige todas as etapas aguardando ou confirmadas); cada etapa também pode ser alterada sozinha. |
| Recorrência (012) | Séries semanais, quinzenais ou mensais (`serie_id`), limite de 52 ocorrências e 1 ano. A prévia mostra todas as datas e o motivo das indisponíveis; nada é ajustado em silêncio. No mensal, meses sem o dia escolhido exigem escolha explícita (último dia do mês ou pular). A série só é criada com todas as datas disponíveis ou, por escolha explícita, só com as disponíveis; a transação final revalida todas. Edição e cancelamento: somente esta, esta e as próximas, ou toda a série elegível (aguardando/confirmadas e futuras); concluídas e passadas são preservadas. |
| Operações em conjunto | Enviam a versão de cada reserva mostrada na tela; se qualquer uma mudou, nada é alterado. As restrições de sobreposição são adiáveis para mover várias reservas na mesma transação e conferir tudo antes de confirmar. Reenvio com o mesmo identificador não duplica. |
| Consulta pública | Continua só consultando: considera duração por profissional, preparação, bloqueios, reservas (inclusive concluídas) e recursos. Devolve apenas dia e horário. A solicitação pelo WhatsApp não garante a vaga. |

## Arquivos da migração

Aplicar em ordem, cada um inteiro, no *SQL Editor* do projeto de desenvolvimento (`xffgansmrgqhbfxocajh`):

1. `supabase/migrations/011a_estrutura_operacao.sql`
2. `supabase/migrations/011b_regras_operacao.sql`
3. `supabase/migrations/011c_permissoes_operacao.sql`
4. `supabase/migrations/012a_estrutura_grupos_series.sql`
5. `supabase/migrations/012b_regras_grupos_series.sql`
6. `supabase/migrations/012c_permissoes_grupos_series.sql`

Antes de aplicar: faça um backup (`docs/BACKUP-E-RESTAURACAO.md`). A parte 1 confere se os dados atuais já obedecem às novas
restrições e, se houver sobreposição (por exemplo, uma reserva criada sobre o período de outra concluída antes), para com a
lista de ids para revisão manual, sem alterar dados.

As assinaturas antigas das funções de agenda deixam de ser chamáveis (permissão revogada) e não foram apagadas. Uma versão
anterior do sistema aberta em algum navegador passará a receber "sem permissão" até ser recarregada.

## Depois de aplicar

1. *Database → Publications → supabase_realtime*: confira se `agenda_revisoes` está marcada (a migração faz isso automaticamente).
2. Rode `npm run test:integracao` (usa as contas de teste de `.env.test.local`).
3. Publique o novo frontend somente com autorização.
