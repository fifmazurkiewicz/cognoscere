#!/bin/sh
set -e
cd /app
echo "Alembic: upgrade head..."
poetry run alembic upgrade head
echo "Uruchamianie uvicorn..."
exec poetry run uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers
