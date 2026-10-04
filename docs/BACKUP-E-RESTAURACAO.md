# Backup e restauração — Beauty TN Batista

## Situação atual (verificada em 04/10/2026)

| Item | Situação |
| --- | --- |
| Código-fonte | Versionado no Git (`main`). Cópia manual em `.backup/2026-10-03-antes-prd-v2/`. |
| Pasta `.backup/` | Contém **somente código** (src, migrações, configurações). **Não é backup do banco** e não prova que os dados podem ser recuperados. |
| Banco de dados (Supabase `xffgansmrgqhbfxocajh`, plano Free) | **Sem backup automático** (o plano Free não oferece). Primeiro backup manual em 04/10/2026 12:24 (`pg_dump` 17.11, formato custom, 461 KB, antes das migrações 011/012), arquivo íntegro (SHA-256 e `pg_restore --list` conferidos). |
| Restauração | **Não validada.** Nenhum teste de restauração foi executado. |

Código e dados são coisas diferentes: o Git recupera o sistema; somente o backup do banco recupera clientes, agendamentos, histórico, lista de espera e comunicações.

## Rotina de backup dos dados

**Ferramentas (instalar com autorização, uma vez):** uma das opções abaixo no computador que fará o backup.

- Supabase CLI + Docker Desktop: método recomendado pela documentação do Supabase (`supabase db dump`).
- Cliente PostgreSQL na mesma versão do servidor ou mais nova (`pg_dump`, `psql`, `pg_restore`): alternativa sem Docker.

**Credencial:** a *connection string* fica em *Supabase → Project Settings → Database → Connect → Session pooler*.
Ela contém a senha do banco: não salve em arquivos do projeto, no Git, em prints ou em chats. Os scripts pedem a string
de forma oculta (ou leem a variável de ambiente `SUPABASE_DB_URL` definida só na sessão do terminal) e nunca a exibem.

**Execução** (PowerShell, na pasta do projeto):

```powershell
.\scripts\backup-banco.ps1 -Destino "D:\BackupsBeauty"
```

O script gera `beauty-banco-AAAA-MM-DD_HHMMSS.zip` com `roles.sql`, `schema.sql`, `data.sql` (ou `dados.dump`) e `manifesto.json`
(data, método, tamanhos, somas SHA-256 e contagens de registros, sem dados pessoais).

**Frequência sugerida:** diária, ao fim do expediente (Agendador de Tarefas do Windows), e sempre antes de aplicar migrações.

**Armazenamento:**

- Fora da pasta do projeto (o script recusa destino dentro dela) e fora do repositório Git.
- Em local com acesso restrito e criptografado (ex.: unidade com BitLocker ou arquivo 7-Zip com AES-256), porque o backup contém dados pessoais de clientes (LGPD).
- Pelo menos uma cópia fora deste computador (ex.: pasta restrita em nuvem diferente da pasta do projeto ou mídia externa guardada em outro local).

**Retenção:** o script mantém os 14 backups mais recentes e o primeiro de cada um dos últimos 12 meses (ajustável com
`-ManterDiarios` e `-ManterMensais`; `-SemLimpeza` desliga a remoção). Pedidos de exclusão de dados de clientes devem
considerar que eles continuam nos backups até expirarem pela retenção.

## Restauração

### Teste periódico (obrigatório antes de considerar o backup confiável)

1. Crie um banco **isolado**: um segundo projeto Supabase só para testes (o plano Free permite dois projetos) ou um Postgres local.
   Nunca use o projeto `xffgansmrgqhbfxocajh`.
2. Execute:

   ```powershell
   .\scripts\restaurar-banco-teste.ps1 -Arquivo "D:\BackupsBeauty\beauty-banco-AAAA-MM-DD_HHMMSS.zip"
   ```

   O script recusa destinos que apontem para o projeto de produção, confere as somas SHA-256, restaura e compara as contagens com o manifesto.
3. Abra o sistema apontando para o banco de teste (arquivo `.env.local` temporário, fora do Git) e confira a agenda de alguns dias, um cliente e o histórico.
4. Registre abaixo a data, o arquivo e o resultado.

### Recuperação real (incidente)

1. Pare o uso do sistema e preserve o estado atual (faça um backup do banco danificado antes de qualquer ação).
2. Restaure primeiro em um projeto novo e confira (passo anterior).
3. Só então decida, com autorização, entre apontar o sistema para o projeto restaurado ou restaurar sobre o projeto original.
4. Senhas de papéis personalizados do banco não vêm no backup (aviso do Supabase); usuários do Auth vêm em `data.sql`.

## Registro de testes de restauração

| Data | Backup | Destino isolado | Resultado | Responsável |
| --- | --- | --- | --- | --- |
| — | — | — | Pendente: nenhum teste executado | — |
