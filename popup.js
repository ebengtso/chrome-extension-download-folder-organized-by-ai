const summary = document.querySelector("#summary");
const button = document.querySelector("#openOptions");

init();

async function init() {
  const { rules = [], settings = {} } = await chrome.storage.local.get(["rules", "settings"]);
  const enabledCount = rules.filter((rule) => rule.enabled !== false).length;
  const routerState = settings.enabled === false ? "Disabled" : "Enabled";
  const aiState = settings.aiEnabled ? `AI on: ${settings.aiProvider || "chrome"}` : "AI off";
  summary.textContent = `${routerState}. ${enabledCount} active rule${enabledCount === 1 ? "" : "s"}. ${aiState}.`;
}

button.addEventListener("click", () => chrome.runtime.openOptionsPage());
