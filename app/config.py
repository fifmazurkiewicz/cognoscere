from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # Baza danych
    database_url: str

    # Redis
    redis_url: str = "redis://localhost:6379"

    # JWT
    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    # Anthropic (Claude) — wymagane do sesji terapeutycznych
    anthropic_api_key: str = ""

    # Groq (Whisper) — wymagane do transkrypcji głosu
    groq_api_key: str = ""

    # Email (Resend) — wymagane do powiadomień kryzysowych
    resend_api_key: str = ""
    from_email: str = "noreply@cognoscere.app"

    # Aplikacja
    app_name: str = "Cognoscere"
    debug: bool = False
    frontend_url: str = "http://localhost:3000"


settings = Settings()
