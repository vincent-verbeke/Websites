
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "Kubotics Autonomous Platform API"
    VERSION: str = "0.1.0"
    API_V1_STR: str = "/api/v1"
    
    # Environment
    ENVIRONMENT: str = "development" # "development" | "production"
    DEBUG: bool = True
    
    # Server Binding
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    
    # CORS
    CORS_ORIGINS: list[str] = [
        "https://kubotics.ch",
        "https://www.kubotics.ch",
        "http://kubotics.ch",
        "http://www.kubotics.ch",
        "https://qbotics.ch",
        "https://www.qbotics.ch",
        "http://qbotics.ch",
        "http://www.qbotics.ch",
        "http://localhost:4200",
        "http://127.0.0.1:4200",
    ]
    
    # PostgreSQL Database
    POSTGRES_SERVER: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "kubotics"
    POSTGRES_SCHEMA: str = "crm"
    DATABASE_URL: str | None = None
    
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        if self.DATABASE_URL:
            # Normalize scheme if standard postgresql:// or postgres:// is passed
            uri = self.DATABASE_URL
            if uri.startswith("postgresql://"):
                uri = uri.replace("postgresql://", "postgresql+asyncpg://", 1)
            elif uri.startswith("postgres://"):
                uri = uri.replace("postgres://", "postgresql+asyncpg://", 1)
            return uri
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )
        
    # Microsoft 365 Tenant / Graph API
    M365_TENANT_ID: str = ""
    M365_CLIENT_ID: str = ""
    M365_CLIENT_SECRET: str = ""
    M365_ORGANIZER_EMAIL: str = "vincent@kubotics.ch"
    
    # Cloud LLM APIs
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    GROQ_API_KEY: str = ""

    # ElevenLabs TTS (Configured for Eleven Turbo v2.5 / v4 Turbo ~100ms latency)
    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_VOICE_ID: str = "21m00Tcm4TlvDq8ikWAM"
    ELEVENLABS_MODEL_ID: str = "eleven_turbo_v2_5"

    # Telegram
    TELEGRAM_BOT_TOKEN: str = ""
    
    # Security & API Auth
    API_SECRET_KEY: str = "change-this-in-production-use-aws-secrets-manager"

    # needle3 orchestrator intake
    NEEDLE_TOKEN: str = ""
    NEEDLE_OPERATOR_SENDERS: str = "+41797481975"

    # --- Cloud trading watcher (Vincent-authorized 2026-11-01; full docs in
    #     docs/TRADING_WATCH_CLOUD.md) -------------------------------------
    # Binance credentials are READ-ONLY usage only (the watcher signs GET
    # endpoints exclusively; it can never place an order — see service
    # docstring). Injected via .aws/task-definition.json (repo is private).
    BINANCE_API_KEY: str = ""
    BINANCE_API_SECRET: str = ""
    TRADING_WATCH_ENABLED: bool = True
    TRADING_WATCH_INTERVAL_S: int = 600
    TRADING_WATCH_ALERT_COOLDOWN_S: int = 7200
    TRADING_WATCH_SMS_ENABLED: bool = False
    TRADING_WATCH_SMS_TO: str = "+41797481975"
    # expected open perp symbols (drift = alert); current live book 2026-11-01
    TRADING_WATCH_EXPECTED_PERP: str = (
        "AGTUSDT,AKEUSDT,BTWUSDT,BULLAUSDT,CHRUSDT,DYDXUSDT,INITUSDT,"
        "JCTUSDT,MUBARAKUSDT,PEOPLEUSDT,QUSDT,SFPUSDT,UNIUSDC"
    )

    # --- B5 spend caps + approval (docs §19; §6 hard boundary) ---
    SPEND_TOTAL_CAP_CHF: float = 100.0        # per calendar month, all channels
    SPEND_SEARCH_CAP_CHF: float = 70.0        # google search sub-cap
    SPEND_APPROVAL_PHRASE: str = "APPROVE-SPEND"  # typed by Vincent in the UI

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="allow",
    )


settings = Settings()
