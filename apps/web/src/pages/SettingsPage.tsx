import {
  Animate,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  RadioGroup,
  RadioItem,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  THEME_OPTIONS,
  SignalDot,
  useTheme,
  useToast,
  type ThemePreference,
} from "@nuoma/ui";
import { useEffect, useState } from "react";

import { useAuth } from "../auth/auth-context.js";
import {
  browserSupportsPush,
  getExistingPushSubscription,
  subscribeBrowserPush,
  unsubscribeBrowserPush,
  type BrowserPushSubscription,
} from "../lib/push-subscription.js";
import { trpc } from "../lib/trpc.js";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY as string | undefined;

export function SettingsPage() {
  const auth = useAuth();
  const theme = useTheme();
  const toast = useToast();
  const [pushSubscription, setPushSubscription] = useState<BrowserPushSubscription | null>(null);
  const [pushLoading, setPushLoading] = useState(false);
  const pushSubscribe = trpc.push.subscribe.useMutation();
  const pushUnsubscribe = trpc.push.unsubscribe.useMutation();
  const pushTest = trpc.push.test.useMutation();

  useEffect(() => {
    if (!browserSupportsPush()) {
      return;
    }
    void getExistingPushSubscription()
      .then(setPushSubscription)
      .catch(() => setPushSubscription(null));
  }, []);

  async function enablePush() {
    if (!VAPID_PUBLIC_KEY) {
      toast.push({
        title: "VAPID ausente",
        description: "Configure VITE_WEB_PUSH_VAPID_PUBLIC_KEY no web app.",
        variant: "warning",
      });
      return;
    }
    setPushLoading(true);
    try {
      const subscription = await subscribeBrowserPush(VAPID_PUBLIC_KEY);
      await pushSubscribe.mutateAsync(subscription);
      setPushSubscription(subscription);
      toast.push({ title: "Push ativado", variant: "success" });
    } catch (error) {
      toast.push({
        title: "Falha ao ativar push",
        description: error instanceof Error ? error.message : "Erro desconhecido.",
        variant: "danger",
      });
    } finally {
      setPushLoading(false);
    }
  }

  async function disablePush() {
    setPushLoading(true);
    try {
      const subscription = await unsubscribeBrowserPush();
      if (subscription) {
        await pushUnsubscribe.mutateAsync({ endpoint: subscription.endpoint });
      }
      setPushSubscription(null);
      toast.push({ title: "Push desativado", variant: "success" });
    } catch (error) {
      toast.push({
        title: "Falha ao desativar push",
        description: error instanceof Error ? error.message : "Erro desconhecido.",
        variant: "danger",
      });
    } finally {
      setPushLoading(false);
    }
  }

  async function sendTestPush() {
    setPushLoading(true);
    try {
      const result = await pushTest.mutateAsync();
      toast.push({
        title: result.delivered ? "Push enviado" : "Teste registrado",
        description:
          result.mode === "web-push"
            ? `Tentativas: ${result.attempted}, falhas: ${result.failed}`
            : "Backend sem VAPID configurado.",
        variant: result.delivered ? "success" : "info",
      });
    } catch (error) {
      toast.push({
        title: "Falha no teste push",
        description: error instanceof Error ? error.message : "Erro desconhecido.",
        variant: "danger",
      });
    } finally {
      setPushLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-7 max-w-3xl mx-auto pt-2">
      <Animate preset="rise-in">
        <header>
          <p className="botforge-kicker">
            Configurações
          </p>
          <h1 className="botforge-title mt-2 text-5xl md:text-6xl">
            Suas <span className="text-brand-cyan">preferências</span>.
          </h1>
        </header>
      </Animate>

      <Animate preset="rise-in" delaySeconds={0.1}>
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">Geral</TabsTrigger>
            <TabsTrigger value="appearance">Aparência</TabsTrigger>
            <TabsTrigger value="notifications">Notificações</TabsTrigger>
            <TabsTrigger value="integrations">Integrações</TabsTrigger>
            <TabsTrigger value="advanced">Avançado</TabsTrigger>
          </TabsList>

          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>Sessão</CardTitle>
                <CardDescription>Conta autenticada localmente.</CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 text-sm">
                  <dt className="text-fg-muted">Email</dt>
                  <dd className="font-mono">{auth.user?.email}</dd>
                  <dt className="text-fg-muted">Role</dt>
                  <dd className="font-mono uppercase tracking-wider text-xs">{auth.user?.role}</dd>
                </dl>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="appearance">
            <Card>
              <CardHeader>
                <CardTitle>Tema</CardTitle>
                <CardDescription>Escolha a pele visual do cockpit.</CardDescription>
              </CardHeader>
              <CardContent>
                <RadioGroup
                  value={theme.preference}
                  onValueChange={(value) => theme.setPreference(value as ThemePreference)}
                  className="grid gap-3 md:grid-cols-3"
                >
                  {THEME_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="botforge-readable group relative flex min-h-32 cursor-pointer flex-col justify-between rounded-xl p-4 transition-transform hover:-translate-y-0.5 hover:shadow-raised-sm"
                    >
                      <span
                        data-theme={option.value}
                        className="absolute inset-x-3 top-3 h-10 rounded-lg bg-bg-canvas shadow-pressed-sm"
                        aria-hidden="true"
                      >
                        <span className="absolute left-3 top-3 h-4 w-14 rounded-full bg-brand-cyan/70" />
                        <span className="absolute right-3 top-3 h-4 w-8 rounded-full bg-brand-violet/55" />
                        <span className="absolute bottom-2 left-3 right-3 h-px bg-contour-line/80" />
                      </span>
                      <span className="relative mt-14 flex items-start gap-3">
                        <RadioItem value={option.value} />
                        <span>
                          <span className="block text-sm font-medium text-fg-primary">
                            {option.label}
                          </span>
                          <span className="mt-1 block text-xs leading-5 text-fg-muted">
                            {option.description}
                          </span>
                        </span>
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <SignalDot
                    status={pushSubscription ? "active" : VAPID_PUBLIC_KEY ? "idle" : "degraded"}
                    label={pushSubscription ? "Push ativo" : "Push inativo"}
                  />
                  Push notifications
                </CardTitle>
                <CardDescription>
                  Service worker local e subscription Web Push para alertas do painel.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="rounded-xl bg-bg-base p-4 text-xs font-mono text-fg-muted shadow-pressed-sm">
                  endpoint = {pushSubscription ? pushSubscription.endpoint : "not-subscribed"}
                </div>
                {!browserSupportsPush() && (
                  <p className="text-sm text-semantic-warning">
                    Este navegador nao suporta Web Push.
                  </p>
                )}
                {!VAPID_PUBLIC_KEY && (
                  <p className="text-sm text-semantic-warning">
                    Configure `VITE_WEB_PUSH_VAPID_PUBLIC_KEY` para permitir subscription no browser.
                  </p>
                )}
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="accent"
                    loading={pushLoading}
                    disabled={!browserSupportsPush() || !VAPID_PUBLIC_KEY || Boolean(pushSubscription)}
                    onClick={() => void enablePush()}
                  >
                    Ativar push
                  </Button>
                  <Button
                    variant="soft"
                    loading={pushLoading}
                    disabled={!pushSubscription}
                    onClick={() => void sendTestPush()}
                  >
                    Testar
                  </Button>
                  <Button
                    variant="danger"
                    loading={pushLoading}
                    disabled={!pushSubscription}
                    onClick={() => void disablePush()}
                  >
                    Desativar
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="integrations">
            <Card>
              <CardHeader>
                <CardTitle>Integrações</CardTitle>
                <CardDescription>WhatsApp e Instagram ficam isolados por canal.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-fg-muted">
                  Configuração avançada de Instagram e Data Lake entra na trilha separada de integrações.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="advanced">
            <Card>
              <CardHeader>
                <CardTitle>Diagnóstico</CardTitle>
                <CardDescription>SQLite local, worker pid, browser status.</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-fg-muted">Diagnostico operacional ativo para stream, worker e backups.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </Animate>
    </div>
  );
}
