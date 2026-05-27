import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, LockKeyhole, Server, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

import {
  Button,
  cn,
  Input,
  KeyboardShortcut,
  MicroGrid,
  NuomaLogo,
} from "@nuoma/ui";

import { useAuth } from "../auth/auth-context.js";

export function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@nuoma.local");
  const [password, setPassword] = useState("nuoma-dev-admin-123");
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
      setError("Email ou senha inválidos.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-bg-canvas text-fg-primary">
      <MicroGrid className="fixed opacity-35" fade={false} size={64} />
      <div className="pointer-events-none fixed inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.035),transparent_22%),linear-gradient(145deg,rgba(var(--color-brand-cyan),0.085),transparent_36%,rgba(0,0,0,0.34))]" />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[minmax(0,1fr)_30rem]">
        <section className="hidden min-h-screen flex-col justify-between px-10 py-9 lg:flex xl:px-14">
          <div className="flex items-center gap-3">
            <NuomaLogo variant="small" tone="gold" className="h-11 w-11" />
            <div className="min-w-0">
              <div className="font-display text-base font-semibold">Nuoma WPP</div>
              <div className="font-mono text-[0.68rem] text-fg-dim">V2 operations</div>
            </div>
          </div>

          <div className="max-w-[42rem]">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-bg-sunken/60 px-3 py-1.5 text-xs text-fg-muted shadow-pressed-sm">
              <StatusPulse />
              Local-first console
            </div>
            <h1 className="font-display text-5xl font-semibold leading-[1.02] text-fg-primary xl:text-6xl">
              Operação escura, limpa e pronta para rotina real.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-fg-muted">
              WhatsApp, Instagram e automações em uma cabine compacta, com foco em leitura,
              resposta e evidência operacional.
            </p>
          </div>

          <div className="grid max-w-3xl grid-cols-3 gap-3">
            <LoginSignal icon={ShieldCheck} label="Sessão" value="JWT local" />
            <LoginSignal icon={Server} label="Runtime" value="Edge local" />
            <LoginSignal icon={LockKeyhole} label="Senha" value="Argon2id" />
          </div>
        </section>

        <div className="flex min-h-screen items-center justify-center p-4 sm:p-8 lg:bg-bg-sunken/22">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.1 }}
            className="botforge-surface w-full max-w-sm rounded-2xl p-6 shadow-raised-xl sm:p-7"
          >
            <div className="mb-8 flex items-center justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <NuomaLogo variant="small" tone="gold" className="h-10 w-10" />
                <div className="min-w-0">
                  <div className="font-display text-sm font-semibold">Nuoma WPP</div>
                  <div className="font-mono text-[0.68rem] text-fg-dim">Acesso local</div>
                </div>
              </div>
              <KeyboardShortcut keys="↵" />
            </div>

            <h2 className="font-display text-2xl font-semibold">Entrar</h2>
            <p className="mt-1 text-sm text-fg-muted">Acesso à cabine operacional V2.</p>

            <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label
                  className="font-mono text-[0.72rem] text-fg-dim"
                  htmlFor="email"
                >
                  Email
                </label>
                <Input
                  id="email"
                  autoComplete="email"
                  value={email}
                  className="bg-bg-sunken/72"
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label
                  className="font-mono text-[0.72rem] text-fg-dim"
                  htmlFor="password"
                >
                  Senha
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  className="bg-bg-sunken/72"
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-md border border-semantic-danger/25 bg-semantic-danger/10 px-3 py-2 text-sm text-semantic-danger"
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
                className="mt-2 shadow-glow-cyan"
              >
                {submitting ? "Entrando" : "Entrar"}
              </Button>
            </form>

            <div className="mt-7 flex items-center justify-between border-t border-white/10 pt-4 font-mono text-[0.68rem] text-fg-dim">
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
        "relative inline-flex rounded-full bg-brand-cyan shadow-glow-cyan",
        compact ? "h-1.5 w-1.5" : "h-2 w-2",
      )}
    >
      <span className="absolute inset-0 rounded-full bg-brand-cyan/70 animate-ping" />
    </span>
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
    <div className="botforge-surface rounded-xl p-4">
      <div className="mb-4 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-bg-sunken/70 text-brand-cyan shadow-pressed-sm">
        <Icon className="h-4 w-4" />
      </div>
      <div className="text-sm font-medium text-fg-primary">{value}</div>
      <div className="mt-1 font-mono text-[0.68rem] text-fg-dim">{label}</div>
    </div>
  );
}
