# llm-gate

Self-hosted локальный прокси для бесплатных LLM-провайдеров с поддержкой HTTP/SOCKS-прокси на каждый провайдер, авто-ротацией ключей и health-check'ами. Делает один OpenAI-совместимый эндпоинт, к которому подключаются Claude Code, Cursor, Hermes и любые другие совместимые инструменты.

> **Статус:** ранняя версия. Реализованы NVIDIA NIM / OpenRouter / Groq / Together AI / Ollama. Поддерживаются OpenAI-совместимый эндпоинт `/v1/chat/completions` и Anthropic-совместимый `/v1/messages` (текст, system, tools, стриминг) — Claude Code подключается через `ANTHROPIC_BASE_URL`.

## Зачем

В России прямой доступ к NVIDIA NIM / OpenRouter / Groq / Together часто блокируется по гео. `llm-gate` решает это так:

- **Прокси как сущность первого класса.** Добавляете named-прокси (HTTP/SOCKS5/SOCKS5h), при добавлении он сразу проверяется через `ipinfo.io` — видно exit-IP, страну и латентность.
- **Default proxy + override на провайдере.** Один прокси для всех или разные для NVIDIA и OpenRouter — на выбор.
- **DNS не утекает.** Рекомендуем `socks5h://` — резолв идёт через прокси.
- **Авто-ротация ключей при 429.** Ключ, словивший rate limit, уходит «остывать» на время из `Retry-After`, запрос уходит на следующий ключ/провайдера.
- **Health-check каждые 5 минут.** Мёртвые ключи (401/403) помечаются и автоматически выпадают из ротации.
- **Шифрование ключей.** Все API-ключи и URL прокси хранятся в SQLite зашифрованные AES-256-GCM. Мастер-ключ лежит в `~/.llm-gate/master.key` с правами `0600`.

## Запуск (dev)

```bash
npm install
npm run dev
```

После старта:

```
Web UI:    http://127.0.0.1:7777
Proxy API: http://127.0.0.1:8082
```

Откройте UI, добавьте прокси (если нужен), затем провайдера и API-ключ. Ключ проверится автоматически.

## Подключение инструментов

```bash
# Cursor / Hermes / любой OpenAI-совместимый клиент
OPENAI_BASE_URL=http://127.0.0.1:8082/v1
OPENAI_API_KEY=any

# Claude Code (Anthropic-формат /v1/messages — в работе)
ANTHROPIC_BASE_URL=http://127.0.0.1:8082
ANTHROPIC_AUTH_TOKEN=any
```

## Конфигурация окружения

| Переменная | По умолчанию |
|---|---|
| `LLM_GATE_DATA_DIR` | `~/.llm-gate` |
| `LLM_GATE_UI_PORT` | `7777` |
| `LLM_GATE_PROXY_PORT` | `8082` |
| `LLM_GATE_HOST` | `127.0.0.1` |
| `LLM_GATE_HEALTH_INTERVAL_MS` | `300000` (5 мин) |

## Архитектура

```
src/
├── cli.ts              # entrypoint
├── server.ts           # Fastify, два порта (UI + Proxy)
├── config.ts           # пути и env
├── db.ts               # better-sqlite3 + schema
├── crypto.ts           # AES-256-GCM
├── proxy/
│   └── dispatcher.ts   # undici Dispatcher для HTTP/SOCKS + health-check
├── providers/
│   ├── base.ts         # Provider interface
│   ├── nvidia.ts       # NVIDIA NIM
│   └── registry.ts     # реестр реализаций
├── core/
│   ├── keypool.ts      # alive/cooling/dead + parseRetryAfter
│   ├── router.ts       # выбор провайдер→ключ→прокси + failover
│   └── health.ts       # периодический пингер
├── api/
│   ├── proxy-api.ts    # /v1/chat/completions
│   └── admin-api.ts    # /api/proxies, /api/providers, /api/keys
└── ui/                 # статический SPA на vanilla JS
```

## Roadmap

- [x] OpenRouter / Groq / Together / Ollama провайдеры
- [x] Anthropic `/v1/messages` ↔ OpenAI translator (для Claude Code)
- [ ] Drag-and-drop приоритетов провайдеров в UI
- [ ] Стриминг SSE: e2e-тест через прокси
- [ ] Импорт системного `HTTPS_PROXY` / `ALL_PROXY` при первом запуске
- [ ] Пресеты моделей: «Код» / «Чат» / «Перевод» с авто-маппингом
- [x] Маппинг моделей: Claude Code шлёт `claude-3-5-sonnet`, провайдер получает свою реальную модель

## Лицензия

MIT
