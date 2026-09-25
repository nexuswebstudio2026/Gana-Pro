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
- Session tokens are 32-byte cryptographically random hex strings.
- Cookies are `HttpOnly` and `SameSite=Lax`.
- Astro 7's built-in CSRF protection blocks cross-site POST submissions.
- Sessions expire after 7 days.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
