# processor

Основной WebSocket LLM-процессор голосового агента. Endpoint: `GET /process` через WebSocket upgrade.

## Docker Compose

```bash
OPENAI_API_KEY=... docker compose build processor
OPENAI_API_KEY=... docker compose up -d processor
```

Standalone: `docker build -t processor . && docker run --rm -p 8080:8080 --env-file .env processor`.

## Обязательная конфигурация

- `PORT` (default `8080`)
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`
- `PROCESSOR_FUNCTION_SERVER_URLS`, `PROCESSOR_STATE_SERVER_URLS` — comma-separated URL, например `http://function-state-server:8080`
- `NLP_SERVICE_URL` — необязательно, например `http://nlp-service:8090`
- `NLP_SERVICE_TIMEOUT_MS` (default `500`)
- `PROCESSOR_MCP_SERVER_URLS` — URL в формате `URL#server-name`
- `PROMPT_TEMPLATE_PATH`, `STATE_PROMPT_TEMPLATE_PATH`

Формального HTTP health endpoint нет. Сервис хранит сессии в памяти, поэтому масштабирование требует sticky sessions или отдельного session store. Не полагайтесь на значения `localhost` внутри контейнера.
