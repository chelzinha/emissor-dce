$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$sourceDir = Join-Path $repoRoot 'apps-script'
$workDir = Join-Path $repoRoot '.operations-apps-script-deploy'
$title = 'AGF Operacoes Postais'

if (Test-Path $workDir) {
  throw "A pasta temporaria ja existe: $workDir. Renomeie ou remova somente se tiver certeza de que nao precisa do projeto local anterior."
}

New-Item -ItemType Directory -Path $workDir | Out-Null
Push-Location $workDir

try {
  Write-Host 'Criando um NOVO projeto Apps Script isolado...'
  & npx -y @google/clasp create --type standalone --title $title --rootDir .
  if ($LASTEXITCODE -ne 0) {
    throw 'Falha ao criar o projeto. Se o clasp pedir login, execute: npx -y @google/clasp login'
  }

  Write-Host 'Copiando o backend de Operacoes Postais...'
  Copy-Item -Path (Join-Path $sourceDir '*') -Destination $workDir -Recurse -Force

  Write-Host 'Enviando os arquivos ao novo Apps Script...'
  & npx -y @google/clasp push --force
  if ($LASTEXITCODE -ne 0) { throw 'Falha no clasp push.' }

  Write-Host 'Criando uma implantacao do projeto...'
  & npx -y @google/clasp deploy --description 'AGF Operacoes Postais - Declaracao Simplificada'
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'O codigo foi enviado, mas o deploy automatico falhou. Abra o editor e implante como Aplicativo da Web manualmente.'
  }

  Write-Host ''
  Write-Host 'Implantacoes encontradas:'
  & npx -y @google/clasp deployments

  Write-Host ''
  Write-Host 'Abrindo o NOVO projeto no navegador...'
  & npx -y @google/clasp open

  Write-Host ''
  Write-Host 'No editor, execute UMA VEZ a funcao bootstrapOperationsProject().' -ForegroundColor Yellow
  Write-Host 'Ela criara a nova planilha, a nova pasta e um arquivo temporario AGF_OPERACOES_BOOTSTRAP.json no Drive.' -ForegroundColor Yellow
}
finally {
  Pop-Location
}
