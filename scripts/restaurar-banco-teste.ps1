<#
  Teste de restauração em banco ISOLADO (nunca em produção). Uso: veja docs/BACKUP-E-RESTAURACAO.md.

  - O destino vem de SUPABASE_DB_URL_TESTE ou é pedido de forma oculta; nunca é exibido.
  - Recusa qualquer destino que aponte para o projeto de produção (xffgansmrgqhbfxocajh).
  - Confere as somas SHA-256 do manifesto antes de restaurar e, ao final, mostra as contagens para comparar com o manifesto.
#>
param(
  [Parameter(Mandatory = $true)] [string]$Arquivo
)
$ErrorActionPreference = 'Stop'
$PRODUCAO = 'xffgansmrgqhbfxocajh'

$url = $env:SUPABASE_DB_URL_TESTE
if (-not $url) {
  $seguro = Read-Host -AsSecureString 'Cole a connection string do banco de TESTE (isolado). Ela não será exibida'
  $url = [System.Net.NetworkCredential]::new('', $seguro).Password
}
if (-not $url) { throw 'Connection string não informada.' }
if ($url -match $PRODUCAO) { throw 'O destino aponta para o projeto de produção. Restauração de teste recusada.' }
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) { throw 'psql não encontrado. Instale o cliente PostgreSQL.' }

$pasta = Join-Path ([System.IO.Path]::GetTempPath()) ("beauty-restauracao-" + (Get-Date -Format 'yyyyMMddHHmmss'))
try {
  Expand-Archive -Path $Arquivo -DestinationPath $pasta
  $manifesto = Get-Content (Join-Path $pasta 'manifesto.json') -Raw | ConvertFrom-Json
  foreach ($item in $manifesto.arquivos) {
    $hash = (Get-FileHash (Join-Path $pasta $item.arquivo) -Algorithm SHA256).Hash
    if ($hash -ne $item.sha256) { throw "Arquivo corrompido ou alterado: $($item.arquivo)" }
  }
  Write-Host "Backup de $($manifesto.criado_em) ($($manifesto.metodo)) íntegro. Restaurando no banco de teste..."

  if (Test-Path (Join-Path $pasta 'data.sql')) {
    # Procedimento oficial do Supabase; session_replication_role desliga gatilhos durante a carga.
    & psql --single-transaction --variable ON_ERROR_STOP=1 --file (Join-Path $pasta 'roles.sql') --file (Join-Path $pasta 'schema.sql') `
      --command 'SET session_replication_role = replica' --file (Join-Path $pasta 'data.sql') --dbname $url
  } else {
    if (-not (Get-Command pg_restore -ErrorAction SilentlyContinue)) { throw 'pg_restore não encontrado.' }
    & pg_restore --no-owner --no-privileges --exit-on-error --dbname=$url (Join-Path $pasta 'dados.dump')
  }
  if ($LASTEXITCODE -ne 0) { throw 'A restauração falhou. Nada foi alterado em produção.' }

  $tabelas = @('clientes', 'agendamentos', 'historico_agendamentos', 'profissionais', 'servicos', 'bloqueios', 'lista_espera', 'comunicacoes')
    $existentes = (& psql $url --tuples-only --no-align --command "select string_agg(t, ',' order by t) from unnest(array['$($tabelas -join "','")']) t where to_regclass('public.' || t) is not null").Trim() -split ','
    $sql = "select json_build_object(" + (($existentes | ForEach-Object { "'$_',(select count(*) from public.$_)" }) -join ',') + ")"
  $restaurado = & psql $url --tuples-only --no-align --command $sql
  Write-Host "Contagens no backup:     $($manifesto.contagens)"
  Write-Host "Contagens restauradas:   $restaurado"
  if ($manifesto.contagens -and ($manifesto.contagens.Trim() -ne "$restaurado".Trim())) { throw 'As contagens não conferem. Investigue antes de considerar o backup válido.' }
  Write-Host 'Restauração de teste concluída. Registre a data e o resultado em docs/BACKUP-E-RESTAURACAO.md.'
} finally {
  Remove-Item -Recurse -Force $pasta -ErrorAction SilentlyContinue
  $url = $null
}
