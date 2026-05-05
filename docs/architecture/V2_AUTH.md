# V2 Auth

Status: V2.4 API/auth implemented.

## Scope

Implemented now:

- Argon2id password hashes via `argon2`.
- JWT access token via `jose`, stored in httpOnly cookie.
- Refresh token rotation stored in SQLite.
- Cookie flags: httpOnly for access/refresh, SameSite=Lax, Secure in production.
- CSRF double-submit token for protected mutations.
- Auth endpoints:
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `POST /api/auth/refresh`
  - `GET /api/auth/me`
  - `POST /api/auth/change-password`
  - `POST /api/auth/request-reset`
  - `POST /api/auth/reset-password`
- Basic local web `AuthProvider` and login screen.

Deferred:

- Production email delivery for password recovery.
- Playwright E2E auth flow.
- Final Liquid Glass login styling, gated by the design system phase.

## Cookies

| Cookie          | httpOnly | Purpose                                          |
| --------------- | -------: | ------------------------------------------------ |
| `nuoma_access`  |      yes | Short-lived JWT access token                     |
| `nuoma_refresh` |      yes | Opaque refresh token                             |
| `nuoma_csrf`    |       no | Double-submit CSRF token for protected mutations |

## Local Credentials

Development seed creates:

- Email: `admin@nuoma.local`
- Password: `nuoma-dev-admin-123`

Override with:

```bash
SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD='...' npm run db:seed -w @nuoma/db
```

## Security Notes

- Refresh tokens are stored as SHA256 hashes, never raw.
- `change-password` revokes all refresh sessions for the user.
- Password reset returns the token only outside production; production must send
  the token by email before this is used with real users.
