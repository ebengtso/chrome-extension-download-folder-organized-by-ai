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
  aiProvider: "chrome", // "chrome" or "openai"
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

const DEFAULT_RULES = [
  { id: crypto.randomUUID(), enabled: true, domain: "supremecourt.gov", folder: "Law/Cases", notes: "US Supreme Court" },
  { id: crypto.randomUUID(), enabled: true, domain: "law.justia.com", folder: "Law/Cases", notes: "Justia law/cases" },
  { id: crypto.randomUUID(), enabled: true, domain: "scholar.google.com", folder: "Research/Doctrine", notes: "Scholar research" },
  { id: crypto.randomUUID(), enabled: true, domain: "ssrn.com", folder: "Research/Doctrine", notes: "SSRN papers" },
  { id: crypto.randomUUID(), enabled: true, domain: "jstor.org", folder: "Research/Doctrine", notes: "JSTOR articles" },
  { id: crypto.randomUUID(), enabled: true, domain: "foreignaffairs.com", folder: "IR/Articles", notes: "IR articles" }
];

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== "install") return;
  const existing = await chrome.storage.local.get([STORAGE_KEYS.RULES, STORAGE_KEYS.SETTINGS]);
  if (!Array.isArray(existing[STORAGE_KEYS.RULES])) {
    await chrome.storage.local.set({ [STORAGE_KEYS.RULES]: DEFAULT_RULES });
  }
  if (!existing[STORAGE_KEYS.SETTINGS]) {
    await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: DEFAULT_SETTINGS });
  }
});

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  routeDownload(downloadItem)
    .then((suggestion) => {
      if (suggestion) {
        suggest(suggestion);
      } else {
        suggest();
      }
    })
    .catch((error) => {
      console.warn("Download Domain Router failed to classify download", error);
      suggest();
    });

  // Required because suggest() is called asynchronously.
  return true;
});

async function routeDownload(downloadItem) {
  const { rules, settings } = await loadConfig();
  if (!settings.enabled) return null;

  const sourceUrl = downloadItem.finalUrl || downloadItem.url || downloadItem.referrer || "";
  const hostname = getHostname(sourceUrl);
  const originalFilename = getBaseFilename(downloadItem.filename || sourceUrl);
  const safeFilename = sanitizeFilename(originalFilename || "download");

  if (!hostname) return null;

  const match = findMatchingRule(hostname, rules);
  let targetFolder = match?.folder || "";
  let routeReason = match ? "domain-rule" : "unmatched";
  let aiResult = null;

  const shouldAskAi = settings.aiEnabled && (!match || !settings.aiOnlyUnmatched);

  if (!targetFolder && shouldAskAi) {
    aiResult = await classifyDownload({ downloadItem, rules, settings, hostname, sourceUrl, safeFilename });
    if (aiResult?.folder && Number(aiResult.confidence) >= Number(settings.aiMinConfidence || 0.75)) {
      targetFolder = aiResult.folder;
      routeReason = `${settings.aiProvider || "chrome"}-classification`;
    } else if (aiResult) {
      routeReason = aiResult.error ? `${settings.aiProvider || "chrome"}-error` : `${settings.aiProvider || "chrome"}-low-confidence`;
    } else {
      routeReason = `${settings.aiProvider || "chrome"}-no-result`;
      aiResult = buildAiDiagnostic(settings, "AI returned no usable result.", "no-result");
    }
  } else if (!targetFolder) {
    aiResult = buildAiDiagnostic(
      settings,
      settings.aiEnabled
        ? "AI skipped because a setting prevented classification."
        : "AI skipped because 'Use AI for unmatched downloads' is off.",
      settings.aiEnabled ? "ai-skipped" : "ai-disabled"
    );
  }

  if (!targetFolder) {
    targetFolder = settings.routeUnmatched ? settings.defaultFolder : "";
  }

  const safeFolder = sanitizeFolderPath(targetFolder);
  if (!safeFolder) return null;

  const routedFilename = `${safeFolder}/${safeFilename}`;

  await rememberRoute({
    when: new Date().toISOString(),
    hostname,
    url: sourceUrl,
    originalFilename: safeFilename,
    routedFilename,
    ruleDomain: match?.domain || "(unmatched)",
    folder: safeFolder,
    routeReason,
    ai: aiResult ? {
      provider: aiResult.provider,
      folder: aiResult.folder,
      confidence: aiResult.confidence,
      reason: aiResult.reason,
      usedFileContent: aiResult.usedFileContent,
      model: settings.aiProvider === "openai" ? (settings.aiModel || DEFAULT_SETTINGS.aiModel) : "Chrome Prompt API / Gemini Nano",
      error: aiResult.error || ""
    } : null
  });

  return {
    filename: routedFilename,
    conflictAction: "uniquify"
  };
}

function buildAiDiagnostic(settings, reason, error) {
  return {
    provider: settings.aiProvider || "chrome",
    folder: settings.defaultFolder || "To Review",
    confidence: 0,
    reason,
    usedFileContent: false,
    error
  };
}

async function classifyDownload(args) {
  const provider = args.settings.aiProvider || "chrome";
  if (provider === "openai") {
    if (!args.settings.aiApiKey) return null;
    return classifyWithOpenAI(args);
  }
  return classifyWithChromePromptAPI(args);
}

async function loadConfig() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.RULES, STORAGE_KEYS.SETTINGS]);
  const rules = Array.isArray(stored[STORAGE_KEYS.RULES]) ? stored[STORAGE_KEYS.RULES] : DEFAULT_RULES;
  const settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEYS.SETTINGS] || {}) };
  if (!settings.aiPromptTemplate) settings.aiPromptTemplate = DEFAULT_PROMPT_TEMPLATE;
  if (!settings.aiExtraFoldersText) settings.aiExtraFoldersText = DEFAULT_SETTINGS.aiExtraFoldersText;
  return { rules, settings };
}

async function classifyWithChromePromptAPI({ downloadItem, rules, settings, hostname, sourceUrl, safeFilename }) {
  const allowedFolders = buildAllowedFolders(rules, settings);
  if (allowedFolders.length === 0) return null;
  if (typeof globalThis.LanguageModel === "undefined") {
    return { provider: "chrome", folder: settings.defaultFolder || "To Review", confidence: 0, reason: "Chrome Prompt API is not available in this browser/profile.", usedFileContent: false, error: "LanguageModel unavailable" };
  }

  const schema = buildClassificationSchema(allowedFolders);
  const prompt = buildPromptFromTemplate({ downloadItem, hostname, sourceUrl, safeFilename, allowedFolders, settings });
  const options = getChromeLanguageModelOptions();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(settings.aiTimeoutMs || 9000));

  try {
    let availability;
    try {
      availability = await globalThis.LanguageModel.availability(options);
    } catch (_) {
      availability = await globalThis.LanguageModel.availability();
    }

    if (availability === "unavailable") {
      return { provider: "chrome", folder: settings.defaultFolder || "To Review", confidence: 0, reason: "Chrome local AI model is unavailable on this device/profile.", usedFileContent: false, error: "unavailable" };
    }

    const session = await createChromeLanguageModelSession(options, controller.signal);
    let result;
    try {
      result = await session.prompt(prompt, {
        responseConstraint: schema,
        omitResponseConstraintInput: false
      });
    } catch (_) {
      result = await session.prompt(`${prompt}\n\nReturn only valid JSON matching this schema:\n${JSON.stringify(schema)}`);
    } finally {
      if (typeof session.destroy === "function") session.destroy();
    }

    const parsed = parseJsonFromModelOutput(result);
    const normalized = normalizeAiClassification(parsed, allowedFolders, safeFilename);
    if (!normalized) return null;
    return { provider: "chrome", ...normalized, usedFileContent: false };
  } catch (error) {
    console.warn("Chrome local AI classification error", error);
    return { provider: "chrome", folder: settings.defaultFolder || "To Review", confidence: 0, reason: "Chrome local AI classification failed.", usedFileContent: false, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

function getChromeLanguageModelOptions() {
  return {
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }]
  };
}

async function createChromeLanguageModelSession(options, signal) {
  try {
    const params = typeof globalThis.LanguageModel.params === "function" ? await globalThis.LanguageModel.params() : null;
    if (params?.defaultTopK && params?.defaultTemperature) {
      return await globalThis.LanguageModel.create({
        ...options,
        topK: params.defaultTopK,
        temperature: Math.min(params.defaultTemperature, 0.2),
        signal
      });
    }
  } catch (_) {
    // Fall back to default session creation.
  }

  try {
    return await globalThis.LanguageModel.create({ ...options, signal });
  } catch (_) {
    return await globalThis.LanguageModel.create();
  }
}

async function classifyWithOpenAI({ downloadItem, rules, settings, hostname, sourceUrl, safeFilename }) {
  const allowedFolders = buildAllowedFolders(rules, settings);
  if (allowedFolders.length === 0) return null;

  const prompt = buildPromptFromTemplate({ downloadItem, hostname, sourceUrl, safeFilename, allowedFolders, settings });
  const content = [{ type: "input_text", text: prompt }];

  let usedFileContent = false;
  if (settings.aiSendFile) {
    const fileInput = await tryBuildFileInput({ sourceUrl, safeFilename, settings });
    if (fileInput) {
      content.push(fileInput);
      usedFileContent = true;
    }
  }

  const body = {
    model: settings.aiModel || DEFAULT_SETTINGS.aiModel,
    store: false,
    max_output_tokens: 450,
    text: {
      format: {
        type: "json_schema",
        name: "download_classification",
        strict: true,
        schema: buildClassificationSchema(allowedFolders)
      }
    },
    input: [
      {
        role: "developer",
        content: [
          {
            type: "input_text",
            text: "You classify browser downloads into exactly one allowed folder. Return only the required JSON. Do not invent folders. If unsure, choose the default or To Review folder with lower confidence. Never include path traversal, absolute paths, or personally sensitive reasoning."
          }
        ]
      },
      {
        role: "user",
        content
      }
    ]
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(settings.aiTimeoutMs || 9000));

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${settings.aiApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      console.warn("OpenAI classification failed", response.status, errorText);
      return null;
    }

    const data = await response.json();
    const text = extractOutputText(data);
    const parsed = parseJsonFromModelOutput(text);
    const normalized = normalizeAiClassification(parsed, allowedFolders, safeFilename);
    if (!normalized) return null;
    return { provider: "openai", ...normalized, usedFileContent };
  } catch (error) {
    console.warn("OpenAI classification error", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function buildClassificationSchema(allowedFolders) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      folder: { type: "string", enum: allowedFolders },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
      suggested_domain_rule: { type: "string" },
      suggested_filename: { type: "string" }
    },
    required: ["folder", "confidence", "reason", "suggested_domain_rule", "suggested_filename"]
  };
}

function buildPromptFromTemplate({ downloadItem, hostname, sourceUrl, safeFilename, allowedFolders, settings }) {
  const metadata = {
    source_url: sourceUrl,
    hostname,
    referrer: downloadItem.referrer || "",
    mime: downloadItem.mime || "",
    filename: safeFilename,
    danger: downloadItem.danger || "",
    file_size_bytes: downloadItem.fileSize || downloadItem.totalBytes || null,
    by_extension_id: downloadItem.byExtensionId || ""
  };

  const replacements = {
    allowedFolders: allowedFolders.map((folder) => `- ${folder}`).join("\n"),
    allowedFoldersJson: JSON.stringify(allowedFolders),
    defaultFolder: settings.defaultFolder || "To Review",
    metadataJson: JSON.stringify(metadata, null, 2),
    filename: safeFilename,
    hostname,
    url: sourceUrl,
    mime: downloadItem.mime || "",
    referrer: downloadItem.referrer || ""
  };

  return applyTemplate(settings.aiPromptTemplate || DEFAULT_PROMPT_TEMPLATE, replacements);
}

function applyTemplate(template, replacements) {
  return String(template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => {
    return Object.prototype.hasOwnProperty.call(replacements, key) ? String(replacements[key]) : match;
  });
}

function parseJsonFromModelOutput(output) {
  if (typeof output !== "string") return output;
  const trimmed = output.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return JSON.parse(trimmed);

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced) return JSON.parse(fenced[1]);

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(trimmed.slice(first, last + 1));

  throw new Error("Model did not return JSON.");
}

function normalizeAiClassification(parsed, allowedFolders, safeFilename) {
  if (!parsed || typeof parsed !== "object") return null;
  const folder = sanitizeFolderPath(parsed.folder);
  if (!allowedFolders.includes(folder)) return null;

  return {
    folder,
    confidence: clamp(Number(parsed.confidence || 0), 0, 1),
    reason: String(parsed.reason || ""),
    suggestedDomainRule: String(parsed.suggested_domain_rule || ""),
    suggestedFilename: sanitizeFilename(parsed.suggested_filename || safeFilename)
  };
}

async function tryBuildFileInput({ sourceUrl, safeFilename, settings }) {
  if (!/^https?:\/\//i.test(sourceUrl)) return null;

  const maxBytes = Math.max(1, Number(settings.aiMaxFileMb || 8)) * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Number(settings.aiTimeoutMs || 9000), 12000));

  try {
    const response = await fetch(sourceUrl, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) return null;

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength && contentLength > maxBytes) return null;

    const contentType = response.headers.get("content-type") || "application/octet-stream";
    const blob = await response.blob();
    if (blob.size > maxBytes) return null;

    const base64 = await blobToBase64(blob);
    return {
      type: "input_file",
      filename: safeFilename,
      file_data: `data:${contentType};base64,${base64}`
    };
  } catch (error) {
    console.warn("Could not attach downloaded file for AI classification", error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function blobToBase64(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function extractOutputText(responseData) {
  if (typeof responseData?.output_text === "string") return responseData.output_text;

  const output = Array.isArray(responseData?.output) ? responseData.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.refusal === "string") throw new Error(part.refusal);
    }
  }

  throw new Error("No output text returned by OpenAI.");
}

function buildAllowedFolders(rules, settings) {
  const folders = new Set();

  for (const line of String(settings.aiExtraFoldersText || "").split(/\r?\n/)) {
    const folder = sanitizeFolderPath(line);
    if (folder) folders.add(folder);
  }

  for (const rule of rules || []) {
    const folder = sanitizeFolderPath(rule.folder || "");
    if (folder) folders.add(folder);
  }

  const defaultFolder = sanitizeFolderPath(settings.defaultFolder || DEFAULT_SETTINGS.defaultFolder);
  if (defaultFolder) folders.add(defaultFolder);
  if (!folders.has("To Review")) folders.add("To Review");
  return Array.from(folders).slice(0, 96);
}

function findMatchingRule(hostname, rules) {
  const normalizedHost = normalizeDomain(hostname);
  return rules
    .filter((rule) => rule && rule.enabled !== false && rule.domain && rule.folder)
    .find((rule) => domainMatches(normalizedHost, rule.domain));
}

function domainMatches(hostname, pattern) {
  const normalizedPattern = normalizeDomain(pattern);
  if (!hostname || !normalizedPattern) return false;

  if (normalizedPattern.startsWith("*.")) {
    const bare = normalizedPattern.slice(2);
    return hostname === bare || hostname.endsWith(`.${bare}`);
  }

  return hostname === normalizedPattern || hostname.endsWith(`.${normalizedPattern}`);
}

function normalizeDomain(value) {
  if (!value) return "";
  let domain = String(value).trim().toLowerCase();

  try {
    if (/^https?:\/\//i.test(domain)) {
      domain = new URL(domain).hostname;
    }
  } catch (_) {
    // Fall through to plain cleanup.
  }

  return domain
    .replace(/^www\./, "")
    .replace(/\/$/, "")
    .replace(/:\d+$/, "");
}

function getHostname(urlLike) {
  try {
    return normalizeDomain(new URL(urlLike).hostname);
  } catch (_) {
    return "";
  }
}

function getBaseFilename(filenameOrUrl) {
  const raw = String(filenameOrUrl || "");

  try {
    const url = new URL(raw);
    const lastPathPart = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    return lastPathPart || url.hostname || "download";
  } catch (_) {
    // Not a URL. Continue as local or relative path.
  }

  return raw.split(/[\\/]/).filter(Boolean).pop() || "download";
}

function sanitizeFolderPath(folder) {
  return String(folder || "")
    .split("/")
    .map((part) => sanitizePathPart(part))
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

function sanitizeFilename(filename) {
  const cleaned = sanitizePathPart(filename);
  return cleaned || "download";
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

function clamp(number, min, max) {
  if (Number.isNaN(number)) return min;
  return Math.max(min, Math.min(max, number));
}

async function rememberRoute(route) {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.RECENT_ROUTES]);
  const recentRoutes = Array.isArray(stored[STORAGE_KEYS.RECENT_ROUTES]) ? stored[STORAGE_KEYS.RECENT_ROUTES] : [];
  recentRoutes.unshift(route);
  await chrome.storage.local.set({ [STORAGE_KEYS.RECENT_ROUTES]: recentRoutes.slice(0, 25) });
}
