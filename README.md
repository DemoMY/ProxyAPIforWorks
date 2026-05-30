# llm-gate

Self-hosted локальный прокси для бесплатных LLM-провайдеров с поддержкой HTTP/SOCKS-прокси на каждый провайдер, авто-ротацией ключей, health-check'ами и маппингом моделей. Один OpenAI-совместимый эндпоинт (`/v1/chat/completions`) и один Anthropic-совместимый (`/v1/messages`) — к ним подключаются Claude Code, Cursor, Hermes и любые другие совместимые инструменты.

> **Зачем:** в России прямой доступ к NVIDIA NIM / OpenRouter / Groq / Together часто блокируется. `llm-gate` ходит через ваш HTTP/SOCKS-прокси, автоматически ротирует ключи при rate-limit'е, и переключается на следующий провайдер, если первый упал.

---

## Быстрый старт

### Вариант 1: Docker (рекомендую для прода)

```bash
docker run -d --name llm-gate \
  -p 127.0.0.1:7777:7777 \
  -p 127.0.0.1:8082:8082 \
  -v llm-gate-data:/data \
  -e LLM_GATE_AUTH_TOKEN=$(openssl rand -hex 32) \
  ghcr.io/demomy/llm-gate:latest
```

Откройте `http://127.0.0.1:7777` (понадобится bearer-токен из `LLM_GATE_AUTH_TOKEN`), добавьте прокси и API-ключи.

### Вариант 2: из исходников

```bash
git clone https://github.com/DemoMY/ProxyAPIforWorks.git
cd ProxyAPIforWorks
npm install
npm run dev
```

После старта:

```
Web UI:    http://127.0.0.1:7777
Proxy API: http://127.0.0.1:8082
```

Откройте UI, добавьте прокси (если нужен из РФ), затем провайдера и API-ключ. Ключ проверится автоматически — увидите ✓/✗ сразу.

---

## Подключение инструментов

### Claude Code

```bash
ANTHROPIC_AUTH_TOKEN=any \
ANTHROPIC_BASE_URL=http://127.0.0.1:8082 \
claude
```

`llm-gate` принимает Anthropic-запросы на `/v1/messages` и транслирует их в OpenAI chat completions на лету (включая стрим, tools и tool_use).

### Cursor / Hermes / любой OpenAI-совместимый клиент

```bash
OPENAI_BASE_URL=http://127.0.0.1:8082/v1
OPENAI_API_KEY=any
```

---

## Получение бесплатных API-ключей

| Провайдер | Где взять | Лимит | Карта нужна? |
|---|---|---|---|
| **NVIDIA NIM** | [build.nvidia.com](https://build.nvidia.com) → API Keys | 40 req/min | нет |
| **OpenRouter** | [openrouter.ai](https://openrouter.ai) → Keys | свободные free-модели | нет |
| **Groq** | [console.groq.com](https://console.groq.com) → API Keys | 30 req/min, 14400/day | нет |
| **Together AI** | [together.ai](https://together.ai) → API Keys | $5 кредитов новым | нет |
| **Ollama** | `ollama pull <model>` | безлимит локально | — |

---

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `LLM_GATE_DATA_DIR` | `~/.llm-gate` | Где лежит SQLite и мастер-ключ |
| `LLM_GATE_UI_PORT` | `7777` | Порт админ-UI |
| `LLM_GATE_PROXY_PORT` | `8082` | Порт OpenAI/Anthropic-совместимого API |
| `LLM_GATE_HOST` | `127.0.0.1` | На какой адрес биндить |
| `LLM_GATE_AUTH_TOKEN` | (пусто) | Bearer-токен. **Обязателен** при не-loopback хосте |
| `LLM_GATE_UPSTREAM_TIMEOUT_MS` | `120000` | Таймаут запроса к upstream-провайдеру |
| `LLM_GATE_HEALTH_INTERVAL_MS` | `300000` | Интервал health-check'а ключей и прокси |
| `LLM_GATE_OLLAMA_URL` | `http://127.0.0.1:11434/v1` | URL локального Ollama |
| `LLM_GATE_LOG_LEVEL` | `info` | `trace` / `debug` / `info` / `warn` / `error` |

---

## Безопасность

- Все API-ключи и URL-ы прокси хранятся **зашифрованными** на диске (AES-256-GCM). Мастер-ключ — в `~/.llm-gate/master.key` с правами `0600`.
- По умолчанию оба порта биндятся на `127.0.0.1` — снаружи не видны.
- Если нужно открыть наружу (Docker, VPS) — **обязательно** поставьте `LLM_GATE_AUTH_TOKEN`. Без него любой, кто достучится до порта, получит доступ ко всем вашим ключам.
- Контейнер из Dockerfile запускается под не-root пользователем.

---

## Архитектура

```
src/
├── cli.ts              entrypoint
├── server.ts           Fastify, два порта (UI + Proxy) + bearer-auth hook
├── config.ts           env-конфиг (LLM_GATE_*)
├── db.ts               better-sqlite3 + миграции
├── crypto.ts           AES-256-GCM
├── util/signals.ts     withTimeout
├── proxy/dispatcher.ts undici Dispatcher для HTTP/SOCKS + ipinfo check
├── providers/
│   ├── base.ts         интерфейс Provider
│   ├── openai-compat.ts фабрика для OpenAI-совместимых провайдеров
│   ├── model-aliases.ts маппинг входящих имён моделей
│   ├── nvidia.ts / openrouter.ts / groq.ts / together.ts / ollama.ts
│   └── registry.ts
├── core/
│   ├── keypool.ts      alive/cooling/dead + parseRetryAfter
│   ├── router.ts       выбор провайдер→ключ→прокси + failover + model resolve
│   └── health.ts       периодический пингер
├── api/
│   ├── proxy-api.ts          /v1/chat/completions + /v1/messages
│   ├── anthropic-translate.ts Anthropic ↔ OpenAI translator
│   └── admin-api.ts          CRUD endpoints для UI
└── ui/                       vanilla SPA
```

---

## Roadmap

- [x] OpenRouter / Groq / Together / Ollama провайдеры
- [x] Anthropic `/v1/messages` ↔ OpenAI translator (для Claude Code)
- [x] Маппинг моделей: Claude Code шлёт `claude-3-5-sonnet`, провайдер получает свою реальную модель
- [x] Bearer-токен на оба порта, Dockerfile, CI
- [ ] Drag-and-drop приоритетов провайдеров в UI
- [ ] Anthropic `image` content blocks
- [ ] Anthropic `cache_control` → провайдеры с prompt caching
- [ ] Импорт системного `HTTPS_PROXY` / `ALL_PROXY` при первом запуске
- [ ] Пресеты моделей: «Код» / «Чат» / «Перевод» с авто-маппингом

---

## Лицензия

[MIT](./LICENSE)
