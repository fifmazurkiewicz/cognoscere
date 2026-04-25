# Cognoscere na Google Cloud — przewodnik krok po kroku

Wdrożenie: **Cloud SQL (PostgreSQL) + jedna lub więcej VM z Ubuntu + Docker Compose + Caddy na hoście**. Ruch: **internet → Caddy (:80 / :443) → nginx „edge” na `127.0.0.1:8080` → Next.js / FastAPI**.

Wzorowane na [TeacherHelper — GCP Krok po kroku](https://github.com/fifmazurkiewicz/TeacherHelper/blob/main/docs/GCP_KROK_PO_KROKU.md). **Różnice względem TeacherHelper:** Cognoscere **nie** używa Redis ani Qdrant; backend to **FastAPI** (w sieci Dockera port **8000**); frontend **Next.js** (port **3000** wewnątrz Compose).

**Pliki w repozytorium:** [`deploy/gcp/`](../deploy/gcp/) — `docker-compose.yml`, `nginx-edge.conf`, `Dockerfile.backend`, `Dockerfile.frontend`, `entrypoint-backend.sh`, [`Caddyfile.host.example`](../deploy/gcp/Caddyfile.host.example) (przykład z `cognoscere.duckdns.org` — podmień host na swój), wzór [`.env.example`](../deploy/gcp/.env.example). W root jest [`README.md`](../README.md) wymagany przez Poetry przy budowaniu obrazu backendu; w [`frontend/public/`](../frontend/public/) leży katalog publiczny Next (w tym `.gitkeep`) — potrzebny do `Dockerfile.frontend`. Plików **`.env` nie commituj** (ani root `.env`, ani `frontend/.env.local`).

W repozytorium jest też [`frontend/eslint.config.mjs`](../frontend/eslint.config.mjs) (lint przy `next build`); w obrazie frontendu używane jest **Alpine** z pakietem `libc6-compat` i zwiększonym limitem pamięci na czas `npm run build` — opis w [`Dockerfile.frontend`](../deploy/gcp/Dockerfile.frontend).

---

## Architektura (skrót)

| Warstwa | Rola |
|--------|------|
| **Caddy** (zainstalowany na VM, poza Dockerem) | TLS (opcjonalnie), reverse proxy do `127.0.0.1:8080` |
| **Kontener `edge` (nginx)** | `/` → frontend; `/api/` → backend (patrz `nginx-edge.conf`) |
| **Backend** | FastAPI, migracje Alembic przy starcie (`entrypoint-backend.sh`) |
| **Cloud SQL** | PostgreSQL; aplikacja łączy się przez `DATABASE_URL` |

Port **8080** na hoście jest zbindowany tylko do **127.0.0.1** — z internetu nie wchodzisz na 8080, tylko na **80/443** przez Caddy.

---

## Krok 0 — Projekt GCP, rozliczenia, region

1. Wejdź w [Google Cloud Console](https://console.cloud.google.com/).
2. U góry wybierz lub utwórz **projekt**.
3. Włącz **rozliczenia** (Billing) dla projektu — bez tego nie uruchomisz VM ani Cloud SQL w typowy sposób.
4. Wybierz **region** na start (np. `europe-west1` w Belgii) i trzymaj spójność: VM i Cloud SQL w tym samym regionie zwykle daje niższe opóźnienia.

---

## Krok 1 — Sieć VPC (ważne: nie myl z adresem VM)

**Tworząc podsieć (subnet), pole „IP range” to zakres PRYWATNY**, np. `10.0.0.0/24` lub `10.128.0.0/20` — **nie** wpisujesz tu publicznego IP VM (np. `34.x.x.x`).

- **Publiczny IP VM** (np. `34.7.179.113`) przydziela GCP do interfejsu instancji; służy do SSH i ruchu HTTP z internetu.
- **Zakres podsieci** to wewnętrzna adresacja VPC (RFC 1918).

Jeśli nie potrzebujesz własnej niestandardowej sieci, możesz użyć **domyślnej VPC** (`default`) przy tworzeniu VM i pominąć ręczne definiowanie „New network”.

**Wiele VM do jednej Cloud SQL:** przy **publicznym IP** bazy w **Authorized networks** dodajesz **każde** zewnętrzne IP VM jako `/32` (albo jeden wspólny adres wyjścia, jeśli używasz Cloud NAT). Przy **private IP** Cloud SQL i VM w tej samej VPC konfiguracja opiera się o firewall VPC, a nie o listę „authorized networks” w tym samym sensie co przy publicznym IP.

---

## Krok 2 — Reguły firewall (VPC → Firewalls)

Musisz pozwolić na ruch **do VM**:

| Port | Protokół | Cel |
|------|----------|-----|
| **22** | TCP | SSH |
| **80** | TCP | HTTP (Caddy) |
| **443** | TCP | HTTPS (Caddy, jeśli używasz TLS) |

Typowo tworzysz reguły typu „allow tcp:22,80,443” dla tagów sieciowych przypiętych do VM (np. `http-server`, `https-server`) albo dla zakresu źródłowego `0.0.0.0/0` na czas testów — **ogranicz SSH** do swojego IP, gdy już wszystko działa.

**Nie** otwieraj publicznie portu **8080** — nginx edge ma być dostępny tylko lokalnie z hosta (`127.0.0.1:8080` w `docker-compose.yml`).

---

## Krok 3 — Maszyna wirtualna (Compute Engine)

1. **Compute Engine → VM instances → Create instance.**
2. **Nazwa:** dowolna (np. `cognoscere-vm`).
3. **Region / zone:** zgodnie z Krokem 0 (np. `europe-west1-b`).
4. **Obraz:** **Ubuntu LTS** (np. 22.04 lub 24.04).
5. **Maszyna:** np. `e2-medium` lub mocniejsza, jeśli budujesz obrazy Dockera na VM.
6. **Dysk:** domyślny rozmiar wystarczy na start; ewentualnie zwiększ, jeśli planujesz duże obrazy.
7. **Firewall:** zaznacz opcje pozwalające na HTTP/HTTPS, jeśli kreator to oferuje, **albo** dodaj własne reguły jak w Kroku 2.
8. **Klucz SSH / dostęp:** dodaj swój klucz publiczny lub użyj mechanizmu OS Login — zapisz, jak łączysz się do instancji (`ssh user@EXTERNAL_IP`).
9. Po utworzeniu zanotuj **External IP** — przyda się do SSH, ewentualnie do tymczasowego `FRONTEND_URL=http://TWÓJ_IP` oraz do **Cloud SQL → Authorized networks**.

---

## Krok 4 — Cloud SQL (PostgreSQL)

1. **SQL → Create instance → PostgreSQL.**
2. **Instance ID:** np. `cognoscere-db`.
3. **Hasło użytkownika „postgres” (root):** zapisz w menedżerze haseł (do pierwszej konfiguracji; aplikacja może używać osobnego użytkownika).
4. **Region:** ten sam co VM (zalecane).
5. **Public IP:** włącz, jeśli idziesz ścieżką z **Authorized networks** (prostszy start). **Private IP** — opcja na później, wymaga VPC.
6. Po utworzeniu instancji:
   - **Databases → Create database** — nazwa: **`cognoscere`** (zgodnie z `.env.example`).
   - **Users → Add user account** — np. użytkownik **`cognoscere`** z silnym hasłem (uprawnienia do bazy `cognoscere`).
7. **Connections → Networking → Authorized networks → Add network:**
   - **Name:** np. `vm-cognoscere`.
   - **Network:** **zewnętrzne IP VM w notacji `/32`**, np. `34.7.179.113/32`.  
     To **nie** jest pole „IP range” nowej podsieci VPC — to wyłącznie lista adresów, z których Cloud SQL przyjmie połączenia na **publicznym** IP.
8. Zapisz **publiczny adres połączenia** instancji (host) — użyjesz go w `DATABASE_URL`.

**Format `DATABASE_URL` (asyncpg):** patrz [`deploy/gcp/.env.example`](../deploy/gcp/.env.example):

```text
postgresql+asyncpg://cognoscere:HASLO@HOST_CLOUD_SQL:5432/cognoscere
```

Jeśli hasło zawiera znaki specjalne, **zakoduj je w URL** (URL encoding).

---

## Krok 5 — Pierwsze logowanie na VM i pakiety bazowe

Po SSH (np. `ssh twoj_user@EXTERNAL_IP`):

```bash
sudo apt update
sudo apt install -y git vim ca-certificates curl
```

**Git:** `sudo apt install -y git` — potrzebny do `git clone`.

Instalacja **Docker Engine** i wtyczki **Compose** — oficjalna instrukcja dla Ubuntu: [Install Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/). W skrócie (po dodaniu repozytorium Dockera według dokumentacji):

- zainstaluj pakiety `docker-ce`, `docker-ce-cli`, `containerd.io`, `docker-buildx-plugin`, `docker-compose-plugin`;
- opcjonalnie: `sudo usermod -aG docker "$USER"` i **ponowne logowanie SSH**, albo w tej samej sesji `newgrp docker` — inaczej zobaczysz `permission denied` na `/var/run/docker.sock` i używasz `sudo docker compose ...`.

Sprawdzenie:

```bash
docker --version
docker compose version
```

---

## Krok 6 — Klonowanie repozytorium i plik `.env`

```bash
cd ~
git clone https://github.com/<twoje-repo-cognoscere>.git
cd cognoscere/deploy/gcp
cp -n .env.example .env
chmod 600 .env
vim .env
```

**Uzupełnij w `.env` (minimum):**

| Zmienna | Znaczenie |
|---------|-----------|
| `DATABASE_URL` | Pełny URL do Cloud SQL (jak wyżej). |
| `DATABASE_SSL` | Ustaw `true` na GCP — połączenia z publicznym IP do Cloud SQL zwykle **wymagają SSL**; bez tego bywa `TimeoutError` w Alembic/asyncpg. |
| `SECRET_KEY` | Losowy sekret JWT (np. `openssl rand -hex 32`). |
| `OPENROUTER_API_KEY` | Klucz API OpenRouter (wymagany do funkcji LLM). |
| `FRONTEND_URL` | **Dokładnie** origin z paska przeglądarki: `https://twoja.domena` lub `http://IP` lub `https://twoj.duckdns.org` — **bez** końcowego `/`. |
| `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` | Opcjonalnie pierwszy admin przy starcie; ustaw **silne** hasło przed pierwszym `up`. |

**`NEXT_PUBLIC_API_URL`:** zwykle **puste** na produkcji — frontend woła `/api` na tym samym hoście co strona (nginx kieruje `/api/` do backendu). Ustawiasz tylko wtedy, gdy świadomie rozdzielasz host frontu i API.

---

## Krok 7 — Build i start kontenerów

Z katalogu `cognoscere/deploy/gcp` (z `sudo`, jeśli nie masz grupy `docker`):

```bash
docker compose --env-file .env build
docker compose --env-file .env up -d
docker compose ps
```

**Pierwszy build** może trwać kilka minut. Gdy zmieniasz pliki związane z Dockerem albo `git pull` nie odświeża warstw, użyj `docker compose --env-file .env build --no-cache` (lub tylko `... build --no-cache frontend` / `backend`).

- **Migracje:** przy starcie backendu wykonywany jest `alembic upgrade head` (`entrypoint-backend.sh`).
- **Logi:** `docker compose logs -f backend` (baza, Alembic, błędy konfiguracji).

Jeśli backend nie może połączyć się z Cloud SQL, sprawdź: `DATABASE_URL`, **Authorized networks** (IP VM), firewall po stronie GCP, czy instancja SQL jest **uruchomiona**.

**Caddy** musi być skonfigurowany **po** działającym Compose — inaczej `127.0.0.1:8080` zwróci 502. Plik na hoście: `/etc/caddy/Caddyfile` (edycja: `sudo vim` / `sudo nano`); zwykły użytkownik nie zapisze go przez `permission denied` (`E45` w vimie).

---

## Krok 8 — Caddy na hoście VM (reverse proxy)

Caddy odbiera ruch z internetu i przekazuje go do nginx edge na **`127.0.0.1:8080`** (Compose musi już działać).

1. Zainstaluj Caddy według [oficjalnej instrukcji](https://caddyserver.com/docs/install) dla Ubuntu/deb.
2. Edytuj `/etc/caddy/Caddyfile`. Wzór: [`deploy/gcp/Caddyfile.host.example`](../deploy/gcp/Caddyfile.host.example).

**Tylko HTTP (np. test po IP):**

```caddy
:80 {
	reverse_proxy 127.0.0.1:8080
}
```

**HTTPS z domeną (np. DuckDNS):** blok z nazwą hosta — Caddy może sam wystawić certyfikat (Let’s Encrypt), o ile DNS **A** wskazuje na IP VM i port **443** jest otwarty. W repozytorium przykład używa hosta `cognoscere.duckdns.org`; podmień na własny:

```caddy
cognoscere.duckdns.org {
	reverse_proxy 127.0.0.1:8080
}
```

3. Walidacja i restart:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Po włączeniu **HTTPS** ustaw w `.env` **`FRONTEND_URL=https://twoj-host.duckdns.org`**, przebuduj / zrestartuj stack, jeśli backend wczytuje to tylko przy starcie:

```bash
docker compose --env-file .env up -d --force-recreate backend
```

(sprawdź w praktyce, czy wystarczy sam restart backendu po zmianie `FRONTEND_URL`.)

---

## Krok 9 — Testy końcowe

1. **Strona główna:** `https://twoja-domena/` lub `http://TWÓJ_IP/` — powinien załadować się Next.js.
2. **API:** `https://twoja-domena/api/health` lub `http://TWÓJ_IP/api/health` — odpowiedź JSON (health).
3. **Logowanie / rejestracja:** jeśli przeglądarka zgłasza **CORS**, `FRONTEND_URL` nie zgadza się z rzeczywistym originem (inny host, `http` vs `https`, końcowy `/` w zmiennej).

---

## Rozwiązywanie problemów

| Objaw | Co sprawdzić |
|-------|----------------|
| `permission denied` / `docker.sock` | Grupa `docker` + nowa sesja SSH, albo `sudo docker compose ...`. |
| **502 Bad Gateway** z Caddy | Czy `docker compose ps` pokazuje **Up**; czy `curl -sS http://127.0.0.1:8080/api/health` na VM zwraca JSON (nie *connection refused*). |
| **Connection refused** na 8080 z zewnątrz | To OK — 8080 tylko na localhost; ruch z internetu idzie na 80/443. |
| Build backendu: `Readme path ... README.md does not exist` | Obraz wymaga [`README.md`](../README.md) w kontekście (kopiowane w `Dockerfile.backend`); `git pull` do aktualnego repozytorium. |
| Build frontendu: *webpack errors* / problemy na Alpine | Zaktualizuj repozytorium (`eslint.config.mjs`, `libc6-compat` w Dockerfile); ewentualnie `build --no-cache`. |
| Build frontendu: `"/app/public": not found` | W projekcie musi istnieć `frontend/public/` (w repozytorium jest m.in. `.gitkeep`); w Dockerfile jest też `mkdir -p public` przed `npm run build`. |
| **Błąd połączenia z PostgreSQL** / `TimeoutError` w `alembic` | `DATABASE_URL` (host = **publiczny** adres instancji z konsoli), **Authorized networks** = IP VM `/32`, hasło, URL encoding. Ustaw **`DATABASE_SSL=true`** w `deploy/gcp/.env` (Cloud SQL + public IP). |
| **CORS** | `FRONTEND_URL` = dokładnie scheme + host jak w pasku adresu. |
| Ostrzeżenie Caddy przy `validate` o HTTP bez HTTPS | Często znika po samej domenie w `Caddyfile` i restarcie; w `journalctl` szukaj sukcesu `certificate obtained` albo błędów ACME. |
| **Migracje** | Logi `backend`; przy **wielu VM** nie odpalaj równolegle migracji z obu — jedna instancja lub CI. |

---

## Aktualizacja aplikacji na VM

```bash
cd ~/cognoscere
git pull
cd deploy/gcp
docker compose --env-file .env build
docker compose --env-file .env up -d
```

Nowe migracje Alembic zastosują się przy następnym starcie backendu po `up -d`.

---

## Bezpieczeństwo — checklist

- Nie commituj `deploy/gcp/.env`, root `.env`, `frontend/.env.local`.
- Silne `BOOTSTRAP_ADMIN_PASSWORD` przed pierwszym produkcyjnym uruchomieniem.
- Ogranicz **SSH** do zaufanego zakresu IP, gdy skończysz konfigurację.
- Trzymaj **Cloud SQL** i VM w **aktualnych** wersjach; rotuj sekrety po wycieku.
