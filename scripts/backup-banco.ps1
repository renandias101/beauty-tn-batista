<#
  Backup dos DADOS do Supabase (não do código). Uso: veja docs/BACKUP-E-RESTAURACAO.md.

  - A conexão vem da variável de ambiente SUPABASE_DB_URL ou é pedida de forma oculta; nunca é gravada em arquivo nem exibida.
  - Gera roles.sql, schema.sql e data.sql (Supabase CLI, método oficial) ou, sem a CLI, dados.dump (pg_dump).
  - Grava um manifesto com data, método, tamanhos e somas SHA-256, compacta em .zip no destino e aplica a retenção.
  - O destino deve ficar FORA da pasta do projeto e com acesso restrito: o backup contém dados pessoais de clientes.
#>
param(
  [Parameter(Mandatory = $true)] [string]$Destino,
  [int]$ManterDiarios = 14,
  [int]$ManterMensais = 12,
  [switch]$SemLimpeza
)
$ErrorActionPreference = 'Stop'

$projeto = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$destinoCompleto = [System.IO.Path]::GetFullPath($Destino)
if ($destinoCompleto.StartsWith($projeto, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'O destino do backup não pode ficar dentro da pasta do projeto (o backup contém dados pessoais e não deve ir para o repositório).'
}
New-Item -ItemType Directory -Force -Path $destinoCompleto | Out-Null

$url = $env:SUPABASE_DB_URL
if (-not $url) {
  $seguro = Read-Host -AsSecureString 'Cole a connection string do Supabase (Session pooler). Ela não será exibida'
  $url = [System.Net.NetworkCredential]::new('', $seguro).Password
}
if (-not $url) { throw 'Connection string não informada.' }

$carimbo = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$trabalho = Join-Path ([System.IO.Path]::GetTempPath()) "beauty-backup-$carimbo"
New-Item -ItemType Directory -Force -Path $trabalho | Out-Null

try {
  $supabase = Get-Command supabase -ErrorAction SilentlyContinue
  $pgDump = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($supabase) {
    # Método recomendado pelo Supabase (requer Docker em execução).
    $metodo = 'supabase db dump (roles, schema, data)'
    & supabase db dump --db-url $url -f (Join-Path $trabalho 'roles.sql') --role-only
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao exportar os papéis (roles).' }
    & supabase db dump --db-url $url -f (Join-Path $trabalho 'schema.sql')
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao exportar a estrutura (schema).' }
    & supabase db dump --db-url $url -f (Join-Path $trabalho 'data.sql') --use-copy --data-only -x 'storage.buckets_vectors' -x 'storage.vector_indexes'
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao exportar os dados.' }
  } elseif ($pgDump) {
    # Alternativa: cópia completa no formato do pg_dump (cliente PostgreSQL na mesma versão do servidor ou mais nova).
    $metodo = 'pg_dump --format=custom'
    & pg_dump --dbname=$url --format=custom --no-owner --no-privileges --file (Join-Path $trabalho 'dados.dump')
    if ($LASTEXITCODE -ne 0) { throw 'Falha no pg_dump.' }
  } else {
    throw 'Nenhuma ferramenta encontrada. Instale a Supabase CLI (com Docker) ou o cliente PostgreSQL (pg_dump). Veja docs/BACKUP-E-RESTAURACAO.md.'
  }

  # Contagens de referência para conferir a restauração (somente números, sem dados pessoais).
  $contagens = $null
  if (Get-Command psql -ErrorAction SilentlyContinue) {
    $tabelas = @('clientes', 'agendamentos', 'historico_agendamentos', 'profissionais', 'servicos', 'bloqueios', 'lista_espera', 'comunicacoes')
    $existentes = (& psql $url --tuples-only --no-align --command "select string_agg(t, ',' order by t) from unnest(array['$($tabelas -join "','")']) t where to_regclass('public.' || t) is not null").Trim() -split ','
    $sql = "select json_build_object(" + (($existentes | ForEach-Object { "'$_',(select count(*) from public.$_)" }) -join ',') + ")"
    $contagens = & psql $url --tuples-only --no-align --command $sql
  }

  $arquivos = Get-ChildItem $trabalho -File | ForEach-Object {
    [ordered]@{ arquivo = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
  }
  [ordered]@{
    criado_em = (Get-Date).ToString('o')
    metodo = $metodo
    projeto = 'Beauty TN Batista'
    contagens = $contagens
    arquivos = @($arquivos)
  } | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $trabalho 'manifesto.json')

  $zip = Join-Path $destinoCompleto "beauty-banco-$carimbo.zip"
  Compress-Archive -Path (Join-Path $trabalho '*') -DestinationPath $zip
  Write-Host "Backup gravado: $zip"
} finally {
  Remove-Item -Recurse -Force $trabalho -ErrorAction SilentlyContinue
  $url = $null
}

# Retenção: mantém os $ManterDiarios mais recentes e o primeiro backup de cada um dos últimos $ManterMensais meses.
if (-not $SemLimpeza) {
  $todos = Get-ChildItem $destinoCompleto -Filter 'beauty-banco-*.zip' | Sort-Object Name -Descending
  $manter = New-Object System.Collections.Generic.HashSet[string]
  $todos | Select-Object -First $ManterDiarios | ForEach-Object { [void]$manter.Add($_.Name) }
  $todos | Group-Object { $_.Name.Substring(13, 7) } | Sort-Object Name -Descending | Select-Object -First $ManterMensais |
    ForEach-Object { [void]$manter.Add(($_.Group | Sort-Object Name | Select-Object -First 1).Name) }
  $todos | Where-Object { -not $manter.Contains($_.Name) } | ForEach-Object {
    Write-Host "Retenção: removendo $($_.Name)"
    Remove-Item $_.FullName
  }
}
