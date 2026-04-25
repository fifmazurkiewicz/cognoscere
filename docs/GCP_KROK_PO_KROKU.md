# Cognoscere na Google Cloud — Ścieżka A (Cloud SQL + Docker na VM)

Wdrożenie wzorowane na [TeacherHelper — GCP Krok po kroku](https://github.com/fifmazurkiewicz/TeacherHelper/blob/main/docs/GCP_KROK_PO_KROKU.md). **Różnice:** Cognoscere **nie** używa Redis ani Qdrant; backend to **FastAPI** (port 8000 w sieci Dockera), frontend **Next.js**; ruch z internetu idzie **Caddy → nginx (edge) → Next / FastAPI**.

**Pliki:** katalog [`deploy/gcp/`](../deploy/gcp/) — `docker-compose.yml`, `nginx-edge.conf`, `Dockerfile.backend`, `Dockerfile.frontend`, `entrypoint-backend.sh`, wzór [`.env.example`](../deploy/gcp/.env.example). Pliku **`.env` nie commituj**.

## Bezpieczeństwo

- Nie commituj `deploy/gcp/.env`, root `.env`, `frontend/.env.local`.
- **Przed pierwszym `docker compose up`:** ustaw silne `BOOTSTRAP_ADMIN_PASSWORD` (i e-mail), jeśli używasz seedowania admina.
- **Cloud SQL:** model jak w przewodniku TeacherHelper — **Public IP** + **Authorized networks** (IP VM `/32`) lub później prywatny IP w VPC.

## Szybki plan

| Krok | Co robisz |
|------|-----------|
| 1 | Projekt GCP, billing, region (np. `europe-west1`) |
| 2 | VM (Ubuntu LTS) + firewall **22**, **80**, **443** |
| 3 | Cloud SQL PostgreSQL — baza, użytkownik, dostęp z VM |
| 4 | Na VM: Docker + Compose, `deploy/gcp/.env`, `docker compose up -d` |
| 5 | Caddy na hoście → `http://127.0.0.1:8080` |
| 6 | Test: strona w przeglądarce, `GET /api/health` |

Szczegóły kroków **0–3** (konsola GCP, Cloud SQL, SSH) — w oryginalnym dokumencie [GCP_KROK_PO_KROKU.md (TeacherHelper)](https://github.com/fifmazurkiewicz/TeacherHelper/blob/main/docs/GCP_KROK_PO_KROKU.md); podstaw nazwę bazy / użytkownika (**cognoscere**) i `DATABASE_URL` jak w [`deploy/gcp/.env.example`](../deploy/gcp/.env.example).

## `FRONTEND_URL` i adres w przeglądarce

Backend (CORS) przyjmuje **`FRONTEND_URL`** dokładnie tak, jak użytkownik otwiera aplikację (scheme + host, **bez** końcowego `/`):

- `http://203.0.113.10`
- `https://twoja.domena.pl`

## Docker na VM

Po SSH na instancję (instalacja Dockera jak w przewodniku TeacherHelper — ETAP 4):

```bash
cd ~
git clone <twoje-repo-cognoscere>.git
cd cognoscere/deploy/gcp
cp -n .env.example .env
chmod 600 .env
# Edytuj .env: DATABASE_URL, SECRET_KEY, OPENROUTER_API_KEY, FRONTEND_URL, BOOTSTRAP_ADMIN_*
docker compose --env-file .env build
docker compose --env-file .env up -d
docker compose ps
```

- **Migracje:** przy starcie backendu uruchamiany jest `alembic upgrade head` (`entrypoint-backend.sh`).
- **Port z hosta:** tylko **127.0.0.1:8080** (nginx „edge”). Z internetu wchodzisz przez **Caddy** na **80/443**.

## Caddy na VM (ETAP 5)

Jak w TeacherHelper: zainstaluj Caddy, w `/etc/caddy/Caddyfile` ustaw `reverse_proxy 127.0.0.1:8080` (HTTP na `:80` lub HTTPS z domeną). Wzorzec: [`deploy/gcp/Caddyfile.host.example`](../deploy/gcp/Caddyfile.host.example).

## Testy

1. Strona główna (Next.js).
2. `https://twoja-domena/api/health` lub `http://IP/api/health` — JSON ze statusem API.
3. Logowanie / rejestracja — sprawdź `FRONTEND_URL` przy błędach CORS.

**Diagnoza**

- `docker compose logs backend` — PostgreSQL, Alembic, OpenRouter.
- **502** — Caddy nie widzi `127.0.0.1:8080` (Compose nie działa).
- **CORS** — `FRONTEND_URL` musi być zgodny z originem przeglądarki.

## Aktualizacja kodu na VM

```bash
cd ~/cognoscere
git pull
cd deploy/gcp
docker compose --env-file .env build
docker compose --env-file .env up -d
```

Nowe migracje zastosują się przy starcie backendu po `up -d`.
