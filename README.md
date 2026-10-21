# processor

WebSocket LLM processor for the voice agent. The endpoint is `GET /process` through a WebSocket upgrade.

## Docker Compose

```bash
OPENAI_API_KEY=... docker compose build processor
OPENAI_API_KEY=... docker compose up -d processor
```

Standalone: `docker build -t processor . && docker run --rm -p 8080:8080 --env-file .env processor`.

## Required configuration

- `PORT` (default `8080`)
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`
- `PROCESSOR_FUNCTION_SERVER_URLS` and `PROCESSOR_STATE_SERVER_URLS`, comma-separated URLs such as `http://function-state-server:8080`
- `NLP_SERVICE_URL`, optional, such as `http://nlp-service:8090`
- `NLP_SERVICE_TIMEOUT_MS` (default `500`)
- `PROCESSOR_MCP_SERVER_URLS`, using `URL#server-name` entries
- `PROMPT_TEMPLATE_PATH` and `STATE_PROMPT_TEMPLATE_PATH`

There is no formal HTTP health endpoint. Sessions are stored in memory, so horizontal scaling requires sticky sessions or an external session store. Do not use `localhost` to reach another container.
