# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] — 2026-05-30

Первый публичный релиз.

### Возможности
- OpenAI-совместимый эндпоинт `POST /v1/chat/completions` (стрим и не-стрим).
- Anthropic-совместимый эндпоинт `POST /v1/messages` с двусторонним транслятором
  (текст, system, tools/tool_choice, tool_use/tool_result, стриминг с полным
  Anthropic event lifecycle).
- Пять провайдеров: NVIDIA NIM, OpenRouter, Groq, Together AI, Ollama.
- HTTP / HTTPS / SOCKS5 / SOCKS5h прокси на каждый провайдер с глобальным
  default-прокси и per-provider override. Проверка прокси через `ipinfo.io`
  с показом exit-IP, страны и латентности.
- Авто-ротация ключей при 429 (с учётом `Retry-After`), пометка ключей `dead`
  при 401/403, межпровайдерный failover.
- Периодический health-check ключей и прокси (раз в 5 минут по умолчанию).
- Маппинг моделей: `claude-3-5-sonnet → meta/llama-3.3-70b-instruct` и т.п.,
  с пресетами по умолчанию и редактированием через UI.
- Шифрование ключей и URL прокси на диске (AES-256-GCM, мастер-ключ
  с правами `0600`).
- Опциональный bearer-токен на оба порта через `LLM_GATE_AUTH_TOKEN`.
- Upstream-таймауты настраиваются через `LLM_GATE_UPSTREAM_TIMEOUT_MS`
  (по умолчанию 120s).
- Веб-UI на vanilla JS: проксисы, провайдеры, ключи, маппинг моделей.
- Dockerfile + GitHub Actions CI (typecheck + tests + build).

### Известные ограничения
- Anthropic `image` content blocks пока не транслируются.
- Anthropic `cache_control` не пробрасывается в OpenAI-формат.
- Нет UI для drag-and-drop приоритетов провайдеров (правится через PATCH API).
- Нет встроенного импорта системного `HTTPS_PROXY` / `ALL_PROXY` при старте.
