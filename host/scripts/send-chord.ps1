param([string]$Keys = 'LWIN+SHIFT+S')
# Send a key chord with keybd_event (supports the Windows key, which SendKeys cannot send).
# Keys: '+'-separated names: LWIN, SHIFT, CTRL, ALT, F1..F12, PRINTSCREEN, or a single letter/digit.
$ErrorActionPreference = 'Stop'
Add-Type -Namespace OCRClipper -Name Kbd -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'
$map = @{ LWIN = 0x5B; SHIFT = 0x10; CTRL = 0x11; CONTROL = 0x11; ALT = 0x12; PRINTSCREEN = 0x2C; ESC = 0x1B; ENTER = 0x0D }
$vks = foreach ($k in $Keys.ToUpper().Split('+')) {
  if ($map.ContainsKey($k)) { $map[$k] }
  elseif ($k -match '^F(\d{1,2})$') { 0x6F + [int]$Matches[1] }
  elseif ($k.Length -eq 1) { [int][char]$k }
  else { throw "unknown key $k" }
}
foreach ($vk in $vks) { [OCRClipper.Kbd]::keybd_event([byte]$vk, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40 }
[array]::Reverse($vks)
foreach ($vk in $vks) { [OCRClipper.Kbd]::keybd_event([byte]$vk, 0, 2, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40 }
