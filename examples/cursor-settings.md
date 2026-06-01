# Подключение Cursor через llm-gate

Cursor поддерживает кастомные OpenAI-совместимые эндпоинты через настройки.

## Шаги

1. Откройте **Settings → Models**.
2. В разделе **OpenAI API Key** включите **"Override OpenAI Base URL"**.
3. Введите Base URL: `http://127.0.0.1:8082/v1`
4. В поле **OpenAI API Key** введите ваш `LLM_GATE_AUTH_TOKEN` (или любую строку, если токен не задан).
5. Под списком моделей нажмите **Verify**.

## Какие модели включить

Cursor поймёт любые имена, которые есть в `model_map` ваших провайдеров. По умолчанию работают:

- `claude-3-5-sonnet` → general-модель текущего провайдера
- `claude-3-5-haiku` → code-модель
- `claude-3-opus` → reasoning-модель
- `gpt-4o`, `gpt-4`, `gpt-4-turbo` → general-модель
- `gpt-4o-mini`, `gpt-3.5-turbo` → code-модель
- `o1` → reasoning-модель

Если хотите кастомное имя — отредактируйте маппинг в UI на странице **Провайдеры**.
