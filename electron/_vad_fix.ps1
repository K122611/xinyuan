$file = 'D:\HuaweiMoveData\Users\Anne\Desktop\心元AI\xinyuan-1.0.11\xinyuan-emo-mate\electron\ai-conversation.js'
$c = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

# 1. Add preRollBuffer to session init
$c = $c -replace '(speechPCM: \[\],.*?)\r?\n(.*?silentFrames: 0,)', 
  '$1' + "`r`n        preRollBuffer: []," + '`r`n$2'

# 2. Reset preRollBuffer on stop
$c = $c -replace '(s\.speechPCM = \[\];)\r?\n(.*?s\.silentFrames = 0;)',
  '$1' + "`r`n        s.preRollBuffer = [];" + '`r`n$2'

# 3. VAD idle state: store pre-roll, use on trigger
$old = 's.vadState = ''speaking'';\r?\n\s+s.speechPCM = \[chunk\];'
$new = "s.vadState = 'speaking';`r`n          s.speechPCM = s.preRollBuffer.length > 0 ? [...s.preRollBuffer, chunk] : [chunk];`r`n          s.preRollBuffer = [];"
$c = $c -replace $old, $new

# 4. Add pre-roll accumulation in idle non-speech branch
$old = '_emit\(sessionId, ''speech_start''\);\r?\n\s+\}\r?\n\s+\} else if \(s\.vadState'
$new = "_emit(sessionId, 'speech_start');`r`n        }`r`n      } else {`r`n        s.preRollBuffer.push(chunk);`r`n        if (s.preRollBuffer.length > 5) s.preRollBuffer.shift();`r`n      }`r`n    } else if (s.vadState"
$c = $c -replace $old, $new

[System.IO.File]::WriteAllText($file, $c, [System.Text.Encoding]::UTF8)
Write-Output 'done'
