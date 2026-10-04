# Instruções do projeto Beauty TN Batista

## Framework obrigatório
Antes de qualquer criação, alteração, revisão ou manutenção deste sistema, consulte e siga o framework em
`G:\Meu Drive\Trabalho\Framework-Desenvolvimento-de-Software`:

1. `LEIA-PRIMEIRO.md` e estas instruções do projeto.
2. Regras pertinentes de `01-Nucleo` (Regras Gerais, Segurança, LGPD, Arquitetura, Critérios para Concluir).
3. Fluxo adequado em `03-Fluxos-de-Trabalho` (ex.: Nova Funcionalidade, Correção de Bug).
4. Perfil `05-Perfis-de-Projeto/Sistema-de-Agendamento`.
5. Adaptador do agente em `04-Adaptadores` e catálogo `02-Skills/CATALOGO.md`.

Caminhos do framework são relativos à raiz dele. Arquivos de `07-Manutencao-do-Framework/Historico` não são regras ativas.
Pacotes ZIP do catálogo não são skills instaladas. Não instale ferramentas, skills, plugins ou MCPs sem autorização.

## Projeto
- Escopo: somente agendamento (sem financeiro, comissões, prontuário, anamnese, consentimentos ou fotos clínicas).
- Frontend: React + Vite + Tailwind (`src/`). Backend: Supabase (Postgres, RLS, funções RPC, Edge Function `gerenciar-usuarios`).
- Regras de negócio ficam no banco (`supabase/migrations`); a interface só espelha para orientar o usuário.
- Migrações são incrementais: nunca reescreva uma migração já aplicada; crie a próxima numerada.
  Evite `drop` (prefira substituir por nova assinatura e revogar a anterior), preserve dados existentes.
- Fuso da clínica: `America/Sao_Paulo` (tabela `configuracao_clinica`).
- Modo demonstração (`npm run demo`, porta 5181): dados fictícios só no navegador, nunca no Supabase.
  Toda regra nova do servidor deve ser espelhada em `src/demo/motor.ts` para a demonstração continuar coerente.
- Chaves privilegiadas nunca vão para o frontend nem para arquivos versionados.

## Verificação
- `npm run test` (unidade), `npm run build`, `npm run test:integracao` (banco de desenvolvimento, contas em `.env.test.local`).
- Mudanças externas (aplicar migração, deploy, produção) exigem autorização explícita do usuário.
- Backup e restauração: `docs/BACKUP-E-RESTAURACAO.md`.
