import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, LockKeyhole, Server, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button, cn, Input, KeyboardShortcut, NuomaLogo } from "@nuoma/ui";

import { useAuth } from "../auth/auth-context.js";

const DEV_EMAIL = "admin@nuoma.local";
const DEV_PASSWORD = "nuoma-dev-admin-123";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState(import.meta.env.DEV ? DEV_EMAIL : "");
  const [password, setPassword] = useState(import.meta.env.DEV ? DEV_PASSWORD : "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await auth.login(email, password);
      void navigate({ to: "/" });
    } catch {
      setError("E-mail ou senha inválidos.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="nw-login-page">
      <div className="nw-login-grid">
        <section className="nw-login-aside">
          <div className="flex items-center gap-3">
            <NuomaLogo variant="small" tone="gold" className="h-11 w-11" />
            <div className="min-w-0">
              <div className="font-display text-base font-semibold text-ink-strong">Nuoma</div>
              <div className="font-mono text-[0.68rem] uppercase text-ink-faint">
                Carvão & Cobre
              </div>
            </div>
          </div>

          <div className="max-w-[40rem]">
            <div className="nw-login-eyebrow">
              <StatusPulse />
              Console local
            </div>
            <h1 className="font-display text-5xl font-semibold leading-[1.02] text-ink-strong xl:text-6xl">
              Operação escura, limpa e pronta para rotina real.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-ink-base">
              WhatsApp, Instagram e automações em uma cabine compacta, com foco em leitura, resposta
              e evidência operacional.
            </p>
          </div>

          <div className="grid max-w-3xl grid-cols-3 gap-3">
            <LoginSignal icon={ShieldCheck} label="Sessão" value="JWT local" />
            <LoginSignal icon={Server} label="Ambiente" value="Node local" />
            <LoginSignal icon={LockKeyhole} label="Senha" value="Argon2id" />
          </div>
        </section>

        <div className="nw-login-panel-wrap">
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.08 }}
            className="nw-login-card"
          >
            <div className="mb-8 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <NuomaLogo variant="small" tone="gold" className="h-10 w-10" />
                <div className="min-w-0">
                  <div className="font-display text-sm font-semibold text-ink-strong">Nuoma</div>
                  <div className="font-mono text-[0.68rem] uppercase text-ink-faint">
                    Acesso local
                  </div>
                </div>
              </div>
              <KeyboardShortcut keys="↵" />
            </div>

            <h2 className="font-display text-2xl font-semibold text-ink-strong">Entrar</h2>
            <p className="mt-1 text-sm text-ink-base">Acesso à cabine operacional V2.</p>

            <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[0.72rem] text-ink-soft" htmlFor="email">
                  E-mail
                </label>
                <Input
                  id="email"
                  autoComplete="email"
                  value={email}
                  className="border-line-soft bg-surface-deep text-ink-strong"
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="font-mono text-[0.72rem] text-ink-soft" htmlFor="password">
                  Senha
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  className="border-line-soft bg-surface-deep text-ink-strong"
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2 text-sm text-status-error"
                >
                  {error}
                </motion.div>
              )}

              <Button
                type="submit"
                size="lg"
                variant="accent"
                loading={submitting}
                rightIcon={<ArrowRight className="h-4 w-4" />}
                className="mt-2 bg-accent text-accent-on hover:bg-accent-hover"
              >
                {submitting ? "Entrando" : "Entrar"}
              </Button>
            </form>

            <div className="mt-7 flex items-center justify-between border-t border-line-hairline pt-4 font-mono text-[0.68rem] text-ink-soft">
              <span className="flex items-center gap-1.5">
                <StatusPulse compact />
                local
              </span>
              <span>argon2id · jwt</span>
            </div>
          </motion.div>
        </div>
      </div>
    </main>
  );
}

function StatusPulse({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={cn(
        "relative inline-flex rounded-full bg-accent",
        compact ? "h-1.5 w-1.5" : "h-2 w-2",
      )}
    />
  );
}

function LoginSignal({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof ShieldCheck;
  label: string;
  value: string;
}) {
  return (
    <div className="nw-login-signal">
      <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-md border border-line-hairline bg-surface-deep text-accent">
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-sm font-medium text-ink-strong">{value}</div>
      <div className="mt-1 font-mono text-[0.68rem] text-ink-soft">{label}</div>
    </div>
  );
}
