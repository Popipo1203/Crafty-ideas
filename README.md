# Craftly Ideas

Craftly Ideas is a web MVP for generating handcraft project ideas from the materials a user types into the Creative prompt box.

## What It Does

- Landing page with lightweight email/password login and signup
- Private saved ideas tied to a signed-in account
- Prompt-bound craft idea generation
- Step-by-step instructions rooted in the prompt, with light creative interpretation
- Related web inspiration link generated from the prompt
- Privacy framing that prompts and creations are not used to train AI

## Run Locally

```bash
npm install
npm start
```

Then open:

```text
http://localhost:8000
```

## Replit Notes

Replit can run this project with the included `.replit` config, which starts the app with `npm start`. Because this app has a Node server, publish it as an **Autoscale** or **Reserved VM** app, not a Static Deployment.

### Required before a public deploy

1. Open Replit's **Database** tool once for the project and confirm a database is attached. Replit provides `DATABASE_URL` to the app and creates/attaches the production database during publishing.
2. In the Publishing settings, confirm `DATABASE_URL` is available to the published app before going live.
3. Publish with `npm start`, then visit `/api/health`. A ready instance responds with `{"ok":true,"storage":"ready"}`.

This database step is required for accounts and saved ideas. [Replit's publishing documentation](https://docs.replit.com/cloud-services/deployments/about-deployments) says not to rely on files written by a published app; [its troubleshooting guide](https://docs.replit.com/cloud-services/deployments/troubleshooting) notes that the published filesystem resets. When `DATABASE_URL` is present, Craftly creates its small `craftly_store` table automatically on first boot and serializes updates inside database transactions. No manual schema command is needed.

For local development, where `DATABASE_URL` is normally absent, the server initializes `.data/craftly-store.json` on first boot. Writes use a temporary file plus atomic rename and are serialized to avoid partial or overlapping saves. The `.data` folder is ignored by Git. On a non-Replit host, either provide `DATABASE_URL` or set `CRAFTLY_DATA_DIR` to a persistent writable directory.

### Optional live inspiration

For real related inspiration results, add a Replit secret named:

```text
BRAVE_SEARCH_API_KEY
```

When that secret is present and valid, the related inspiration panel returns a live Brave Search result. Without the secret, or if the search API is temporarily unavailable, the panel stays useful by opening a focused Google search link based on the user's prompt.

## Auth and storage notes

- Passwords use salted `scrypt` hashes. Existing PBKDF2 hashes from the first lightweight build remain valid.
- Session cookies are HTTP-only, same-site, and marked secure when Replit forwards HTTPS. Only hashes of random session tokens are stored, sessions expire after 30 days, and logout revokes the current token.
- Auth endpoints have a small in-memory attempt limit and API requests reject cross-site browser origins.
- The built-in account flow is intentionally small: it does not yet include email verification, password reset, or multi-factor authentication. Add those before using Craftly for sensitive personal data.
