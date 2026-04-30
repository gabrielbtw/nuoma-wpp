# ADR 0009 — Auth Strategy V2

## Status

Aceita.

## Contexto

V1 não tem auth (single-user em máquina local). V2 será hospedado em domínio público (Lightsail), exige auth real. User confirmou: V1 simples (email + senha), V2 acrescenta Passkey opcional.

## Decisão

V2 implementa auth em duas fases:

### V1 do auth (V2.4)

- **Hash**: Argon2id via `argon2` package (memory-hard, resistente a GPU brute force).
- **JWT**: signing via `jose`. Cookie httpOnly + Secure + SameSite=Lax. Expira 7 dias com refresh rotation.
- **CSRF**: double-submit token em mutations (header `X-CSRF-Token` ↔ cookie `csrf-token`).
- **Recovery**: `auth.requestPasswordReset` → email via SES (`AWS_SES_*` env) com token único expira 1h → `auth.resetPassword`.
- **Rate limit**: 5 login attempts/15min por IP (Hono rate limiter), 3 password reset/h por email.
- **Audit**: cada login/logout/password change registrado em `audit_logs`.
- **Multi-user schema desde dia 1**: tabela `users` com `email`, `password_hash`, `role` (admin|attendant|viewer), `display_name`. Single-user no V2 = `user_id=1` admin seeded.

### V2 do auth (Fase 11)

- **Passkey** via `@simplewebauthn/server` + `@simplewebauthn/browser`.
- Tabela `webauthn_credentials` (`id`, `user_id`, `credential_id`, `public_key`, `counter`).
- Settings UI permite registrar até N passkeys por user.
- Backup codes (2 codes generated + downloadáveis em PDF) pra recovery se device perdido.
- Login flow detecta passkey disponível e oferece como primeiro método.

## Consequências

- **Bom**: Multi-user trabalhando desde V1 sem migration depois. Argon2id é state-of-the-art. Passkey opcional não bloqueia V1 launch.
- **Custo**: SES API key + sandbox sandbox (uma vez, ~30min). Configurar VAPID keys pra Web Push (~5min).
- **Risco**: JWT em cookie httpOnly + CSRF protege bem; risco de token leakage só em XSS, mitigado por CSP.

## Alternativas

- Magic link only (sem senha): viável mas exige email confiável; melhor como add-on V2.
- OAuth Google: descartada — usuário não quer dependência externa.
- Lucia auth lib: viável; manualmente implementar é tão simples e dá mais controle.
- bcrypt em vez de Argon2id: descartada — Argon2id ganha em 2026.

## Referências

- [docs/architecture/V2_AUTH.md](../architecture/V2_AUTH.md) (a ser criado)
- Roadmap V2.4 + V2.11
