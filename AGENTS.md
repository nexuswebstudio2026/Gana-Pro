## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Configuration

This project uses `output: 'server'` in `astro.config.mjs` to enable server-rendered
API routes for authentication (login, register, forgot password). An adapter (e.g.
`@astrojs/node`) is required for production builds.

## Authentication System

The project includes a complete authentication system with:

- **Login** (`/login`): Form-based login with username or email + password.
- **Register** (`/register`): New account creation with password confirmation (min 6 chars).
- **Forgot Password** (`/forgot-password`): Password reset token generation (logged to console for demo).
- **Dashboard** (`/dashboard`): Protected page that requires an active session.
- **Logout** (`/api/logout`): Clears the session cookie.

### Data Storage

Users and sessions are stored as JSON files in the `data/` directory:
- `data/users.json` — user records with hashed passwords (PBKDF2).
- `data/sessions.json` — active sessions with expiration timestamps.
- `data/reset-tokens.json` — password reset tokens (1-hour expiry).

These files are git-ignored and created at runtime.

### Security

- Passwords are hashed with PBKDF2 (100,000 iterations, SHA-256, random salt).
- Session tokens are signed with HMAC-SHA256 using `SESSION_SECRET`.
- Cookies are `HttpOnly` and `SameSite=Lax`.
- Astro 7's built-in CSRF protection blocks cross-site POST submissions.
- Sessions expire after 7 days.

### Required environment variables

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | Signs session cookies. **Required in production** — the server refuses to start without it. In development a random one is generated per process, which invalidates sessions on restart. |
| `GOOGLE_SHEET_ID` | Spreadsheet that acts as the database. |
| `GOOGLE_SHEET_TAB` | Tab holding the users (default `Usuarios`). |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Service account used to read/write the sheet. |
| `GOOGLE_PRIVATE_KEY` | Private key of that service account. |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob, for uploaded images and documents. Required in production. |

Generate a suitable secret with:

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Authorization

`src/middleware.ts` is the single gate. It resolves the session once into
`Astro.locals.user` and then:

- lets public routes through (`/`, `/login`, `/register`, `/forgot-password`,
  `/gana-dinero`, `/sobre-nosotros` and the matching `/api/*` endpoints);
- redirects to the login page when a panel page is requested without a session;
- answers `401`/`403` JSON on `/api/admin/*` without a valid admin session;
- redirects non-admins away from the admin-only dashboard sections.

`src/lib/auth.ts` owns the role rules (`ADMIN_ROLES`, `isAdminRole`) and the list
of admin-only sections. Role checks must be imported from there rather than
re-implemented, so a new admin role cannot be added in one place and forgotten in
another.

The admin-only sections are `organigrama-global`, `usuarios-registrados`,
`niveles-ascenso`, `ingresos`, `gastos`, `negocio` and `usuario`. The personal
pages (`rut`, `ubicacion`, `informacion-cuenta`, `mi-organigrama`) are open to
any signed-in member.

## Testing

```sh
npm test          # single run
npm run test:watch
npm run check     # astro check (types)
```

Tests cover the areas where a mistake costs money: balance parsing
(`parseSheetBalance`, which must tell `1.234,56` from `1,234.56`), the
referral tree (`buildUserHierarchy` and friends), the role rules, and the
public calculators (`matrix-calculator.ts` and `ascent-calculator.ts`).

## Landing page

`src/pages/index.astro` is only a section index; each block lives in its own
component under `src/components/home/`, plus the shared ones in
`src/components/`. The visual system is `src/styles/landing.css`, imported
once from `index.astro`.

That file is **global on purpose**. It used to be a page-scoped `<style>`
block, which meant the rules never reached the components the landing page
renders (`FaqSection`, `TestimonialsSection`): they use `.section` and
`.section-container`, and were rendering without padding or centering. Any
shared class for the landing page belongs in `landing.css`, not in a scoped
`<style>`, or the next component that uses it will come out unstyled again.

The calculators follow the same rule as the rest of the money logic: all
arithmetic happens on the server in a pure module under `src/lib/`, and the
component only paints the panels it is given. A browser-side calculation is
how a public figure ends up disagreeing with the backend.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
