@echo off
set IMAGE_NAME=jack-jackson-game
set CONTAINER_NAME=jack-jackson-container
set PORT=3001

echo ==============================
echo Jack Jackson: Resonance Duel
echo Starting Docker container...
echo ==============================

docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker is not running. Please start Docker Desktop.
    pause
    exit /b
)

docker stop %CONTAINER_NAME% >nul 2>&1
docker rm %CONTAINER_NAME% >nul 2>&1

docker build -t %IMAGE_NAME% .
docker run -d --name %CONTAINER_NAME% -p %PORT%:3001 %IMAGE_NAME%

timeout /t 5 >nul
start http://localhost:%PORT%

echo ==============================
echo Server is running at http://localhost:%PORT%
echo Players can join from the same network!
pause
