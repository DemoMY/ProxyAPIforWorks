# ⚡ llm-gate

> **Self-hosted прокси-роутер к бесплатным LLM-провайдерам с авто-ротацией ключей, HTTP/SOCKS-прокси на каждый провайдер и Anthropic-совместимым API.**
> Открывает доступ к Claude Code / Cursor / Hermes из России и других регионов с гео-блокировками.

[![CI](https://github.com/DemoMY/ProxyAPIforWorks/actions/workflows/ci.yml/badge.svg)](https://github.com/DemoMY/ProxyAPIforWorks/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg)](https://nodejs.org)

---

## Что это даёт

| Боль | Решение |
|---|---|
| NVIDIA NIM / OpenRouter / Groq блокируют РФ | HTTP/HTTPS/SOCKS5/SOCKS5h прокси на каждый провайдер |
| Бесплатный лимит провайдера кончился — что дальше? | Авто-ротация ключей при 429, переключение на следующий провайдер |
| Claude Code умеет только Anthropic API | Встроенный транслятор `/v1/messages` ↔ OpenAI: text, system, tools, streaming |
| Cursor / Hermes хотят OpenAI-формат | OpenAI-совместимый `/v1/chat/completions` на том же порту |
| Claude шлёт `claude-3-5-sonnet`, а провайдер не знает | Маппинг моделей с разумными дефолтами + UI-редактор |
| Ключи в открытом виде на диске — страшно | AES-256-GCM шифрование, мастер-ключ с правами `0600` |
| Не понимаю, что сейчас сломано | Dashboard со статистикой + health-check каждые 5 минут |

**Поддерживается 5 провайдеров:** NVIDIA NIM, OpenRouter, Groq, Together AI, Ollama.

---

## Быстрый старт

### Docker (рекомендую для прода)

```bash
# 1. Сгенерировать auth-токен
export LLM_GATE_AUTH_TOKEN=$(openssl rand -hex 32)
echo "Сохраните токен: $LLM_GATE_AUTH_TOKEN"

# 2. Запустить
docker compose up -d

# 3. Открыть UI и ввести токен
open http://127.0.0.1:7777
```

### Из исходников

```bash
git clone https://github.com/DemoMY/ProxyAPIforWorks.git llm-gate
cd llm-gate
npm install
npm run dev
```

```
⚡ llm-gate is running
───────────────────
Web UI:    http://127.0.0.1:7777
Proxy API: http://127.0.0.1:8082
Auth:      none (loopback-only — OK for local dev)
```

Откройте **http://127.0.0.1:7777**, на вкладке **Подключение** будут готовые copy-paste команды для Claude Code / Cursor.

---

## Подключение инструментов

### Claude Code

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8082
export ANTHROPIC_AUTH_TOKEN=any   # или ваш LLM_GATE_AUTH_TOKEN
claude
```

Или используйте готовый скрипт: [`examples/claude-code.sh`](./examples/claude-code.sh).

### Cursor

Settings → Models → Override OpenAI Base URL: `http://127.0.0.1:8082/v1`. Подробнее: [`examples/cursor-settings.md`](./examples/cursor-settings.md).

### Cline / Hermes / любой OpenAI-совместимый клиент

```
OPENAI_BASE_URL=http://127.0.0.1:8082/v1
OPENAI_API_KEY=any
```

### Прямой curl

```bash
curl http://127.0.0.1:8082/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "claude-3-5-sonnet",
    "messages": [{"role":"user","content":"Привет!"}],
    "max_tokens": 100
  }'
```

---

## Где взять бесплатные ключи

Все — без карты, без СМС, через VPN/прокси.

| Провайдер | Где регистрироваться | Лимит |
|---|---|---|
| **NVIDIA NIM** | [build.nvidia.com](https://build.nvidia.com) → API Keys | 40 req/min |
| **OpenRouter** | [openrouter.ai](https://openrouter.ai) → Keys | бесплатные модели без квот |
| **Groq** | [console.groq.com](https://console.groq.com) | 30 req/min, 14 400 req/day |
| **Together AI** | [together.ai](https://together.ai) | $5 стартовый кредит |
| **Ollama** | `ollama pull <model>` | безлимит локально |

---

## Возможности

- ✅ **OpenAI-совместимый** `POST /v1/chat/completions` (стрим + не-стрим)
- ✅ **Anthropic-совместимый** `POST /v1/messages` с двусторонним транслятором
  - text + system, tools/tool_choice, tool_use ↔ tool_calls
  - стриминг с полным Anthropic event lifecycle (`message_start` → `content_block_*` → `message_delta` → `message_stop`)
- ✅ **5 провайдеров:** NVIDIA NIM / OpenRouter / Groq / Together AI / Ollama
- ✅ **Прокси на каждый провайдер:** HTTP / HTTPS / SOCKS5 / SOCKS5h, проверка через ipinfo с показом exit-IP, страны и латентности
- ✅ **Авто-ротация ключей:** 429 → `Retry-After` cool-down → следующий ключ → следующий провайдер
- ✅ **Health-check:** периодически пингует ключи и прокси, мёртвые помечает автоматически
- ✅ **Маппинг моделей:** `claude-3-5-sonnet` → реальная модель провайдера, с дефолтами и UI-редактором
- ✅ **Шифрование секретов:** AES-256-GCM
- ✅ **Bearer-токен** на оба порта (опционально)
- ✅ **Веб-UI:** обзор со статистикой, прокси, провайдеры, ключи, маппинг, copy-paste команды для подключения
- ✅ **Docker + docker-compose**
- ✅ **CI:** typecheck + 19 unit-тестов + smoke-тест собранного артефакта

---

## Переменные окружения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `LLM_GATE_DATA_DIR` | `~/.llm-gate` | Где SQLite, мастер-ключ |
| `LLM_GATE_UI_PORT` | `7777` | Порт админ-UI |
| `LLM_GATE_PROXY_PORT` | `8082` | Порт OpenAI/Anthropic API |
| `LLM_GATE_HOST` | `127.0.0.1` | На какой адрес биндить |
| `LLM_GATE_AUTH_TOKEN` | (пусто) | Bearer-токен. **Обязателен** при не-loopback хосте |
| `LLM_GATE_UPSTREAM_TIMEOUT_MS` | `120000` | Таймаут запроса к upstream |
| `LLM_GATE_HEALTH_INTERVAL_MS` | `300000` | Интервал health-check'а |
| `LLM_GATE_OLLAMA_URL` | `http://127.0.0.1:11434/v1` | URL локального Ollama |
| `LLM_GATE_LOG_LEVEL` | `info` | `trace`/`debug`/`info`/`warn`/`error` |

Шаблон в [`.env.example`](./.env.example).

---

## Безопасность

См. [SECURITY.md](./SECURITY.md). Короткая версия:

- Все секреты шифруются перед записью на диск.
- По умолчанию слушает только loopback.
- При биндинге наружу — обязательно ставьте `LLM_GATE_AUTH_TOKEN`.
- Не коммитьте `~/.llm-gate/` и `.env`.

---

## Архитектура

```
src/
├── cli.ts                entrypoint
├── server.ts             Fastify, 2 порта (UI + Proxy), bearer-auth
├── config.ts             env-конфиг
├── db.ts                 better-sqlite3 + миграции
├── crypto.ts             AES-256-GCM
├── util/signals.ts       withTimeout helper
├── proxy/
│   ├── dispatcher.ts     undici Dispatcher для HTTP/SOCKS + ipinfo
│   └── cache.ts          shared DispatcherCache
├── providers/
│   ├── base.ts           интерфейс Provider
│   ├── openai-compat.ts  фабрика для OpenAI-совместимых
│   ├── model-aliases.ts  словари claude-*/gpt-*/o1-* → реальные модели
│   ├── nvidia.ts / openrouter.ts / groq.ts / together.ts / ollama.ts
│   └── registry.ts
├── core/
│   ├── keypool.ts        alive/cooling/dead state machine
│   ├── router.ts         выбор провайдер→ключ→прокси + failover
│   └── health.ts         фоновой health-checker
├── api/
│   ├── proxy-api.ts            /v1/chat/completions + /v1/messages
│   ├── anthropic-translate.ts  Anthropic ↔ OpenAI translator
│   └── admin-api.ts            CRUD + stats + setup
└── ui/                         vanilla SPA с toasts и dashboard
```

---

## Roadmap

- [x] OpenRouter / Groq / Together / Ollama провайдеры
- [x] Anthropic `/v1/messages` ↔ OpenAI translator
- [x] Маппинг моделей с дефолтами и UI-редактором
- [x] Bearer-токен, Docker, CI, dashboard
- [x] PATCH endpoints, stats, setup endpoint
- [ ] Anthropic `image` content blocks
- [ ] Anthropic `cache_control` → prompt caching
- [ ] Drag-and-drop приоритетов провайдеров
- [ ] Импорт системного `HTTPS_PROXY`/`ALL_PROXY` при первом запуске
- [ ] Пресеты «Код / Чат / Перевод»

---

## Contributing

См. [CONTRIBUTING.md](./CONTRIBUTING.md). Новый провайдер добавляется одним файлом из 15 строк.

---

## Лицензия

[MIT](./LICENSE) — используйте, форкайте, продавайте сервис на этом, ставьте на VPS клиентам.
