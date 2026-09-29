from __future__ import annotations

import os
import secrets
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str
    sensor_api_key: str
    cors_origins: list[str]
    session_secret: str
    default_empresa: str | None


def load_settings() -> Settings:
    origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173")

    session_secret = os.getenv("SESSION_SECRET", "").strip()
    if not session_secret:
        # Sem segredo no .env, gera um aleatório: as sessões caem a cada reinício do servidor.
        session_secret = secrets.token_urlsafe(32)
        print("AVISO: SESSION_SECRET não definido no .env; usando um segredo temporário.")

    return Settings(
        database_url=os.getenv(
            "DATABASE_URL",
            "mysql+pymysql://motor_user:troque_esta_senha@localhost:3306/motor_solutions?charset=utf8mb4",
        ),
        sensor_api_key=os.getenv("SENSOR_API_KEY", ""),
        cors_origins=[origin.strip() for origin in origins.split(",") if origin.strip()],
        session_secret=session_secret,
        # Empresa dona dos motores que forem criados automaticamente pelo ESP32 (opcional).
        default_empresa=(os.getenv("DEFAULT_MOTOR_EMPRESA", "").strip() or None),
    )


settings = load_settings()
