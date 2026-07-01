$path = 'D:\HuaweiMoveData\Users\Anne\Desktop\心元AI\xinyuan-1.0.11\xinyuan-emo-mate\electron\ai-conversation.js'
$content = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

$old = "`t      fullPCM = trimmed;`r`n`t      console.log('[AI对话] ✂️ 尾部裁剪:', ((fullPCM.length / 16000) * 1000).toFixed(0), 'ms →', ((trimEnd / 16000) * 1000).toFixed(0), 'ms');"

$new = "`t      const origLen = fullPCM.length;`r`n`t      fullPCM = trimmed;`r`n`t      console.log('[AI对话] ✂️ 尾部裁剪:', ((origLen / 16000) * 1000).toFixed(0), 'ms →', ((trimEnd / 16000) * 1000).toFixed(0), 'ms');"

if ($content.Contains($old)) {
    $content = $content.Replace($old, $new)
    [System.IO.File]::WriteAllText($path, $content, [System.Text.Encoding]::UTF8)
    Write-Host "SUCCESS: Replaced"
} else {
    Write-Host "FAIL: old string not found"
    # Debug: show what we're looking for
    $lines = $content -split "`r`n"
    for ($i = 550; $i -lt 556; $i++) {
        $hex = [System.BitConverter]::ToString([System.Text.Encoding]::UTF8.GetBytes($lines[$i]))
        Write-Host "Line $i hex: $hex"
        Write-Host "Line $i text: $($lines[$i])"
    }
}
