@echo off
setlocal
echo Running All Unit Tests for Member 2...

set NODE_EXE=
if exist "%~dp0node.cmd" set "NODE_EXE=%~dp0node.cmd"
if "%NODE_EXE%"=="" if exist "%APPDATA%\Antigravity\bin\agy-node.cmd" set "NODE_EXE=%APPDATA%\Antigravity\bin\agy-node.cmd"
if "%NODE_EXE%"=="" if exist "%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe" (
  set ELECTRON_RUN_AS_NODE=1
  set "NODE_EXE=%LOCALAPPDATA%\Programs\antigravity\Antigravity.exe"
)
if "%NODE_EXE%"=="" set "NODE_EXE=node"

call %NODE_EXE% --test tests/product.test.js tests/plan.test.js tests/discount.test.js tests/quotation.test.js tests/api.test.js
pause
