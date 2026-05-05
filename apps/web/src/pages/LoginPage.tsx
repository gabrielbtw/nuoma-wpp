import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { ArrowRight, LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";

import {
  Animate,
  Button,
  Input,
  KeyboardShortcut,
  MicroGrid,
  SignalDot,
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
    <main className="relative min-h-screen overflow-hidden bg-bg-base text-fg-primary">
      <MicroGrid className="fixed opacity-45" fade={false} />

      <div className="relative z-10 grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
        {/* Left brand showcase */}
        <Animate
          preset="slide-in-left"
          className="hidden lg:flex flex-col justify-between p-12 xl:p-16"
        >
          <div className="flex items-center gap-3">
            <div className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-bg-base shadow-raised-md">
              <SignalDot status="active" size="md" />
            </div>
            <div>
              <div className="font-display font-semibold tracking-tight">Nuoma WPP</div>
              <div className="text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">
                V2 · Operations
              </div>
            </div>
          </div>

          <div>
            <h1 className="font-serif italic text-6xl xl:text-7xl leading-[0.95] tracking-tight text-fg-primary">
              Operação <br />
              local. <br />
              <span className="text-brand-cyan">Soberania</span> total.
            </h1>
            <p className="mt-8 text-base text-fg-muted max-w-md leading-relaxed">
              Plataforma omnichannel construída do zero pra rodar localmente, sem
              dependência de cloud. WhatsApp + Instagram unificados.
            </p>
          </div>

          <div className="flex items-end justify-between text-xs text-fg-dim font-mono uppercase tracking-widest">
            <span>v0.1.0 · greenfield</span>
            <span>2026</span>
          </div>
        </Animate>

        {/* Right login card */}
        <div className="flex items-center justify-center p-6 sm:p-12">
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 26, delay: 0.1 }}
            className="w-full max-w-sm rounded-xxxl bg-bg-base p-8 shadow-raised-xl"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-bg-base shadow-pressed-sm text-brand-cyan">
                <LogIn className="h-4 w-4" />
              </div>
              <KeyboardShortcut keys="↵" />
            </div>

            <h2 className="mt-6 font-display text-2xl font-semibold tracking-tight">
              Entrar
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Acesso local à sua sessão V2.
            </p>

            <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label
                  className="text-[0.7rem] font-mono uppercase tracking-widest text-fg-dim"
                  htmlFor="email"
                >
                  Email
                </label>
                <Input
                  id="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label
                  className="text-[0.7rem] font-mono uppercase tracking-widest text-fg-dim"
                  htmlFor="password"
                >
                  Senha
                </label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>

              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-sm text-semantic-danger px-3 py-2 rounded-md bg-bg-base shadow-pressed-sm"
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
                className="mt-2"
              >
                {submitting ? "Entrando" : "Entrar"}
              </Button>
            </form>

            <div className="mt-8 pt-5 flex items-center justify-between text-[0.65rem] uppercase tracking-widest text-fg-dim font-mono">
              <span className="flex items-center gap-1.5">
                <SignalDot status="active" size="xs" />
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
