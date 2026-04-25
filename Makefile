.PHONY: up down backend frontend migrate install dev

# Opcjonalnie — tylko jeśli używasz Dockera; możesz pominąć i podać DATABASE_URL do własnego PostgreSQL.
up:
	docker-compose up -d

down:
	docker-compose down

install:
	poetry install --with dev
	cd frontend && npm install

migrate:
	poetry run alembic upgrade head

migration:
	poetry run alembic revision --autogenerate -m "$(msg)"

backend:
	poetry run uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev:
	@echo "Uruchom w osobnych terminalach:"
	@echo "  make backend"
	@echo "  make frontend"
