@echo off
echo Starting SnapMarket development servers...

start "API" cmd /k "npm run dev:api"
start "Worker" cmd /k "npm run dev:worker"
start "Admin" cmd /k "npm run dev:admin"
start "Mobile" cmd /k "npm run dev:mobile"

echo All servers started in separate windows.
