# Cognoscere

Aplikacja wspierająca psychoterapię poprzez ustrukturyzowany dialog terapeutyczny między sesjami.

## Wymagania

- Python 3.12+
- [Poetry](https://python-poetry.org/docs/#installation) (zarządzanie zależnościami backendu)
- Node.js 20+
- **PostgreSQL** (14+) — instalacja na Windowsie, baza w chmurze (Neon, Supabase itd.) albo **opcjonalnie** kontener z `docker-compose.yml`

---

## Uruchomienie lokalne

### 1. Skopiuj plik środowiskowy i uzupełnij wartości

PowerShell / CMD: `copy .env.example .env` — na Linux/macOS: `cp .env.example .env`.

| Zmienna | Co wpisać |
|---|---|
| `DATABASE_URL` | `postgresql+asyncpg://USER:HASŁO@HOST:5432/BAZA` — musi wskazywać na **działający PostgreSQL**. Utwórz wcześniej pustą bazę (np. `cognoscere`). |
| `SECRET_KEY` | np. `python -c "import secrets; print(secrets.token_hex(32))"` |
| `OPENROUTER_API_KEY` | [OpenRouter](https://openrouter.ai) — domyślnie Llama 3.1 8B przez Groq |
| `BOOTSTRAP_ADMIN_*` | opcjonalnie: pierwszy administrator po migracji |

### 2. PostgreSQL bez Dockera

- **Windows:** [instalator PostgreSQL](https://www.postgresql.org/download/windows/). Musi istnieć **baza o nazwie z `DATABASE_URL`** (domyślnie `cognoscere`). Jeśli widzisz błąd *database "cognoscere" does not exist*, utwórz ją:
  - **SQL Shell (psql)** z menu Start → połącz się jako `postgres` → wykonaj:  
    `CREATE DATABASE cognoscere;`
  - albo **pgAdmin** → PPM na *Databases* → *Create* → *Database* → nazwa `cognoscere`.
  - z linii poleceń (hasło użytkownika `postgres` z instalacji):  
    `"C:\Program Files\PostgreSQL\16\bin\psql.exe" -U postgres -h localhost -c "CREATE DATABASE cognoscere;"`  
    (numer folderu `16` zmień na swoją wersję).
- **Chmura:** w panelu utwórz projekt/bazę; często nazwa bazy jest nadana automatycznie — **skopiuj dokładny connection string** do `DATABASE_URL` (nie musi nazywać się `cognoscere`).

Docker **nie jest wymagany** — `docker-compose.yml` jest tylko opcją.

### 3. Zainstaluj zależności backendu

```bash
poetry install --with dev
```

Środowisko: `.venv` w katalogu projektu (`poetry.toml`).

### 4. Migracje

W repozytorium jest **jedna** migracja początkowa (`0001_initial`): cały schemat (ENUM-y w tym `userrole`, `users` z limitami LLM, `emotion_sessions` z `patient_facing_analysis` itd.). Kolejne zmiany: `make migration msg="krótki_opis"`.

```bash
poetry run alembic upgrade head
```

Jeśli w `alembic_version` masz starą nazwę rewizji (np. po usuniętych plikach migracji) albo częściowo utworzone tabele — usuń obiekty w bazie lub utwórz pustą bazę i ponów `upgrade head`.

### 5. Backend

```bash
poetry run uvicorn app.main:app --reload --port 8000
```

http://localhost:8000 — dokumentacja: http://localhost:8000/docs

### 6. Frontend (drugi terminal)

PowerShell / CMD (z katalogu głównego projektu):

```powershell
cd frontend
copy .env.local.example .env.local
npm install
npm run dev
```

Linux / macOS:

```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Frontend: http://localhost:3000

---

## Komendy Make (skróty)

```bash
make up          # opcjonalnie: PostgreSQL z docker-compose
make down        # zatrzymaj kontenery Dockera
make install     # poetry + npm w frontend
make migrate     # alembic upgrade head
make backend     # uvicorn
make frontend    # next dev

make migration msg="nazwa_migracji"
```

---

## Struktura projektu

```
cognoscere/
├── app/
│   ├── main.py
│   ├── domain/                 # typy domenowe (np. role)
│   ├── application/            # JWT, bootstrap admina
│   ├── infrastructure/       # config, baza, ORM, OpenRouter (LLM)
│   └── presentation/         # API FastAPI, schematy Pydantic
├── alembic/
├── frontend/                 # Next.js 15 (app/, lib/, components/)
├── docker-compose.yml        # opcjonalnie: PostgreSQL w kontenerze
├── pyproject.toml            # Poetry — zależności i metadane
├── poetry.lock               # zablokowane wersje (generuje Poetry)
└── .env.example
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
| Auth | JWT (python-jose) + bcrypt |
| AI dialog | OpenRouter + klient OpenAI SDK; domyślnie model na infrastrukturze **Groq** (Llama 3.1 8B) |
| Frontend | Next.js 15 + TypeScript + Tailwind CSS |
| Panel admina | REST `/api/admin/*` (statystyki, użytkownicy, limity LLM, reset hasła, role) |
