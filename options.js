const STORAGE_KEYS = {
  RULES: "rules",
  SETTINGS: "settings",
  RECENT_ROUTES: "recentRoutes"
};

const DEFAULT_PROMPT_TEMPLATE = `You classify a Chrome download into exactly one folder.\n\nAllowed folders:\n{{allowedFolders}}\n\nDefault folder: {{defaultFolder}}\n\nDownload metadata:\n{{metadataJson}}\n\nInstructions:\n- Choose exactly one folder from the allowed folders list.\n- Use URL/domain/filename/MIME/referrer first.\n- If uncertain, choose the default folder or To Review and use confidence below the auto-route threshold.\n- Return only JSON with: folder, confidence, reason, suggested_domain_rule, suggested_filename.\n- Do not invent folders.\n- Do not use absolute paths, .., or path traversal.`;

const DEFAULT_SETTINGS = {
  enabled: true,
  defaultFolder: "To Review",
  routeUnmatched: true,
  rulePriority: "top-first",
  aiEnabled: true,
  aiProvider: "chrome",
  aiApiKey: "",
  aiModel: "gpt-5-nano",
  aiSendFile: false,
  aiMaxFileMb: 8,
  aiTimeoutMs: 9000,
  aiMinConfidence: 0.75,
  aiOnlyUnmatched: true,
  aiExtraFoldersText: "Shipping/Commercial\nShipping/Strategy\nLaw/Cases\nLaw/Doctrine\nResearch/Doctrine\nIR/Articles\nTo Review",
  aiPromptTemplate: DEFAULT_PROMPT_TEMPLATE
};

let state = {
  rules: [],
  settings: { ...DEFAULT_SETTINGS },
  recentRoutes: []
};

const els = {
  enabled: document.querySelector("#enabled"),
  defaultFolder: document.querySelector("#defaultFolder"),
  routeUnmatched: document.querySelector("#routeUnmatched"),
  aiEnabled: document.querySelector("#aiEnabled"),
  aiProvider: document.querySelector("#aiProvider"),
  aiApiKey: document.querySelector("#aiApiKey"),
  aiModel: document.querySelector("#aiModel"),
  aiSendFile: document.querySelector("#aiSendFile"),
  aiMaxFileMb: document.querySelector("#aiMaxFileMb"),
  aiMinConfidence: document.querySelector("#aiMinConfidence"),
  aiOnlyUnmatched: document.querySelector("#aiOnlyUnmatched"),
  aiPromptTemplate: document.querySelector("#aiPromptTemplate"),
  aiExtraFoldersText: document.querySelector("#aiExtraFoldersText"),
  resetPrompt: document.querySelector("#resetPrompt"),
  checkLocalAi: document.querySelector("#checkLocalAi"),
  localAiStatus: document.querySelector("#localAiStatus"),
  rulesBody: document.querySelector("#rulesBody"),
  addRule: document.querySelector("#addRule"),
  exportRules: document.querySelector("#exportRules"),
  importRules: document.querySelector("#importRules"),
  recentRoutes: document.querySelector("#recentRoutes"),
  clearRecent: document.querySelector("#clearRecent"),
  status: document.querySelector("#status"),
  template: document.querySelector("#ruleRowTemplate")
};

init();

async function init() {
  await loadState();
  bindEvents();
  render();
}

async function loadState() {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.RULES,
    STORAGE_KEYS.SETTINGS,
    STORAGE_KEYS.RECENT_ROUTES
  ]);

  state.rules = Array.isArray(stored[STORAGE_KEYS.RULES]) ? stored[STORAGE_KEYS.RULES] : [];
  state.settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.SETTINGS] || {}) };
  if (!state.settings.aiPromptTemplate) state.settings.aiPromptTemplate = DEFAULT_PROMPT_TEMPLATE;
  if (!state.settings.aiExtraFoldersText) state.settings.aiExtraFoldersText = DEFAULT_SETTINGS.aiExtraFoldersText;
  state.recentRoutes = Array.isArray(stored[STORAGE_KEYS.RECENT_ROUTES]) ? stored[STORAGE_KEYS.RECENT_ROUTES] : [];
}

function bindEvents() {
  els.enabled.addEventListener("change", () => updateSetting("enabled", els.enabled.checked));
  els.defaultFolder.addEventListener("input", debounce(() => updateSetting("defaultFolder", els.defaultFolder.value), 250));
  els.routeUnmatched.addEventListener("change", () => updateSetting("routeUnmatched", els.routeUnmatched.checked));

  els.aiEnabled.addEventListener("change", () => updateSetting("aiEnabled", els.aiEnabled.checked));
  els.aiProvider.addEventListener("change", () => updateSetting("aiProvider", els.aiProvider.value));
  els.aiApiKey.addEventListener("input", debounce(() => updateSetting("aiApiKey", els.aiApiKey.value), 350));
  els.aiModel.addEventListener("input", debounce(() => updateSetting("aiModel", els.aiModel.value), 250));
  els.aiSendFile.addEventListener("change", () => updateSetting("aiSendFile", els.aiSendFile.checked));
  els.aiOnlyUnmatched.addEventListener("change", () => updateSetting("aiOnlyUnmatched", els.aiOnlyUnmatched.checked));
  els.aiMaxFileMb.addEventListener("input", debounce(() => updateSetting("aiMaxFileMb", Number(els.aiMaxFileMb.value || 8)), 250));
  els.aiMinConfidence.addEventListener("input", debounce(() => updateSetting("aiMinConfidence", Number(els.aiMinConfidence.value || 0.75)), 250));
  els.aiPromptTemplate.addEventListener("input", debounce(() => updateSetting("aiPromptTemplate", els.aiPromptTemplate.value), 350));
  els.aiExtraFoldersText.addEventListener("input", debounce(() => updateSetting("aiExtraFoldersText", els.aiExtraFoldersText.value), 250));

  els.resetPrompt.addEventListener("click", async () => {
    state.settings.aiPromptTemplate = DEFAULT_PROMPT_TEMPLATE;
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: state.settings });
    render();
    showStatus("Prompt reset.");
  });

  els.checkLocalAi.addEventListener("click", checkLocalAiAvailability);

  els.addRule.addEventListener("click", async () => {
    state.rules.push({ id: crypto.randomUUID(), enabled: true, domain: "", folder: "To Review", notes: "" });
    await saveRules();
    renderRules();
    showStatus("Rule added.");
  });

  els.exportRules.addEventListener("click", exportRules);
  els.importRules.addEventListener("change", importRules);
  els.clearRecent.addEventListener("click", clearRecentRoutes);
}

function render() {
  els.enabled.checked = Boolean(state.settings.enabled);
  els.defaultFolder.value = state.settings.defaultFolder || "";
  els.routeUnmatched.checked = Boolean(state.settings.routeUnmatched);
  els.aiEnabled.checked = Boolean(state.settings.aiEnabled);
  els.aiProvider.value = state.settings.aiProvider || "chrome";
  els.aiApiKey.value = state.settings.aiApiKey || "";
  els.aiModel.value = state.settings.aiModel || "gpt-5-nano";
  els.aiSendFile.checked = Boolean(state.settings.aiSendFile);
  els.aiOnlyUnmatched.checked = state.settings.aiOnlyUnmatched !== false;
  els.aiMaxFileMb.value = Number(state.settings.aiMaxFileMb || 8);
  els.aiMinConfidence.value = Number(state.settings.aiMinConfidence || 0.75);
  els.aiPromptTemplate.value = state.settings.aiPromptTemplate || DEFAULT_PROMPT_TEMPLATE;
  els.aiExtraFoldersText.value = state.settings.aiExtraFoldersText || DEFAULT_SETTINGS.aiExtraFoldersText;
  renderRules();
  renderRecentRoutes();
}

function renderRules() {
  els.rulesBody.innerHTML = "";

  if (state.rules.length === 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 5;
    td.className = "empty";
    td.textContent = "No rules yet. Add a domain-to-folder rule to start routing downloads.";
    tr.appendChild(td);
    els.rulesBody.appendChild(tr);
    return;
  }

  state.rules.forEach((rule, index) => {
    const row = els.template.content.firstElementChild.cloneNode(true);
    row.dataset.id = rule.id;

    row.querySelector('[data-field="enabled"]').checked = rule.enabled !== false;
    row.querySelector('[data-field="domain"]').value = rule.domain || "";
    row.querySelector('[data-field="folder"]').value = rule.folder || "";
    row.querySelector('[data-field="notes"]').value = rule.notes || "";

    row.querySelectorAll("input[data-field]").forEach((input) => {
      input.addEventListener("input", debounce(async () => {
        const field = input.dataset.field;
        const value = input.type === "checkbox" ? input.checked : input.value;
        state.rules[index] = { ...state.rules[index], [field]: value };
        await saveRules();
        showStatus("Saved.");
      }, input.type === "checkbox" ? 0 : 250));

      if (input.type === "checkbox") {
        input.addEventListener("change", async () => {
          const field = input.dataset.field;
          state.rules[index] = { ...state.rules[index], [field]: input.checked };
          await saveRules();
          showStatus("Saved.");
        });
      }
    });

    row.querySelector('[data-action="delete"]').addEventListener("click", async () => {
      state.rules.splice(index, 1);
      await saveRules();
      renderRules();
      showStatus("Rule deleted.");
    });

    row.querySelector('[data-action="up"]').disabled = index === 0;
    row.querySelector('[data-action="up"]').addEventListener("click", async () => moveRule(index, index - 1));
    row.querySelector('[data-action="down"]').disabled = index === state.rules.length - 1;
    row.querySelector('[data-action="down"]').addEventListener("click", async () => moveRule(index, index + 1));

    els.rulesBody.appendChild(row);
  });
}

function renderRecentRoutes() {
  els.recentRoutes.innerHTML = "";

  if (state.recentRoutes.length === 0) {
    els.recentRoutes.innerHTML = `<p class="empty">No routed downloads yet.</p>`;
    return;
  }

  state.recentRoutes.slice(0, 10).forEach((route) => {
    const item = document.createElement("article");
    item.className = "recent-item";
    const aiLine = route.ai
      ? `<p class="ai-line">AI ${escapeHtml(route.ai.provider || "")}: ${escapeHtml(route.ai.folder || "")} · confidence ${escapeHtml(String(route.ai.confidence ?? ""))} · file sent: ${route.ai.usedFileContent ? "yes" : "no"}${route.ai.error ? ` · ${escapeHtml(route.ai.error)}` : ""}</p><p class="ai-line">Reason: ${escapeHtml(route.ai.reason || "")}</p>`
      : `<p class="ai-line">AI: no diagnostic recorded. Reload this updated extension if this persists.</p>`;
    item.innerHTML = `
      <div>
        <strong>${escapeHtml(route.routedFilename || "")}</strong>
        <p>${escapeHtml(route.hostname || "")} → ${escapeHtml(route.folder || "")} · ${escapeHtml(route.routeReason || "")}</p>
        ${aiLine}
      </div>
      <time>${formatDate(route.when)}</time>
    `;
    els.recentRoutes.appendChild(item);
  });
}

async function checkLocalAiAvailability() {
  setLocalAiStatus("Checking…", "checking");
  try {
    if (typeof window.LanguageModel === "undefined") {
      setLocalAiStatus("Unavailable: LanguageModel is not exposed in this Chrome profile", "bad");
      return;
    }

    const options = {
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }]
    };

    let availability;
    try {
      availability = await window.LanguageModel.availability(options);
    } catch (_) {
      availability = await window.LanguageModel.availability();
    }

    if (availability === "unavailable") {
      setLocalAiStatus("Unavailable on this device/profile", "bad");
      return;
    }

    setLocalAiStatus(`Availability: ${availability}. Creating a test session…`, "checking");
    const session = await window.LanguageModel.create(options).catch(() => window.LanguageModel.create());
    const schema = { type: "object", additionalProperties: false, properties: { ok: { type: "boolean" } }, required: ["ok"] };
    const result = await session.prompt('Return only JSON: {"ok": true}', { responseConstraint: schema }).catch(() => session.prompt('Return only JSON: {"ok": true}'));
    if (typeof session.destroy === "function") session.destroy();
    setLocalAiStatus(`Ready. Test response: ${String(result).slice(0, 60)}`, "good");
  } catch (error) {
    setLocalAiStatus(`Failed: ${error?.message || error}`, "bad");
  }
}

function setLocalAiStatus(message, stateName) {
  els.localAiStatus.textContent = message;
  els.localAiStatus.className = `status-pill ${stateName || ""}`;
}

async function updateSetting(key, value) {
  state.settings = { ...state.settings, [key]: value };
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: state.settings });
  showStatus("Saved.");
}

async function saveRules() {
  state.rules = state.rules.map((rule) => ({
    id: rule.id || crypto.randomUUID(),
    enabled: rule.enabled !== false,
    domain: String(rule.domain || "").trim(),
    folder: sanitizeFolderPath(rule.folder || ""),
    notes: String(rule.notes || "").trim()
  }));
  await chrome.storage.local.set({ [STORAGE_KEYS.RULES]: state.rules });
}

async function moveRule(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= state.rules.length) return;
  const [rule] = state.rules.splice(fromIndex, 1);
  state.rules.splice(toIndex, 0, rule);
  await saveRules();
  renderRules();
  showStatus("Rule order updated.");
}

function exportRules() {
  const payload = {
    exportedAt: new Date().toISOString(),
    settings: { ...state.settings, aiApiKey: "" },
    rules: state.rules
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "download-domain-router-ai-local-rules.json";
  a.click();
  URL.revokeObjectURL(url);
  showStatus("Exported JSON without API key.");
}

async function importRules(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    const importedRules = Array.isArray(payload) ? payload : payload.rules;
    const importedSettings = payload.settings;

    if (!Array.isArray(importedRules)) throw new Error("JSON must contain a rules array.");

    state.rules = importedRules.map((rule) => ({
      id: rule.id || crypto.randomUUID(),
      enabled: rule.enabled !== false,
      domain: String(rule.domain || "").trim(),
      folder: sanitizeFolderPath(rule.folder || ""),
      notes: String(rule.notes || "").trim()
    })).filter((rule) => rule.domain && rule.folder);

    if (importedSettings && typeof importedSettings === "object") {
      const { aiApiKey, ...safeImportedSettings } = importedSettings;
      state.settings = { ...state.settings, ...safeImportedSettings };
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.RULES]: state.rules, [STORAGE_KEYS.SETTINGS]: state.settings });
    render();
    showStatus("Imported rules.");
  } catch (error) {
    showStatus(`Import failed: ${error.message}`, true);
  } finally {
    event.target.value = "";
  }
}

async function clearRecentRoutes() {
  state.recentRoutes = [];
  await chrome.storage.local.set({ [STORAGE_KEYS.RECENT_ROUTES]: [] });
  renderRecentRoutes();
  showStatus("Recent routes cleared.");
}

function sanitizeFolderPath(folder) {
  return String(folder || "")
    .split("/")
    .map((part) => sanitizePathPart(part))
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function sanitizePathPart(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+$/, "")
    .slice(0, 180);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function showStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.className = isError ? "error" : "";
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => {
    els.status.textContent = "";
    els.status.className = "";
  }, 2500);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}
