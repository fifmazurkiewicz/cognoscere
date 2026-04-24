.PHONY: up down backend frontend migrate install dev

up:
	docker-compose up -d

down:
	docker-compose down

install:
	pip install -e ".[dev]"
	cd frontend && npm install

migrate:
	alembic upgrade head

migration:
	alembic revision --autogenerate -m "$(msg)"

backend:
	uvicorn app.main:app --reload --port 8000

frontend:
	cd frontend && npm run dev

dev:
	@echo "Uruchom w osobnych terminalach:"
	@echo "  make backend"
	@echo "  make frontend"
