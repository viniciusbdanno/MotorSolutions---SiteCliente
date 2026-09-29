param(
    [int]$Port = 3000
)

$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $projectRoot '.env'))) {
    Copy-Item (Join-Path $projectRoot '.env.example') (Join-Path $projectRoot '.env')
    Write-Host 'Arquivo .env criado. Troque as senhas e a SENSOR_API_KEY antes do uso real.'
}

$logDir = Join-Path $projectRoot 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$process = Start-Process -FilePath 'python' `
    -ArgumentList @('-m', 'uvicorn', 'app.main:app', '--env-file', '.env', '--host', '0.0.0.0', '--port', $Port) `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput (Join-Path $logDir 'server.out.log') `
    -RedirectStandardError (Join-Path $logDir 'server.err.log') `
    -PassThru
$process.Id | Set-Content (Join-Path $logDir 'server.pid')
Write-Host "Servidor iniciado em segundo plano (PID $($process.Id)): http://localhost:$Port/docs"
