
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
    # needle3-inbox watchdog (Vincent 2026-11-27: "cannot trust our system ...
    # when i am visiting customers"). Cloud-side staleness alerts while
    # needle3.service on PC-A is down - see services/needle_watchdog.py.
    NEEDLE_WATCHDOG_ENABLED: bool = True   # alert-only; never touches queue rows
    NEEDLE_WATCHDOG_TICK_S: int = 120
    NEEDLE_WATCHDOG_STALE_AFTER_S: int = 600          # status=new unclaimed
    NEEDLE_WATCHDOG_DISPATCHED_AFTER_S: int = 2700    # claimed, no reply (30-min task limit + margin)

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

    # --- Binance Executor (Vincent GO 2026-11-28: “call it Binance Executor
    #     from now on … ensure we do live trading, not paper trading and port
    #     it to the backend”; port of the “Beat the Market” challenge stack
    #     carry + momentum). Risk rails are Vincent's and NEVER widened. ---
    BINANCE_EXECUTOR_ENABLED: bool = False       # loop off until task-def GO
    BINANCE_EXECUTOR_DRY_RUN: bool = True        # True = log-only, no orders
    BINANCE_EXECUTOR_CARRY_TICK_S: int = 3600
    BINANCE_EXECUTOR_MOMENTUM_TICK_S: int = 21600   # 4h, aligns with reviews
    BINANCE_EXECUTOR_CARRY_BUDGET_USD: float = 4000.0   # 2026-11-12 sizing
    BINANCE_EXECUTOR_CARRY_ALLOC_PCT: float = 0.50
    BINANCE_EXECUTOR_CARRY_TOP_N: int = 10
    BINANCE_EXECUTOR_MOMENTUM_NOTIONAL_USD: float = 12.5  # rotate precedent
    BINANCE_EXECUTOR_MOMENTUM_TOP_N: int = 10
    BINANCE_EXECUTOR_DAILY_STOP_PCT: float = 0.005   # 0.5% of budget/day
    BINANCE_EXECUTOR_DRAWDOWN_HALT_PCT: float = 0.20
    BINANCE_EXECUTOR_FUNDING_EXIT_STREAK: int = 3
    BINANCE_EXECUTOR_STOP: bool = False           # cloud kill switch

    # --- B5 spend caps + approval (docs §19; §6 hard boundary) ---
    # Raised 26 Nov 2026 by Vincent (WhatsApp #145 "agree to Google Budget"):
    # total 100 -> 105 (31-day months at CHF 3.30/day = 102.30), search 70 -> 100
    # (both Google campaigns = ~CHF 99-102/mo planned spend).
    SPEND_TOTAL_CAP_CHF: float = 105.0        # per calendar month, all channels
    SPEND_SEARCH_CAP_CHF: float = 100.0       # google search sub-cap
    SPEND_APPROVAL_PHRASE: str = "APPROVE-SPEND"  # typed by Vincent in the UI

    # --- Conversion targets (Vincent 26 Nov 2026: "set conversion targets
    # for Google ads and Meta") — PROPOSED defaults pending his confirmation,
    # env-overridable; evaluated by GET /api/v1/campaigns/targets and used as
    # the platform-side target CPA when the campaigns are created via API ---
    TARGET_CPL_CHF: float = 40.0              # max cost per lead (CHF)
    TARGET_WEEKLY_LEADS: int = 5              # min leads per rolling 7 days
    TARGET_WEEKLY_MEETINGS: int = 2           # min meetings per rolling 7 days

    # --- IBKR MCP connector (docs/IBKR_MCP_BACKEND.md; Vincent 2026-11-14) ---
    # Master switch: default False => no poller starts and every /api/v1/ibkr/*
    # endpoint answers 503 "not configured" — today's stable behavior untouched.
    IBKR_MCP_ENABLED: bool = False
    # Public HTTPS callback the phone browser returns to AFTER IBKR consent.
    # Must be registered as a redirect URI for IBKR_MCP_CLIENT_ID at IBKR.
    # Empty => treated as "not configured" (same inert behavior as disabled).
    IBKR_MCP_REDIRECT_URI: str = ""
    # Public OAuth client registered 2026-11-08 (proven by the dev-PC helpers).
    IBKR_MCP_CLIENT_ID: str = "ba3ab3ee-3468-442b-8183-113e7d777dae"
    # Scope of the proven login/reauth flows — kept 1:1 (read-only enforcement
    # happens at the tool allowlist level in services/ibkr_mcp.py, never here).
    IBKR_MCP_SCOPE: str = (
        "openid profile email account-ids mcp.read mcp.write mcp.orders.submit"
    )
    # Backend poll cadence: one read-only burst per interval (dev-PC feed used 60s).
    IBKR_MCP_POLL_INTERVAL_S: int = 60
    # RFC 7591 dynamic client registration — OFF by default: the proven flow
    # reuses client ba3ab3ee (re-running DCR orphans clients, see docs).
    IBKR_MCP_DCR_ENABLED: bool = False
    # Empty => https://api.ibkr.com/oauth2/register (VERIFIED 2026-11-25 via
    # /.well-known/oauth-authorization-server registration_endpoint — docs §7;
    # the old {ISSUER}/oauth2/api/v1/clients guess answered 404).
    IBKR_MCP_DCR_URL: str = ""
    # Phase 2a (docs/IBKR_MCP_BACKEND.md §10.7): daily IBKR plan runner in the
    # backend (gates → plan → reconcile → REVIEW_AND_APPROVE instructions →
    # state → WhatsApp, Mon-Fri 09:05-16:30 Europe/Zurich). Default OFF: no
    # task is registered and nothing runs (the dev-PC runner stays the sole
    # emitter until this is flipped). A successful run also needs the feed
    # flag above (MCP reads).
    IBKR_PLAN_DAILY_ENABLED: bool = False

    # --- Kubot mail agent (docs/KUBOT_MAIL_AGENT_PLAN.md §6) -------------
    # Master switch: False everywhere until Phase B (Liz test) is deployed.
    MAIL_AGENT_ENABLED: bool = False
    MAIL_AGENT_MODE: str = "auto"              # auto | observe (debug only)
    MAIL_AGENT_POLL_INTERVAL_S: int = 60
    MAIL_AGENT_UPN: str = ""                   # empty -> M365_ORGANIZER_EMAIL
    MAIL_AGENT_REPLY_WINDOW_DAYS: int = 7
    # Q2 answer: classify unknown senders; auto-answer real personal email, ignore spam
    MAIL_AGENT_UNKNOWN_POLICY: str = "auto"     # auto | ignore | notify
    # Q13 answer: reply openers (Dutch = mother tongue)
    MAIL_AGENT_LANGUAGES: str = "de-CH,en,fr,it,nl"
    # Q1 answer: extra own aliases; base set auto-discovered from Graph proxyAddresses (28 found)
    MAIL_AGENT_OWN_ADDRESSES: str = ""
    # LLM provider chain (Vincent 2026-11-08): Xiaomi MiMo Flash -> OpenAI -> Gemini -> Grok/xAI.
    # Keys arrive as GitHub secrets via deploy.yml; chain order + model IDs are
    # parameter/secret-overridable. All four are OpenAI-API-compatible.
    MAIL_AGENT_LLM_CHAIN: str = "mimo,openai,gemini,xai"
    MAIL_AGENT_LLM_MODEL_MIMO: str = "mimo-v2.6-flash"
    MAIL_AGENT_LLM_MODEL_OPENAI: str = ""
    MAIL_AGENT_LLM_MODEL_GEMINI: str = ""
    MAIL_AGENT_LLM_MODEL_XAI: str = ""
    MAIL_AGENT_LLM_BASE_MIMO: str = "https://api.xiaomimimo.com/v1"
    # Outlook contact category -> tier map (plan §4.1); empty -> all contacts tier "contact"
    MAIL_AGENT_TIER_MAP: str = ""
    # When set (comma list), ONLY these senders are ever replied to (Phase B: Liz;
    # doubles as emergency brake). Empty = normal contact/thread rules.
    MAIL_AGENT_ONLY_SENDERS: str = ""
    MAIL_AGENT_MAX_REPLIES_PER_DAY: int = 20
    MAIL_AGENT_CONVERSATION_COOLDOWN_H: int = 24
    MAIL_AGENT_SPAM_THRESHOLD: float = 0.80
    MAIL_AGENT_NOTIFY_PHONE: str = "+41797481975"
    # Q11 answer: WhatsApp alerts only 07:30-22:00 Europe/Zurich (outside -> queued;
    # email replies are unaffected, 24/7). Q6: cap-reached notice uses the same window.
    MAIL_AGENT_ALERT_WINDOW_START: str = "07:30"
    MAIL_AGENT_ALERT_WINDOW_END: str = "22:00"
    MAIL_AGENT_ALERT_TZ: str = "Europe/Zurich"

    # --- Lead follow-up state machine (docs/LEAD_FOLLOWUP_PLAN.md; Vincent
    #     2026-11-15) -------------------------------------------------------
    # Master switch: default False => maybe_start_followup_loop() returns None
    # => NO background task registers and NOTHING is ever drafted or sent
    # (same default-off contract as IBKR_MCP_* / IBKR_PLAN_DAILY_ENABLED /
    # MAIL_AGENT_*). The admin endpoints stay reachable and report
    # enabled=false so the wiring can be verified BEFORE the flag is flipped.
    LEAD_FOLLOWUP_ENABLED: bool = False
    # Hard sequence caps: <= 3 touches per lead (email -> whatsapp/telegram ->
    # email + booking link) and <= 25 sends per Europe/Zurich calendar day,
    # counted from `lead_followup_log` rows with status='ok'.
    LEAD_FOLLOWUP_MAX_TOUCHES: int = 3
    LEAD_FOLLOWUP_MAX_PER_DAY: int = 25
    # Quiet hours (Europe/Zurich, hour granularity): NO outbound follow-up
    # sends outside [QUIET_START, QUIET_END); due work waits for the window.
    LEAD_FOLLOWUP_QUIET_START: int = 8
    LEAD_FOLLOWUP_QUIET_END: int = 18
    # Deliberately NO LEAD_FOLLOWUP_EMAIL_FROM flag: outbound mail is sent from
    # the M365 organizer mailbox (M365_ORGANIZER_EMAIL -> m365_service's
    # organizer_email), so a duplicate from-address setting would only drift.

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="allow",
    )


settings = Settings()
