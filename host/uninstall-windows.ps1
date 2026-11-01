# Remove the OCR Clipper native messaging host registration (current user).
$ErrorActionPreference = 'SilentlyContinue'
foreach ($k in @(
  'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ocrclipper.host',
  'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.ocrclipper.host',
  'HKCU:\Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.ocrclipper.host',
  'HKCU:\Software\Chromium\NativeMessagingHosts\com.ocrclipper.host'
)) { Remove-Item -Path $k -Recurse -Force }
Remove-Item (Join-Path $PSScriptRoot 'com.ocrclipper.host.json') -Force
Remove-Item (Join-Path $PSScriptRoot 'ocr-clipper-host.bat') -Force
Write-Host 'Uninstalled.'
