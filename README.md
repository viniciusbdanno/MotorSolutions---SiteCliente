# Motor Solutions — backend de telemetria

Servidor local em FastAPI que recebe leituras do ESP32, guarda o corpo original em MySQL e indexa cada métrica numérica para consultas do dashboard e treinamento preditivo.

## Executar localmente no Windows

1. Instale o MySQL localmente e crie o banco `motor_solutions` com um usuário para a aplicação.
2. Copie `.env.example` para `.env` e ajuste `DATABASE_URL` e `SENSOR_API_KEY`.
3. Instale as dependências com `py -m pip install -r requirements.txt`.
4. Execute `.\scripts\start-background.ps1`.
5. Abra `http://localhost:3000/docs` e `http://localhost:5173` para o portal.

O script cria `.env` a partir do exemplo e o servidor o carrega; ajuste a URL, as senhas e a chave antes de enviar dados reais. Para parar, rode `.\scripts\stop-background.ps1`.

Para iniciar o portal, em outro terminal execute `npm install` e `npm run dev` dentro de `frontend` (não na raiz do projeto).

## Contrato do ESP32

O firmware atual usa `POST /api/sensores`. O endpoint canônico `POST /api/v1/telemetry` também está disponível para integrações futuras. Ambos aceitam o header `X-API-Key` quando `SENSOR_API_KEY` estiver configurada.

```json
{
  "hora": "14:05:06",
  "temperatura": "61.25",
  "rpm": 1842,
  "vibracao": "0.42"
}
```

O firmware não envia identificador; por isso esse formato é salvo como `esp32-motor-01`. O formato canônico aceita `device_id`, `event_id`, `captured_at`, `metrics` e `units`. Toda a mensagem é preservada em `readings.raw_payload`.

`event_id` torna os reenvios idempotentes: o mesmo dispositivo não grava duas vezes a mesma leitura.

## API para o futuro dashboard

- `GET /health`
- `POST /api/v1/auth/login`
- `GET /api/v1/clientes`
- `POST /api/v1/clientes`
- `GET /api/v1/devices`
- `GET /api/v1/devices/{device_code}/latest`
- `GET /api/v1/devices/{device_code}/telemetry?metric=rpm&start=...&end=...`

## Estrutura dos dados

`database/schema.sql` é o único esquema SQL de referência. `motors` cadastra o identificador do motor e `readings` armazena uma leitura por linha, com `timestamp`, `rpm`, `vibration_g`, `temperature_c` e o payload original. A API também cria essas tabelas ao iniciar.

Clientes são armazenados em `clientes`. A senha nunca é salva em texto puro: somente o hash `scrypt` é persistido. Novos cadastros exigem maiúscula, minúscula, número, caractere especial e no mínimo oito caracteres.

Alertas por e-mail são enviados quando a temperatura chega a 80 °C ou a vibração chega a 1 g, respeitando a preferência `Alertas por e-mail` do cliente e um intervalo mínimo de 10 minutos por motor. Para ativar o envio, preencha `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` e `SMTP_FROM` no `.env`. SMS não faz parte do sistema.
