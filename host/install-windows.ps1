param(
  [string]$ExtensionId = 'alniecnjlgpfdfolhnmflgcjmomdianc'
)
# Register the OCR Clipper native messaging host for Chrome / Edge / Brave / Chromium (current user).
# Usage: powershell -ExecutionPolicy Bypass -File host\install-windows.ps1 [-ExtensionId <id>]
$ErrorActionPreference = 'Stop'
$hostDir = $PSScriptRoot
$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node.exe not found in PATH. Please install Node.js 18+ first.' }

$bat = Join-Path $hostDir 'ocr-clipper-host.bat'
$batText = "@echo off`r`n`"$node`" `"%~dp0host.cjs`" %*`r`n"
[IO.File]::WriteAllText($bat, $batText, [Text.Encoding]::Default)

$manifestPath = Join-Path $hostDir 'com.ocrclipper.host.json'
$manifest = [ordered]@{
  name            = 'com.ocrclipper.host'
  description     = 'OCR Clipper native host'
  path            = $bat
  type            = 'stdio'
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

$keys = @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ocrclipper.host',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.ocrclipper.host',
  'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.ocrclipper.host',
  'HKCU:\Software\Chromium\NativeMessagingHosts\com.ocrclipper.host'
)
foreach ($k in $keys) {
  New-Item -Path $k -Force | Out-Null
  Set-Item -Path $k -Value $manifestPath
}

Write-Host "Installed native host:"
Write-Host "  manifest : $manifestPath"
Write-Host "  launcher : $bat"
Write-Host "  node     : $node"
Write-Host "  allowed  : chrome-extension://$ExtensionId/"
Write-Host "Reload the extension (chrome://extensions) and click 'detect' in the settings tab."
