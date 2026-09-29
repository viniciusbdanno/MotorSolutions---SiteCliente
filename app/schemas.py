from __future__ import annotations

import math
import re
from datetime import UTC, datetime, time, timedelta, timezone
from typing import Any

from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


class TelemetryIn(BaseModel):
    """Aceita o formato canônico e também campos numéricos diretos do ESP32."""

    model_config = ConfigDict(extra="allow", str_strip_whitespace=True)

    device_id: str = Field(
        default="esp32-motor-01",
        validation_alias=AliasChoices("device_id", "deviceId", "esp_id", "motor_id")
    )
    captured_at: datetime | None = Field(
        default=None,
        validation_alias=AliasChoices("captured_at", "timestamp", "recorded_at", "data_hora"),
    )
    event_id: str | None = Field(
        default=None,
        validation_alias=AliasChoices("event_id", "message_id", "reading_id"),
    )
    metrics: dict[str, float] = Field(default_factory=dict)
    units: dict[str, str] = Field(default_factory=dict)
    hora: str | None = None
    temperatura: float | None = None
    rpm: float | None = None
    vibracao: float | None = None

    @field_validator("device_id")
    @classmethod
    def validate_device_id(cls, value: str) -> str:
        if not value or len(value) > 80:
            raise ValueError("device_id deve ter entre 1 e 80 caracteres")
        return value

    @field_validator("metrics")
    @classmethod
    def finite_metrics(cls, values: dict[str, float]) -> dict[str, float]:
        for name, value in values.items():
            if not name or len(name) > 80 or not math.isfinite(value):
                raise ValueError("métricas precisam ter nome válido e valor numérico finito")
        return values

    @model_validator(mode="after")
    def collect_direct_numeric_metrics(self) -> "TelemetryIn":
        extras = self.__pydantic_extra__ or {}
        reserved = {"status", "firmware_version", "vehicle_label"}
        for name, value in extras.items():
            if name not in reserved and isinstance(value, (int, float)) and not isinstance(value, bool):
                self.metrics.setdefault(name, float(value))
        for name, value, unit in (
            ("temperatura", self.temperatura, "C"),
            ("rpm", self.rpm, "rpm"),
            ("vibracao", self.vibracao, "g"),
        ):
            if value is not None:
                self.metrics.setdefault(name, float(value))
                self.units.setdefault(name, unit)
        if not self.metrics:
            raise ValueError("envie ao menos uma métrica numérica em metrics ou no corpo")
        return self

    def recorded_at_utc(self) -> datetime:
        value = self.captured_at
        if value is None and self.hora:
            try:
                local_time = time.fromisoformat(self.hora)
            except ValueError as exc:
                raise ValueError("hora deve estar no formato HH:MM:SS") from exc
            local_zone = timezone(timedelta(hours=-3))
            now = datetime.now(UTC)
            value = datetime.combine(now.astimezone(local_zone).date(), local_time, tzinfo=local_zone)
            # O firmware manda só a hora (sem data). Se o relógio do ESP32 e o do servidor
            # estiverem em lados diferentes da meia-noite, corrige o dia.
            delta = value - now
            if delta > timedelta(hours=12):
                value -= timedelta(days=1)
            elif delta < -timedelta(hours=12):
                value += timedelta(days=1)
        value = value or datetime.now(UTC)
        if value.tzinfo is None:
            return value
        return value.astimezone(UTC).replace(tzinfo=None)

    def payload_for_storage(self) -> dict[str, Any]:
        return self.model_dump(mode="json", by_alias=False)


class TelemetryAccepted(BaseModel):
    event_id: int
    duplicate: bool = False


class MetricOut(BaseModel):
    name: str
    value: float
    unit: str | None


class EventOut(BaseModel):
    # id e received_at ficam vazios quando a resposta é agregada (bucket_minutes).
    id: int | None = None
    captured_at: datetime
    received_at: datetime | None = None
    metrics: list[MetricOut]


class ClienteIn(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=150)
    telefone: str = Field(min_length=1, max_length=30)
    empresa: str = Field(min_length=1, max_length=120)
    cargo: str = Field(min_length=1, max_length=100)
    senha: str = Field(min_length=8, max_length=128)

    @field_validator("senha")
    @classmethod
    def validate_password(cls, value: str) -> str:
        if not re.search(r"[A-Z]", value) or not re.search(r"[a-z]", value):
            raise ValueError("A senha deve conter letras maiúsculas e minúsculas")
        if not re.search(r"\d", value) or not re.search(r"[^A-Za-z0-9]", value):
            raise ValueError("A senha deve conter número e caractere especial")
        return value


class ClienteOut(BaseModel):
    id_cliente: int
    nome: str
    email: str
    telefone: str
    empresa: str
    cargo: str
    email_alerts_enabled: bool

    model_config = ConfigDict(from_attributes=True)


class ClienteUpdate(BaseModel):
    nome: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=150)
    telefone: str = Field(default="", max_length=30)
    empresa: str = Field(min_length=1, max_length=120)
    email_alerts_enabled: bool = True


class LoginIn(BaseModel):
    email: str
    senha: str


class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    cliente: ClienteOut
