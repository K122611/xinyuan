$file = 'D:\HuaweiMoveData\Users\Anne\Desktop\心元AI\xinyuan-1.0.11\xinyuan-emo-mate\electron\ai-conversation.js'
$c = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

# Add preRollBuffer to session init + reset on stop
$c = $c -replace 'speechPCM: \[\],.*?// Int16Array\[\]\s+silentFrames',
  "speechPCM: [],          // Int16Array[]`r`n        preRollBuffer: [],`r`n        silentFrames"

$c = $c -replace "s\.speechPCM = \[\];\s+s\.silentFrames",
  "s.speechPCM = [];`r`n        s.preRollBuffer = [];`r`n        s.silentFrames"

[System.IO.File]::WriteAllText($file, $c, [System.Text.Encoding]::UTF8)
Write-Output 'init fixed'
