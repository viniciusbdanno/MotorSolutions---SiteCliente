$pidFile = Join-Path (Join-Path (Split-Path -Parent $PSScriptRoot) 'logs') 'server.pid'
if (Test-Path $pidFile) {
    $serverPid = Get-Content $pidFile
    Stop-Process -Id $serverPid -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force
    Write-Host "Servidor $serverPid encerrado."
}
