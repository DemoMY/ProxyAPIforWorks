const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const STATE = { authToken: localStorage.getItem("llm-gate-token") || "" };

async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (STATE.authToken) headers["Authorization"] = `Bearer ${STATE.authToken}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    const t = prompt("Введите LLM_GATE_AUTH_TOKEN (он задан в окружении сервера):");
    if (t) {
      STATE.authToken = t.trim();
      localStorage.setItem("llm-gate-token", STATE.authToken);
      return api(path, opts);
    }
    throw new Error("Требуется auth-токен");
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function toast(kind, title, body) {
  const root = $("#toasts");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `<div class="title">${escape(title)}</div>${body ? `<div>${escape(body)}</div>` : ""}`;
  root.appendChild(el);
  setTimeout(() => {
    el.classList.add("removing");
    setTimeout(() => el.remove(), 250);
  }, kind === "err" ? 6000 : 3500);
}

function escape(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

$$("nav button").forEach((btn) =>
  btn.addEventListener("click", () => {
    $$("nav button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "dashboard") loadDashboard();
    if (btn.dataset.tab === "setup") loadSetup();
  })
);

// ───────── DASHBOARD ─────────

async function loadDashboard() {
  try {
    const stats = await api("/api/stats");
    $("#stat-requests").textContent = stats.totals.requests.toLocaleString("ru-RU");
    $("#stat-keys-alive").textContent =
      `${stats.totals.keys.alive} / ${stats.totals.keys.total}`;
    $("#stat-proxies-alive").textContent =
      stats.totals.proxies.total === 0
        ? "—"
        : `${stats.totals.proxies.alive} / ${stats.totals.proxies.total}`;
    $("#stat-providers-enabled").textContent =
      `${stats.totals.providers.enabled} / ${stats.totals.providers.total}`;

    const tbody = $("#per-provider-table tbody");
    tbody.innerHTML = "";
    if (stats.per_provider.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:20px;">Нет провайдеров</td></tr>`;
    } else {
      for (const p of stats.per_provider) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${escape(p.displayName)}</strong></td>
          <td>${p.keys}</td>
          <td><span class="badge alive">${p.alive_keys}</span></td>
          <td>${p.dead_keys > 0 ? `<span class="badge dead">${p.dead_keys}</span>` : '<span class="muted">0</span>'}</td>
          <td>${p.requests.toLocaleString("ru-RU")}</td>`;
        tbody.appendChild(tr);
      }
    }
    updateStatusPill(stats);
  } catch (err) {
    toast("err", "Не удалось загрузить статистику", err.message);
  }
}

function updateStatusPill(stats) {
  const pill = $("#status-pill");
  const k = stats.totals.keys;
  if (k.total === 0) {
    pill.textContent = "не настроено";
    pill.className = "status-pill warn";
  } else if (k.alive === 0) {
    pill.textContent = "✗ нет живых ключей";
    pill.className = "status-pill bad";
  } else if (k.dead > 0 || k.cooling > 0) {
    pill.textContent = `${k.alive} живых, ${k.dead} мёртвых`;
    pill.className = "status-pill warn";
  } else {
    pill.textContent = `${k.alive} ключей живы`;
    pill.className = "status-pill ok";
  }
}

$("#refresh-all").addEventListener("click", async () => {
  await Promise.all([loadDashboard(), loadProxies(), loadProviders()]);
  toast("info", "Обновлено");
});

$("#run-healthcheck").addEventListener("click", async () => {
  try {
    await api("/api/healthcheck/run", { method: "POST" });
    toast("ok", "Health-check завершён");
    await Promise.all([loadDashboard(), loadProxies(), loadProviders()]);
  } catch (err) {
    toast("err", "Не удалось", err.message);
  }
});

// ───────── PROXIES ─────────

async function loadProxies() {
  const { proxies, default_proxy_id } = await api("/api/proxies");
  const tbody = $("#proxies-table tbody");
  tbody.innerHTML = "";
  $("#proxies-empty").hidden = proxies.length > 0;
  $("#proxies-table").style.display = proxies.length > 0 ? "" : "none";

  for (const p of proxies) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escape(p.name)}${p.id === default_proxy_id ? ' <span class="badge alive">DEFAULT</span>' : ""}</td>
      <td><code>${escape(p.url_masked)}</code></td>
      <td>${escape(p.type)}</td>
      <td><span class="badge ${p.status}">${p.status}</span></td>
      <td>${p.last_country ? "🌍 " + escape(p.last_country) : '<span class="muted">—</span>'}</td>
      <td><code>${escape(p.last_exit_ip || "—")}</code></td>
      <td>${p.last_latency_ms ?? "—"}</td>
      <td class="actions">
        <button class="secondary icon" data-action="check" data-id="${p.id}" title="Перепроверить">⟳</button>
        <button class="secondary icon" data-action="rename" data-id="${p.id}" data-name="${escape(p.name)}" title="Переименовать">✎</button>
        <button class="danger icon" data-action="delete" data-id="${p.id}" title="Удалить">×</button>
      </td>`;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-action]").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.dataset.id;
      const action = b.dataset.action;
      try {
        if (action === "delete") {
          if (!confirm("Удалить прокси?")) return;
          await api(`/api/proxies/${id}`, { method: "DELETE" });
          toast("ok", "Прокси удалён");
        } else if (action === "check") {
          await api(`/api/proxies/${id}/check`, { method: "POST" });
          toast("ok", "Проверка завершена");
        } else if (action === "rename") {
          const name = prompt("Новое имя:", b.dataset.name);
          if (!name) return;
          await api(`/api/proxies/${id}`, { method: "PATCH", body: JSON.stringify({ name }) });
          toast("ok", "Переименовано");
        }
        await Promise.all([loadProxies(), loadProviders()]);
      } catch (err) {
        toast("err", "Ошибка", err.message);
      }
    });
  });

  const sel = $('select[name="proxy_id"]');
  sel.innerHTML = '<option value="">Без прокси</option>' +
    proxies.map((p) => `<option value="${p.id}">${escape(p.name)}</option>`).join("");
}

$("#proxy-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    const r = await api("/api/proxies", {
      method: "POST",
      body: JSON.stringify({ name: fd.get("name"), url: fd.get("url") }),
    });
    if (r.check.ok) {
      toast("ok", "Прокси добавлен",
        `Выход: ${r.check.country || "?"} (${r.check.ip}), ${r.check.latencyMs} мс`);
    } else {
      toast("err", "Прокси добавлен, но не работает", r.check.error);
    }
    e.target.reset();
    await Promise.all([loadProxies(), loadDashboard()]);
  } catch (err) {
    toast("err", "Не удалось добавить прокси", err.message);
  }
});

// ───────── PROVIDERS ─────────

async function loadSupportedProviders() {
  const { providers } = await api("/api/supported-providers");
  const sel = $('select[name="kind"]');
  sel.innerHTML = providers
    .map((p) => `<option value="${p.kind}">${escape(p.displayName)}</option>`).join("");
}

async function loadProviders() {
  const { providers } = await api("/api/providers");
  const root = $("#providers-list");
  root.innerHTML = "";
  $("#providers-empty").hidden = providers.length > 0;

  for (const p of providers) {
    const div = document.createElement("div");
    div.className = "provider-card";
    const mapJson = JSON.stringify(p.model_map ?? {}, null, 2);
    div.innerHTML = `
      <header>
        <h3>${escape(p.displayName)}</h3>
        <span class="meta">priority ${p.priority}</span>
        ${p.enabled ? '' : '<span class="badge disabled">DISABLED</span>'}
        <button class="secondary icon" data-toggle="${p.id}" data-enabled="${p.enabled}" title="${p.enabled ? 'Выключить' : 'Включить'}">${p.enabled ? '⏸' : '▶'}</button>
        <button class="danger icon" data-delete-provider="${p.id}" title="Удалить">×</button>
      </header>

      <form class="add-key" data-provider="${p.id}">
        <input name="label" placeholder="Метка (my-account)" required />
        <input name="key" type="password" placeholder="API ключ" required autocomplete="off" />
        <button type="submit">Добавить ключ</button>
      </form>

      ${p.keys.length === 0 ? `<p class="muted" style="margin-top:12px;">Нет ключей</p>` : ""}
      ${p.keys.map((k) => `
        <div class="key-row">
          <span class="label">${escape(k.label)}</span>
          <code>${escape(k.key_masked)}</code>
          <span class="badge ${k.status}">${k.status}</span>
          <span class="muted">${k.uses_total}×</span>
          ${k.last_error ? `<span class="muted" title="${escape(k.last_error)}" style="cursor:help;">⚠</span>` : ""}
          <div class="actions">
            ${k.status !== 'alive' && k.status !== 'unknown' ? `<button class="secondary icon" data-reset-key="${k.id}" title="Сбросить статус">⟳</button>` : ""}
            <button class="secondary icon" data-rename-key="${k.id}" data-label="${escape(k.label)}" title="Переименовать">✎</button>
            <button class="danger icon" data-key-id="${k.id}" title="Удалить">×</button>
          </div>
        </div>
      `).join("")}

      <details class="model-map">
        <summary>Маппинг моделей (${Object.keys(p.model_map || {}).length} записей)</summary>
        <form class="save-models" data-provider="${p.id}">
          <p class="hint" style="margin: 8px 0;">JSON: <code>"входящее": "реальная модель провайдера"</code></p>
          <textarea name="model_map" rows="10" style="width:100%;font-family:monospace;font-size:12px;">${escape(mapJson)}</textarea>
          <div style="display:flex;gap:8px;margin-top:8px;align-items:center;flex-wrap:wrap;">
            <label class="muted" style="font-size:13px;">Fallback model:</label>
            <input name="fallback_model" value="${escape(p.fallback_model || "")}" />
            <button type="submit">Сохранить</button>
          </div>
        </form>
      </details>`;
    root.appendChild(div);
  }

  root.querySelectorAll("form.add-key").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const providerId = form.dataset.provider;
      const fd = new FormData(form);
      try {
        const r = await api("/api/keys", {
          method: "POST",
          body: JSON.stringify({
            provider_id: providerId, label: fd.get("label"), key: fd.get("key"),
          }),
        });
        if (r.check.ok) toast("ok", "Ключ работает", "Добавлен и проверен");
        else toast("err", "Ключ не прошёл проверку", r.check.message);
        form.reset();
        await Promise.all([loadProviders(), loadDashboard()]);
      } catch (err) {
        toast("err", "Не удалось добавить", err.message);
      }
    });
  });

  root.querySelectorAll("form.save-models").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const providerId = form.dataset.provider;
      const fd = new FormData(form);
      let modelMap;
      try { modelMap = JSON.parse(fd.get("model_map") || "{}"); }
      catch (err) { toast("err", "Невалидный JSON", err.message); return; }
      try {
        await api(`/api/providers/${providerId}`, {
          method: "PATCH",
          body: JSON.stringify({ model_map: modelMap, fallback_model: fd.get("fallback_model") || null }),
        });
        toast("ok", "Маппинг сохранён");
        await loadProviders();
      } catch (err) {
        toast("err", "Не удалось сохранить", err.message);
      }
    });
  });

  root.querySelectorAll("[data-key-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Удалить ключ?")) return;
      await api(`/api/keys/${btn.dataset.keyId}`, { method: "DELETE" });
      toast("ok", "Ключ удалён");
      await Promise.all([loadProviders(), loadDashboard()]);
    });
  });

  root.querySelectorAll("[data-reset-key]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/keys/${btn.dataset.resetKey}`, {
        method: "PATCH", body: JSON.stringify({ reset: true }),
      });
      toast("ok", "Статус ключа сброшен");
      await loadProviders();
    });
  });

  root.querySelectorAll("[data-rename-key]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const label = prompt("Новая метка:", btn.dataset.label);
      if (!label) return;
      await api(`/api/keys/${btn.dataset.renameKey}`, {
        method: "PATCH", body: JSON.stringify({ label }),
      });
      toast("ok", "Переименовано");
      await loadProviders();
    });
  });

  root.querySelectorAll("[data-toggle]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const enabled = btn.dataset.enabled === "true";
      await api(`/api/providers/${btn.dataset.toggle}`, {
        method: "PATCH", body: JSON.stringify({ enabled: !enabled }),
      });
      toast("ok", enabled ? "Провайдер выключен" : "Провайдер включён");
      await Promise.all([loadProviders(), loadDashboard()]);
    });
  });

  root.querySelectorAll("[data-delete-provider]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Удалить провайдера и все его ключи?")) return;
      await api(`/api/providers/${btn.dataset.deleteProvider}`, { method: "DELETE" });
      toast("ok", "Провайдер удалён");
      await Promise.all([loadProviders(), loadDashboard()]);
    });
  });
}

$("#provider-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  try {
    await api("/api/providers", {
      method: "POST",
      body: JSON.stringify({
        kind: fd.get("kind"),
        priority: Number(fd.get("priority")) || 100,
        proxy_id: fd.get("proxy_id") || null,
      }),
    });
    toast("ok", "Провайдер добавлен");
    e.target.reset();
    await Promise.all([loadProviders(), loadDashboard()]);
  } catch (err) {
    toast("err", "Не удалось", err.message);
  }
});

// ───────── SETUP ─────────

async function loadSetup() {
  try {
    const setup = await api("/api/setup");
    const ep = setup.endpoints;
    $("#ep-openai").textContent = ep.openai_base;
    $("#ep-anthropic").textContent = ep.anthropic_base;
    $("#ep-admin").textContent = ep.admin_base;

    const token = setup.auth.token;
    $("#ep-auth").innerHTML = token
      ? `<code>${escape(token)}</code>`
      : `<code>не требуется</code>`;

    const claudeEnv = token
      ? `ANTHROPIC_AUTH_TOKEN=${token} ANTHROPIC_BASE_URL=${ep.anthropic_base} claude`
      : `ANTHROPIC_AUTH_TOKEN=any ANTHROPIC_BASE_URL=${ep.anthropic_base} claude`;
    $("#setup-claude").textContent = claudeEnv;

    const openaiEnv =
      `export OPENAI_BASE_URL=${ep.openai_base}\n` +
      `export OPENAI_API_KEY=${token || "any"}`;
    $("#setup-openai").textContent = openaiEnv;

    const authHeader = token ? `\n  -H 'Authorization: Bearer ${token}' \\` : "";
    const curl =
      `curl ${ep.openai_base}/chat/completions \\${authHeader}\n` +
      `  -H 'Content-Type: application/json' \\\n` +
      `  -d '{"model":"claude-3-5-sonnet","messages":[{"role":"user","content":"Привет!"}],"max_tokens":100}'`;
    $("#setup-curl").textContent = curl;
  } catch (err) {
    toast("err", "Не удалось загрузить", err.message);
  }
}

$$(".copy-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const text = $(`#${btn.dataset.copy}`).textContent;
    try {
      await navigator.clipboard.writeText(text);
      toast("ok", "Скопировано");
    } catch {
      toast("err", "Не удалось скопировать");
    }
  });
});

// ───────── INIT ─────────

(async function init() {
  try {
    await loadSupportedProviders();
    await Promise.all([loadProxies(), loadProviders(), loadDashboard()]);
  } catch (err) {
    toast("err", "Не удалось загрузить", err.message);
  }
})();
