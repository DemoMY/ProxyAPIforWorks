const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

function showResult(el, ok, message) {
  el.className = "result " + (ok ? "ok" : "err");
  el.textContent = message;
}

$$("nav button").forEach((btn) =>
  btn.addEventListener("click", () => {
    $$("nav button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    $$(".tab").forEach((t) => t.classList.remove("active"));
    $(`#tab-${btn.dataset.tab}`).classList.add("active");
  })
);

async function loadProxies() {
  const { proxies, default_proxy_id } = await api("/api/proxies");
  const tbody = $("#proxies-table tbody");
  tbody.innerHTML = "";
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
      <td>
        <button class="secondary" data-action="check" data-id="${p.id}">Проверить</button>
        <button class="danger" data-action="delete" data-id="${p.id}">×</button>
      </td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.dataset.id;
      if (b.dataset.action === "delete") {
        if (!confirm("Удалить прокси?")) return;
        await api(`/api/proxies/${id}`, { method: "DELETE" });
      } else {
        await api(`/api/proxies/${id}/check`, { method: "POST" });
      }
      await loadProxies();
      await loadProviders();
    });
  });
  const sel = $('select[name="proxy_id"]');
  sel.innerHTML = '<option value="">Без прокси</option>' +
    proxies.map((p) => `<option value="${p.id}">${escape(p.name)}</option>`).join("");
}

$("#proxy-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const out = $("#proxy-form-result");
  try {
    const r = await api("/api/proxies", {
      method: "POST",
      body: JSON.stringify({ name: fd.get("name"), url: fd.get("url") }),
    });
    if (r.check.ok) {
      showResult(out, true, `✓ Прокси работает. Выход: ${r.check.country || "?"} (${r.check.ip}), ${r.check.latencyMs} мс`);
    } else {
      showResult(out, false, `✗ Прокси не работает: ${r.check.error}`);
    }
    e.target.reset();
    await loadProxies();
  } catch (err) {
    showResult(out, false, err.message);
  }
});

async function loadSupportedProviders() {
  const { providers } = await api("/api/supported-providers");
  const sel = $('select[name="kind"]');
  sel.innerHTML = providers
    .map((p) => `<option value="${p.kind}">${escape(p.displayName)}</option>`)
    .join("");
}

async function loadProviders() {
  const { providers } = await api("/api/providers");
  const root = $("#providers-list");
  root.innerHTML = "";
  if (providers.length === 0) {
    root.innerHTML = '<p class="muted">Пока нет ни одного провайдера. Добавьте выше.</p>';
    return;
  }
  for (const p of providers) {
    const div = document.createElement("div");
    div.className = "provider-card";
    div.innerHTML = `
      <h3>${escape(p.displayName)} <span class="muted" style="font-weight: normal; font-size: 13px;">priority ${p.priority}</span></h3>
      <form class="add-key" data-provider="${p.id}">
        <input name="label" placeholder="Метка (например: my-account)" required />
        <input name="key" type="password" placeholder="API ключ" required />
        <button type="submit">Добавить ключ</button>
      </form>
      <div class="result" data-result="${p.id}"></div>
      <div>${p.keys.length === 0 ? '<p class="muted">Нет ключей</p>' : ""}</div>
      ${p.keys.map((k) => `
        <div class="key-row">
          <strong>${escape(k.label)}</strong>
          <code>${escape(k.key_masked)}</code>
          <span class="badge ${k.status}">${k.status}</span>
          <span class="muted">использован ${k.uses_total}×</span>
          ${k.last_error ? `<span class="muted" title="${escape(k.last_error)}">⚠</span>` : ""}
          <button class="danger" data-key-id="${k.id}" style="margin-left: auto;">×</button>
        </div>
      `).join("")}
      <div style="margin-top: 12px; display: flex; gap: 8px;">
        <button class="danger" data-delete-provider="${p.id}">Удалить провайдера</button>
      </div>`;
    root.appendChild(div);
  }

  root.querySelectorAll("form.add-key").forEach((form) => {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const providerId = form.dataset.provider;
      const fd = new FormData(form);
      const out = root.querySelector(`[data-result="${providerId}"]`);
      try {
        const r = await api("/api/keys", {
          method: "POST",
          body: JSON.stringify({
            provider_id: providerId,
            label: fd.get("label"),
            key: fd.get("key"),
          }),
        });
        if (r.check.ok) {
          showResult(out, true, "✓ Ключ работает, добавлен");
        } else {
          showResult(out, false, `✗ Ключ добавлен, но не прошёл проверку: ${r.check.message}`);
        }
        form.reset();
        await loadProviders();
      } catch (err) {
        showResult(out, false, err.message);
      }
    });
  });

  root.querySelectorAll("[data-key-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Удалить ключ?")) return;
      await api(`/api/keys/${btn.dataset.keyId}`, { method: "DELETE" });
      await loadProviders();
    });
  });

  root.querySelectorAll("[data-delete-provider]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Удалить провайдера и все его ключи?")) return;
      await api(`/api/providers/${btn.dataset.deleteProvider}`, { method: "DELETE" });
      await loadProviders();
    });
  });
}

$("#provider-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const out = $("#provider-form-result");
  try {
    await api("/api/providers", {
      method: "POST",
      body: JSON.stringify({
        kind: fd.get("kind"),
        priority: Number(fd.get("priority")) || 100,
        proxy_id: fd.get("proxy_id") || null,
      }),
    });
    showResult(out, true, "✓ Провайдер добавлен");
    e.target.reset();
    await loadProviders();
  } catch (err) {
    showResult(out, false, err.message);
  }
});

function escape(s) {
  if (s === null || s === undefined) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

(async function init() {
  try {
    await loadSupportedProviders();
    await loadProxies();
    await loadProviders();
  } catch (err) {
    console.error(err);
    alert("Не удалось загрузить данные: " + err.message);
  }
})();
