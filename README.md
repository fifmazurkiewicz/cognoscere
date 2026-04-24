# Cognoscere

Aplikacja wspierająca psychoterapię poprzez ustrukturyzowany dialog terapeutyczny między sesjami.

## Wymagania

- Python 3.12+
- Node.js 20+
- Docker i Docker Compose

---

## Uruchomienie lokalne

### 1. Skopiuj plik środowiskowy i uzupełnij wartości

```bash
cp .env.example .env
```

Minimalne wymagane wartości do lokalnego uruchomienia:

| Zmienna | Co wpisać |
|---|---|
| `DATABASE_URL` | zostaw domyślną (pasuje do docker-compose) |
| `REDIS_URL` | zostaw domyślną |
| `SECRET_KEY` | wygeneruj: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `ANTHROPIC_API_KEY` | potrzebny do sesji AI — pobierz z console.anthropic.com |
| `OPENAI_API_KEY` | potrzebny do voice — pobierz z platform.openai.com |

### 2. Uruchom bazę danych i Redis

```bash
docker-compose up -d
```

Sprawdź że kontenery działają:
```bash
docker-compose ps
```

### 3. Zainstaluj zależności backendu

```bash
pip install -e ".[dev]"
```

### 4. Wykonaj migracje bazy danych

```bash
# Wygeneruj pierwszą migrację (jednorazowo)
alembic revision --autogenerate -m "initial"

# Zastosuj migracje
alembic upgrade head
```

### 5. Uruchom backend

```bash
uvicorn app.main:app --reload --port 8000
```

Backend dostępny pod: http://localhost:8000
Dokumentacja API (Swagger): http://localhost:8000/docs

### 6. Zainstaluj zależności frontendu (nowy terminal)

```bash
cd frontend
cp .env.local.example .env.local
npm install
```

### 7. Uruchom frontend

```bash
cd frontend
npm run dev
```

Frontend dostępny pod: http://localhost:3000

---

## Komendy Make (skróty)

```bash
make up          # uruchom PostgreSQL + Redis w tle
make down        # zatrzymaj kontenery
make install     # zainstaluj zależnosci backendu i frontendu
make migrate     # zastosuj migracje (alembic upgrade head)
make backend     # uruchom backend (port 8000)
make frontend    # uruchom frontend (port 3000)

# Nowa migracja po zmianie modeli:
make migration msg="nazwa_migracji"
```

---

## Struktura projektu

```
cognoscere/
├── app/                        # Backend FastAPI
│   ├── main.py                 # Punkt wejscia aplikacji
│   ├── config.py               # Konfiguracja z .env
│   ├── database.py             # Polaczenie z PostgreSQL (async)
│   ├── models/                 # Modele SQLAlchemy
│   │   ├── user.py             # Uzytkownicy (terapeuta/pacjent)
│   │   └── invitation.py       # Zaproszenia dla pacjentow
│   ├── schemas/                # Schematy Pydantic (walidacja)
│   │   └── auth.py
│   ├── services/               # Logika biznesowa
│   │   └── auth.py             # JWT, bcrypt
│   └── routers/                # Endpointy API
│       ├── auth.py             # /api/auth/*
│       └── deps.py             # Zaleznosci FastAPI (get_current_user)
├── alembic/                    # Migracje bazy danych
│   ├── env.py
│   └── versions/               # Pliki migracji (generowane automatycznie)
├── frontend/                   # Frontend Next.js 15
│   ├── app/
│   │   ├── login/page.tsx      # Strona logowania
│   │   ├── register/page.tsx   # Rejestracja terapeuty / pacjenta przez token
│   │   └── dashboard/page.tsx  # Dashboard po zalogowaniu
│   └── lib/
│       ├── api.ts              # Klient HTTP z auto-refresh tokenow
│       └── auth.ts             # Obs. tokenow JWT w localStorage
├── docker-compose.yml          # PostgreSQL 16 + Redis 7
├── pyproject.toml              # Projekt Python + zaleznosci
├── alembic.ini                 # Konfiguracja Alembic
├── Makefile                    # Skroty polecen
└── .env.example                # Szablon zmiennych srodowiskowych
```

---

## API - dostepne endpointy

| Metoda | Sciezka | Opis | Autoryzacja |
|---|---|---|---|
| GET | `/api/health` | Status backendu | - |
| POST | `/api/auth/register/therapist` | Rejestracja terapeuty | - |
| POST | `/api/auth/login` | Logowanie | - |
| POST | `/api/auth/refresh` | Odswiezenie tokenu | - |
| GET | `/api/auth/me` | Dane zalogowanego uzytkownika | JWT |
| POST | `/api/auth/invite` | Generowanie zaproszenia dla pacjenta | JWT (terapeuta) |
| GET | `/api/auth/invite/{token}` | Weryfikacja tokenu zaproszenia | - |
| POST | `/api/auth/register/patient` | Rejestracja pacjenta przez token | - |

Pelna dokumentacja z przykladami: http://localhost:8000/docs

---

## Stack technologiczny

| Warstwa | Technologia |
|---|---|
| Backend | Python 3.12 + FastAPI |
| Baza danych | PostgreSQL 16 (async przez asyncpg) |
| ORM + migracje | SQLAlchemy 2.0 + Alembic |
| Cache | Redis 7 |
| Auth | JWT (python-jose) + bcrypt (passlib) |
| AI dialog | Anthropic Claude API |
| Transkrypcja glosu | OpenAI Whisper API |
| Frontend | Next.js 15 + TypeScript + Tailwind CSS |
| Email | Resend |
