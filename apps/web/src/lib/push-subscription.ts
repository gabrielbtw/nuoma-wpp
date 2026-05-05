export interface BrowserPushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export function browserSupportsPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function registerNuomaServiceWorker(): Promise<ServiceWorkerRegistration> {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service worker indisponivel neste navegador.");
  }
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export async function getExistingPushSubscription(): Promise<BrowserPushSubscription | null> {
  const registration = await registerNuomaServiceWorker();
  const subscription = await registration.pushManager.getSubscription();
  return subscription ? toBrowserPushSubscription(subscription) : null;
}

export async function subscribeBrowserPush(
  vapidPublicKey: string,
): Promise<BrowserPushSubscription> {
  if (!browserSupportsPush()) {
    throw new Error("Push nao suportado neste navegador.");
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Permissao de notificacao negada.");
  }

  const registration = await registerNuomaServiceWorker();
  const existing = await registration.pushManager.getSubscription();
  if (existing) {
    return toBrowserPushSubscription(existing);
  }

  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });
  return toBrowserPushSubscription(subscription);
}

export async function unsubscribeBrowserPush(): Promise<BrowserPushSubscription | null> {
  const registration = await registerNuomaServiceWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    return null;
  }
  const payload = toBrowserPushSubscription(subscription);
  await subscription.unsubscribe();
  return payload;
}

function toBrowserPushSubscription(subscription: PushSubscription): BrowserPushSubscription {
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) {
    throw new Error("Subscription push incompleta.");
  }
  return {
    endpoint: json.endpoint,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  };
}

function urlBase64ToUint8Array(value: string): ArrayBuffer {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }
  return outputArray.buffer;
}
