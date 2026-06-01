# Contributing to llm-gate

Спасибо за интерес. Любые PR приветствуются — от исправления опечаток до новых провайдеров.

## Быстрый старт

```bash
git clone https://github.com/DemoMY/ProxyAPIforWorks.git llm-gate
cd llm-gate
npm install
npm run dev
```

## Перед PR

```bash
npm run typecheck    # tsc --noEmit
npm test             # node --test (юнит-тесты)
npm run build        # проверка сборки
```

CI прогонит то же самое + smoke-тест собранного артефакта (`node dist/cli.js`).

## Как добавить нового LLM-провайдера

Если у провайдера есть OpenAI-совместимый эндпоинт `/v1/chat/completions` — это 1 файл из ~15 строк:

```ts
// src/providers/myprovider.ts
import { makeOpenAIProvider } from "./openai-compat.js";
import { buildAliasMap } from "./model-aliases.js";

const GENERAL = "my-general-model";
const CODE = "my-code-model";
const REASONING = "my-reasoning-model";

export const MyProvider = makeOpenAIProvider({
  kind: "myprovider",       // добавьте также в ProviderKind в base.ts
  displayName: "My Provider",
  baseUrl: "https://api.myprovider.com/v1",
  defaultModels: [GENERAL, REASONING, CODE],
  defaultModelMap: buildAliasMap({ general: GENERAL, code: CODE, reasoning: REASONING }),
  defaultFallbackModel: GENERAL,
});
```

Затем:

1. Добавьте `"myprovider"` в `ProviderKind` (`src/providers/base.ts`).
2. Зарегистрируйте в `REGISTRY` в `src/providers/registry.ts`.
3. Добавьте `"myprovider"` в enum `ProviderInput.kind` в `src/api/admin-api.ts`.
4. Обновите README и CHANGELOG.

Если у провайдера НЕ OpenAI-совместимый API — реализуйте интерфейс `Provider` напрямую (`src/providers/base.ts`).

## Стиль кода

- TypeScript strict mode.
- Без лишних комментариев — код должен быть самодокументируемым.
- Без эмодзи в коде и коммитах.
- Коммиты: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`.

## Обратная связь

Issues с воспроизведением → быстрый ответ. Идеи без кода — тоже приветствуются.
