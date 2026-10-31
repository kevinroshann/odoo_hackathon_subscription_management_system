@echo off
setlocal
echo Starting Brightloop Subscription Management System...

set NODE_EXE=
if exist "%~dp0node.cmd" set "NODE_EXE=%~dp0node.cmd"
if "%NODE_EXE%"=="" if exist "%APPDATA%\Antigravity\bin\agy-node.cmd" set "NODE_EXE=%APPDATA%\Antigravity\bin\agy-node.cmd"
if "%NODE_EXE%"=="" if exist "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" (
  set ELECTRON_RUN_AS_NODE=1
  set "NODE_EXE=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
)
if "%NODE_EXE%"=="" set "NODE_EXE=node"

call %NODE_EXE% src/server.js
pause
