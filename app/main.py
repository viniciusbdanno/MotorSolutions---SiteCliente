from __future__ import annotations

import secrets
import base64
import hashlib
import hmac
import json
import os
import smtplib
import time
from email.message import EmailMessage
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import desc, func, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .config import settings
from .database import create_schema, get_db
from .models import Cliente, Motor, Reading
from .schemas import ClienteIn, ClienteOut, ClienteUpdate, EventOut, LoginIn, LoginOut, MetricOut, TelemetryAccepted, TelemetryIn

last_alert_sent: dict[str, float] = {}

# Cargos que podem gerenciar usuários (mesma regra usada no portal).
ADMIN_CARGOS = {"ceo", "admin", "gestor"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    create_schema()
    yield


app = FastAPI(
    title="Motor Solutions Telemetry API",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Content-Type", "X-API-Key", "Authorization"],
)


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return f"scrypt${base64.urlsafe_b64encode(salt).decode()}${base64.urlsafe_b64encode(digest).decode()}"


def verify_password(password: str, encoded: str | None) -> bool:
    if not encoded or not encoded.startswith("scrypt$"):
        return False
    _, salt_value, digest_value = encoded.split("$", 2)
    salt = base64.urlsafe_b64decode(salt_value.encode())
    expected = base64.urlsafe_b64decode(digest_value.encode())
    actual = hashlib.scrypt(password.encode(), salt=salt, n=2**14, r=8, p=1)
    return hmac.compare_digest(actual, expected)


def create_access_token(cliente: Cliente) -> str:
    payload = {"sub": cliente.id_cliente, "email": cliente.email, "exp": int(time.time()) + 8 * 3600}
    body = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    secret = settings.session_secret.encode()
    signature = hmac.new(secret, body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{signature}"


def require_client_token(authorization: str | None = Header(default=None)) -> int:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Sessão não autenticada")
    try:
        body, signature = authorization[7:].split(".", 1)
        secret = settings.session_secret.encode()
        expected = hmac.new(secret, body.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(signature, expected):
            raise ValueError
        payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
        if payload["exp"] < int(time.time()):
            raise ValueError
        return int(payload["sub"])
    except (KeyError, ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada") from None


def get_current_cliente(
    cliente_id: int = Depends(require_client_token),
    db: Session = Depends(get_db),
) -> Cliente:
    cliente = db.get(Cliente, cliente_id)
    if cliente is None:
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada")
    return cliente


def is_admin(cliente: Cliente) -> bool:
    return (cliente.cargo or "").strip().lower() in ADMIN_CARGOS


def same_empresa(column, empresa: str):
    return func.lower(func.trim(column)) == (empresa or "").strip().lower()


def visible_motor(cliente: Cliente):
    """Motor sem dono (empresa NULL) continua visível para todos; com dono, só para a empresa."""
    return or_(Motor.empresa.is_(None), same_empresa(Motor.empresa, cliente.empresa))


def get_visible_motor(db: Session, device_code: str, cliente: Cliente) -> Motor:
    motor = db.scalar(select(Motor).where(Motor.motor_id == device_code, visible_motor(cliente)))
    if motor is None:
        raise HTTPException(status_code=404, detail="Dispositivo não encontrado")
    return motor


def to_naive_utc(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is not None:
        return value.astimezone(UTC).replace(tzinfo=None)
    return value


def as_utc(value: datetime) -> datetime:
    """As datas ficam no banco em UTC sem fuso; na resposta vão com fuso para o navegador converter certo."""
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value


def metrics_out(rpm: float, vibration_g: float, temperature_c: float, only: str | None = None) -> list[MetricOut]:
    metrics = [
        MetricOut(name="rpm", value=rpm, unit="rpm"),
        MetricOut(name="vibration_g", value=vibration_g, unit="g"),
        MetricOut(name="temperature_c", value=temperature_c, unit="C"),
    ]
    return [item for item in metrics if item.name == only] if only else metrics


def send_email_alert(device_id: str, alerts: list[str], db: Session, empresa: str | None = None) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = (os.getenv("SMTP_PASSWORD") or "").replace(" ", "")
    smtp_from = os.getenv("SMTP_FROM") or smtp_user
    if not smtp_host or not smtp_user or not smtp_password or not smtp_from:
        return
    now = time.time()
    if now - last_alert_sent.get(device_id, 0) < 600:
        return
    recipients_query = select(Cliente.email).where(Cliente.email_alerts_enabled.is_(True))
    if empresa:
        recipients_query = recipients_query.where(same_empresa(Cliente.empresa, empresa))
    recipients = list(db.scalars(recipients_query))
    if not recipients:
        return
    message = EmailMessage()
    message["Subject"] = f"Alerta de telemetria - {device_id}"
    message["From"] = smtp_from
    message["To"] = ", ".join(recipients)
    message.set_content("O motor apresentou as seguintes condições:\n\n- " + "\n- ".join(alerts))
    with smtplib.SMTP(smtp_host, int(os.getenv("SMTP_PORT", "587")), timeout=10) as smtp:
        smtp.starttls()
        smtp.login(smtp_user, smtp_password)
        smtp.send_message(message)
    last_alert_sent[device_id] = now


def require_sensor_key(x_api_key: str | None = Header(default=None)) -> None:
    if settings.sensor_api_key and not (
        x_api_key and secrets.compare_digest(x_api_key, settings.sensor_api_key)
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Chave do sensor inválida")


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/v1/clientes", response_model=list[ClienteOut])
def list_clientes(
    atual: Cliente = Depends(get_current_cliente),
    db: Session = Depends(get_db),
) -> list[Cliente]:
    if not is_admin(atual):
        raise HTTPException(status_code=403, detail="Apenas administradores podem listar usuários")
    return list(
        db.scalars(
            select(Cliente).where(same_empresa(Cliente.empresa, atual.empresa)).order_by(Cliente.id_cliente.desc())
        )
    )


@app.post("/api/v1/clientes", response_model=ClienteOut, status_code=status.HTTP_201_CREATED)
def create_cliente(
    payload: ClienteIn,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Cliente:
    values = payload.model_dump()
    senha = values.pop("senha")
    values["email"] = values["email"].strip().lower()

    total = db.scalar(select(func.count()).select_from(Cliente)) or 0
    if total > 0:
        # Depois do primeiro cadastro, só administrador logado cria usuário, sempre na própria empresa.
        criador = db.get(Cliente, require_client_token(authorization))
        if criador is None:
            raise HTTPException(status_code=401, detail="Sessão inválida ou expirada")
        if not is_admin(criador):
            raise HTTPException(status_code=403, detail="Apenas administradores podem cadastrar usuários")
        values["empresa"] = criador.empresa

    cliente = Cliente(**values, password_hash=hash_password(senha))
    db.add(cliente)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um cliente com este e-mail") from exc
    db.refresh(cliente)
    return cliente


@app.put("/api/v1/clientes/{cliente_id}", response_model=ClienteOut)
def update_cliente(
    cliente_id: int,
    payload: ClienteUpdate,
    authenticated_id: int = Depends(require_client_token),
    db: Session = Depends(get_db),
) -> Cliente:
    if authenticated_id != cliente_id:
        raise HTTPException(status_code=403, detail="Você só pode alterar a própria conta")
    cliente = db.get(Cliente, cliente_id)
    if cliente is None:
        raise HTTPException(status_code=404, detail="Cliente não encontrado")
    cliente.nome = payload.nome.strip()
    cliente.email = payload.email.strip().lower()
    cliente.telefone = payload.telefone.strip()
    cliente.empresa = payload.empresa.strip()
    cliente.email_alerts_enabled = payload.email_alerts_enabled
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Já existe um cliente com este e-mail") from exc
    db.refresh(cliente)
    return cliente


@app.post("/api/v1/auth/login", response_model=LoginOut)
def login(payload: LoginIn, db: Session = Depends(get_db)) -> LoginOut:
    cliente = db.scalar(select(Cliente).where(Cliente.email == payload.email.strip().lower()))
    if cliente is None or not verify_password(payload.senha, cliente.password_hash):
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos")
    return LoginOut(access_token=create_access_token(cliente), cliente=cliente)


@app.post(
    "/api/v1/telemetry",
    response_model=TelemetryAccepted,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_sensor_key)],
)
def ingest_telemetry(payload: TelemetryIn, db: Session = Depends(get_db)) -> TelemetryAccepted:
    motor = db.scalar(select(Motor).where(Motor.motor_id == payload.device_id))
    if motor is None:
        motor = Motor(motor_id=payload.device_id, empresa=settings.default_empresa)
        db.add(motor)
        db.flush()

    reading = Reading(
        motor_id=motor.id,
        source_event_id=payload.event_id,
        received_at=datetime.now(UTC).replace(tzinfo=None),
        timestamp=payload.recorded_at_utc(),
        rpm=payload.metrics.get("rpm", 0),
        vibration_g=payload.metrics.get("vibracao", payload.metrics.get("vibration_g", 0)),
        temperature_c=payload.metrics.get("temperatura", payload.metrics.get("temperature_c", 0)),
        raw_payload=payload.payload_for_storage(),
    )
    db.add(reading)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if payload.event_id:
            existing = db.scalar(
                select(Reading).where(
                    Reading.motor_id == motor.id,
                    Reading.source_event_id == payload.event_id,
                )
            )
            if existing:
                return TelemetryAccepted(event_id=existing.id, duplicate=True)
        raise
    db.refresh(reading)
    alerts = []
    if reading.temperature_c >= 80:
        alerts.append(f"Temperatura: {reading.temperature_c:.2f} °C (limite: 80 °C)")
    if reading.vibration_g >= 1:
        alerts.append(f"Vibração: {reading.vibration_g:.2f} g (limite: 1 g)")
    if alerts:
        try:
            send_email_alert(payload.device_id, alerts, db, motor.empresa)
        except (OSError, smtplib.SMTPException):
            pass
    return TelemetryAccepted(event_id=reading.id)


@app.post(
    "/api/sensores",
    response_model=TelemetryAccepted,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_sensor_key)],
)
def ingest_esp32_payload(payload: TelemetryIn, db: Session = Depends(get_db)) -> TelemetryAccepted:
    """Compatibilidade com o payload fixo do firmware instalado."""
    return ingest_telemetry(payload, db)


@app.get("/api/v1/devices")
def list_devices(
    atual: Cliente = Depends(get_current_cliente),
    db: Session = Depends(get_db),
) -> list[str]:
    return list(db.scalars(select(Motor.motor_id).where(visible_motor(atual)).order_by(Motor.motor_id)))


@app.get("/api/v1/devices/{device_code}/telemetry", response_model=list[EventOut])
def history(
    device_code: str,
    metric: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    bucket_minutes: int | None = Query(
        default=None,
        ge=1,
        le=1440,
        description="Agrupa as leituras em intervalos (média de rpm/temperatura, pico de vibração).",
    ),
    limit: int = Query(default=500, ge=1, le=5000),
    atual: Cliente = Depends(get_current_cliente),
    db: Session = Depends(get_db),
) -> list[EventOut]:
    motor = get_visible_motor(db, device_code, atual)
    start = to_naive_utc(start)
    end = to_naive_utc(end)

    if bucket_minutes:
        seconds = bucket_minutes * 60
        rows = db.execute(
            text(
                """
                SELECT
                  DATE_ADD('1970-01-01',
                           INTERVAL (TIMESTAMPDIFF(SECOND, '1970-01-01', `timestamp`) DIV :sec) * :sec SECOND) AS bucket,
                  AVG(rpm) AS rpm,
                  MAX(vibration_g) AS vibration_g,
                  AVG(temperature_c) AS temperature_c
                FROM readings
                WHERE motor_id = :motor_id
                  AND (:start IS NULL OR `timestamp` >= :start)
                  AND (:end IS NULL OR `timestamp` <= :end)
                GROUP BY bucket
                ORDER BY bucket DESC
                LIMIT :limit
                """
            ),
            {"sec": seconds, "motor_id": motor.id, "start": start, "end": end, "limit": limit},
        ).all()
        result = []
        for bucket, rpm, vibration_g, temperature_c in rows:
            if isinstance(bucket, str):
                bucket = datetime.fromisoformat(bucket)
            metrics = metrics_out(float(rpm), float(vibration_g), float(temperature_c), metric)
            if metrics:
                result.append(EventOut(captured_at=as_utc(bucket), metrics=metrics))
        return result

    statement = (
        select(Reading)
        .where(Reading.motor_id == motor.id)
        .order_by(desc(Reading.timestamp))
        .limit(limit)
    )
    if start:
        statement = statement.where(Reading.timestamp >= start)
    if end:
        statement = statement.where(Reading.timestamp <= end)
    result = []
    for reading in db.scalars(statement).all():
        metrics = metrics_out(reading.rpm, reading.vibration_g, reading.temperature_c, metric)
        if metrics:
            result.append(
                EventOut(
                    id=reading.id,
                    captured_at=as_utc(reading.timestamp),
                    received_at=as_utc(reading.received_at),
                    metrics=metrics,
                )
            )
    return result


@app.get("/api/v1/devices/{device_code}/latest", response_model=list[MetricOut])
def latest_metrics(
    device_code: str,
    atual: Cliente = Depends(get_current_cliente),
    db: Session = Depends(get_db),
) -> list[MetricOut]:
    motor = get_visible_motor(db, device_code, atual)
    reading = db.scalar(
        select(Reading).where(Reading.motor_id == motor.id).order_by(desc(Reading.timestamp)).limit(1)
    )
    if reading is None:
        return []
    return metrics_out(reading.rpm, reading.vibration_g, reading.temperature_c)
