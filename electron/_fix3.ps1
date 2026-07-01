$file = 'D:\HuaweiMoveData\Users\Anne\Desktop\心元AI\xinyuan-1.0.11\xinyuan-emo-mate\electron\ai-conversation.js'
$c = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

$newKW = "const SEARCH_KEYWORDS = ['几号', '日期', '星期几', '天气', '多少度',`r`n  '新闻', '最新', '热搜', '发生了什么', '多少钱', '价格', '汇率', '股价', '股票',`r`n  '什么是', '为什么', '怎么', '如何', '是谁', '在哪里', '什么时候', '搜索', '查一下', '帮我查',`r`n  '多少号', '农历', '温度', '湿度', '预报'];"

$c = $c -replace 'const SEARCH_KEYWORDS = \[[\s\S]*?\];', $newKW
[System.IO.File]::WriteAllText($file, $c, [System.Text.Encoding]::UTF8)
Write-Output 'done'
