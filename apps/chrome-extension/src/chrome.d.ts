interface ChromeLastError {
  message?: string;
}

interface ChromeRuntime {
  id?: string;
  lastError?: ChromeLastError;
  getURL(path: string): string;
  openOptionsPage?(): void;
  onInstalled?: {
    addListener(listener: () => void): void;
  };
  onMessage?: {
    addListener(
      listener: (
        message: unknown,
        sender: unknown,
        sendResponse: (response: unknown) => void,
      ) => boolean | void,
    ): void;
  };
  sendMessage(message: unknown, callback: (response: unknown) => void): void;
}

interface ChromeStorageArea {
  get(keys: string[] | Record<string, unknown>): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

interface ChromeCookies {
  get(details: { url: string; name: string }): Promise<{ value: string } | null>;
}

interface ChromeTabs {
  create(details: { url: string }): void;
}

interface ChromeApi {
  runtime: ChromeRuntime;
  storage?: {
    local?: ChromeStorageArea;
  };
  cookies?: ChromeCookies;
  tabs?: ChromeTabs;
}

declare const chrome: ChromeApi;
