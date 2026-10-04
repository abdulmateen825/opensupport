$root = $PSScriptRoot

Set-Location $root

Write-Host "Starting OpenSupport infrastructure..."

docker compose up -d --wait --wait-timeout 120 postgres redis qdrant rustfs

Write-Host "Running database migrations..."

& .venv\Scripts\python.exe -m alembic upgrade head

Write-Host "Starting API..."
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoExit", "-Command", @"
cd '$root'
& .venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
"@

Write-Host "Starting Dashboard..."
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoExit", "-Command", @"
cd '$root'
corepack pnpm --filter @opensupport/dashboard dev --port 3000
"@

Write-Host "Starting Widget..."
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoExit", "-Command", @"
cd '$root'
corepack pnpm --filter @opensupport/widget dev --host 0.0.0.0 --port 5173 --strictPort
"@

Write-Host "Starting Celery Worker..."
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoExit", "-Command", @"
cd '$root'
& .venv\Scripts\python.exe -m celery -A backend.app.workers.celery_app.celery_app worker --pool=solo --loglevel=INFO
"@

Write-Host "Starting Celery Beat..."
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoExit", "-Command", @"
cd '$root'
& .venv\Scripts\python.exe -m celery -A backend.app.workers.celery_app.celery_app beat --loglevel=INFO --schedule=.venv/celerybeat-schedule
"@

Write-Host "Starting Demo Store..."
Start-Process powershell -WindowStyle Hidden -ArgumentList "-NoExit", "-Command", @"
cd '$root'
corepack pnpm --filter @opensupport/demo-store dev --port 3002
"@

Write-Host ""
Write-Host "======================================"
Write-Host " OpenSupport started"
Write-Host "======================================"
Write-Host "Dashboard:  http://localhost:3000"
Write-Host "Demo Store: http://localhost:3002"
Write-Host "Widget:     http://localhost:5173"
Write-Host "API:        http://localhost:8000"
Write-Host "API Docs:   http://localhost:8000/docs"
Write-Host "======================================"
