param([string]$Out, [int]$TimeoutSec = 120)
# Wait for a new image to appear on the clipboard and save it as PNG.
# Prints READY once the current clipboard sequence number is recorded; the host triggers the tool after that.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -Namespace OCRClipper -Name Clip -MemberDefinition '[DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();'

$start = [OCRClipper.Clip]::GetClipboardSequenceNumber()
[Console]::Out.WriteLine('READY')
[Console]::Out.Flush()

$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 250
  if ([OCRClipper.Clip]::GetClipboardSequenceNumber() -ne $start) {
    $img = $null
    try { $img = [System.Windows.Forms.Clipboard]::GetImage() } catch { $img = $null }
    if ($img -ne $null) {
      $img.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
      [Console]::Out.WriteLine("OK $($img.Width) $($img.Height)")
      exit 0
    }
  }
}
exit 2
