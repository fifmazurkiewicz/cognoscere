from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    database_url: str

    secret_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30

    openrouter_api_key: str = ""
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    openrouter_model: str = "meta-llama/llama-3.1-8b-instruct"
    openrouter_provider_order: str = "Groq"
    openrouter_http_referer: str = ""
    openrouter_app_title: str = "Cognoscere"

    app_name: str = "Cognoscere"
    debug: bool = False
    # Logi SQL w konsoli — wyłączone domyślnie; włącz: SQLALCHEMY_ECHO=true
    sqlalchemy_echo: bool = False
    frontend_url: str = "http://localhost:3000"

    bootstrap_admin_email: str = ""
    bootstrap_admin_password: str = ""


settings = Settings()


def llm_configured() -> bool:
    return bool((settings.openrouter_api_key or "").strip())
