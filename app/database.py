from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_recycle=3600,
)
SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_schema() -> None:
    # Importa os modelos antes de criar as tabelas.
    from . import models  # noqa: F401

    Base.metadata.create_all(bind=engine)
    columns = {column["name"] for column in inspect(engine).get_columns("clientes")}
    motor_columns = {column["name"] for column in inspect(engine).get_columns("motors")}
    with engine.begin() as connection:
        if "empresa" not in motor_columns:
            connection.execute(text("ALTER TABLE motors ADD COLUMN empresa VARCHAR(120) NULL"))
        if "password_hash" not in columns:
            connection.execute(text("ALTER TABLE clientes ADD COLUMN password_hash VARCHAR(255) NULL"))
        if "nome" not in columns:
            connection.execute(text("ALTER TABLE clientes ADD COLUMN nome VARCHAR(120) NULL"))
        if "email_alerts_enabled" not in columns:
            connection.execute(text("ALTER TABLE clientes ADD COLUMN email_alerts_enabled BOOLEAN NOT NULL DEFAULT TRUE"))
