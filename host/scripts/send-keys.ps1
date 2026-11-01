param([string]$Keys = '{F1}')
# Send a global hotkey (SendKeys syntax: {F1}, ^+a = Ctrl+Shift+A, %a = Alt+A)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($Keys)
