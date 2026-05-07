{
  const defaultApiBaseUrl = "http://127.0.0.1:3001";
  const input = document.getElementById("apiBaseUrl") as HTMLInputElement | null;
  const statusNode = document.getElementById("status");
  const saveButton = document.getElementById("save");
  const openWhatsAppButton = document.getElementById("openWhatsApp");

  void boot();

  async function boot(): Promise<void> {
    if (!hasChromeApi()) {
      setStatus("Popup renderizado fora do Chrome Extension runtime.");
      return;
    }
    const stored = await chrome.storage?.local?.get({ apiBaseUrl: defaultApiBaseUrl });
    if (input) {
      input.value = typeof stored?.apiBaseUrl === "string" ? stored.apiBaseUrl : defaultApiBaseUrl;
    }
    await refreshStatus();
  }

  saveButton?.addEventListener("click", () => {
    void saveConfig();
  });

  openWhatsAppButton?.addEventListener("click", () => {
    chrome.tabs?.create({ url: "https://web.whatsapp.com/" });
  });

  async function saveConfig(): Promise<void> {
    if (!hasChromeApi() || !input) {
      return;
    }
    const apiBaseUrl = input.value.trim().replace(/\/+$/, "") || defaultApiBaseUrl;
    await chrome.storage?.local?.set({ apiBaseUrl });
    setStatus(`API local salva: ${apiBaseUrl}`);
    await refreshStatus();
  }

  async function refreshStatus(): Promise<void> {
    if (!hasChromeApi() || !input) {
      return;
    }
    const apiBaseUrl = input.value.trim().replace(/\/+$/, "") || defaultApiBaseUrl;
    const cookie = await chrome.cookies?.get({ url: apiBaseUrl, name: "nuoma_access" });
    setStatus(cookie?.value ? "Login local detectado. Overlay autorizado." : "Faça login no Nuoma local.");
  }

  function setStatus(value: string): void {
    if (statusNode) {
      statusNode.textContent = value;
    }
  }

  function hasChromeApi(): boolean {
    return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
  }
}
