from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Index, Integer, JSON, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Motor(Base):
    __tablename__ = "motors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    motor_id: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    # Empresa dona do motor. NULL = ainda sem dono (visível para qualquer cliente logado).
    empresa: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    readings: Mapped[list[Reading]] = relationship(back_populates="motor")


class Reading(Base):
    __tablename__ = "readings"
    __table_args__ = (
        UniqueConstraint("motor_id", "source_event_id", name="uq_reading_source"),
        Index("ix_reading_motor_timestamp", "motor_id", "timestamp"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    motor_id: Mapped[int] = mapped_column(ForeignKey("motors.id", ondelete="CASCADE"), index=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, index=True)
    rpm: Mapped[float] = mapped_column(Float)
    vibration_g: Mapped[float] = mapped_column(Float)
    temperature_c: Mapped[float] = mapped_column(Float)
    source_event_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    received_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
    raw_payload: Mapped[dict] = mapped_column(JSON)
    motor: Mapped[Motor] = relationship(back_populates="readings")


class Cliente(Base):
    __tablename__ = "clientes"

    id_cliente: Mapped[int] = mapped_column(Integer, primary_key=True)
    nome: Mapped[str] = mapped_column(String(120), nullable=True)
    email: Mapped[str] = mapped_column(String(150), unique=True, index=True)
    telefone: Mapped[str] = mapped_column(String(30))
    empresa: Mapped[str] = mapped_column(String(120))
    cargo: Mapped[str] = mapped_column(String(100))
    password_hash: Mapped[str] = mapped_column(String(255), nullable=True)
    email_alerts_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="1")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
