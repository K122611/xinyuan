@echo off
cd /d "C:\Users\LENOVO\Desktop\心元\xinyuan-emo-mate"
echo Starting Electron...
node_modules\electron\dist\electron.exe . > electron_stdout.txt 2> electron_stderr.txt
echo Exit code: %ERRORLEVEL%
echo Done
