# quiz-bot

A React Native app (Expo SDK 57 + TypeScript) that generates quizzes from your code.

This slice implements **info sources**: connecting a GitHub repository and reading its files.

## Setup

### 1. Create a GitHub App

Credentials are obtained with the **OAuth Device Flow** against a **GitHub App**. This
combination is required, not a preference:

- A classic OAuth App's `repo` scope is all-or-nothing across every repository, so it
  cannot give per-repo access. A GitHub App lets the user pick repositories at install time.
- GitHub's web authorization-code flow requires a `client_secret` **even with PKCE**
  ("GitHub does not distinguish between public and confidential clients"), which a mobile
  app cannot hold safely. The device flow is the only flow that omits it.
- Refreshing works without a secret too — GitHub's docs state `client_secret` is
  *"Required unless the user access token was generated using the device flow."* That
  exemption is what lets the app stay connected indefinitely with no backend.

Go to **github.com/settings/apps/new** and configure:

| Setting | Value |
|---|---|
| Webhook → Active | **unchecked** |
| Enable Device Flow | **checked** (without this every poll returns `device_flow_disabled`) |
| Repository permissions → Contents | **Read-only** (Metadata: Read-only is added automatically) |
| Where can this be installed? | Any account |
| Optional Features → user-to-server token expiration | **keep enabled** |

Then copy the **Client ID** (`Iv23li…`) and the **app slug** from the app's URL.
**Do not generate a client secret** — nothing in this design uses one.

### 2. Configure the app

Paste both values into `app.json`:

```json
"extra": {
  "github": { "clientId": "Iv23li...", "appSlug": "your-app-slug" }
}
```

Neither is a secret; the client ID is expected to ship in the bundle for a public OAuth client.

### 3. Run

```bash
npm install
npx expo start -c
```

Use a **physical device** — `expo-secure-store` needs one. The device flow requires no
redirect URI, so no custom URL scheme or dev build is needed: this works in **Expo Go**.

```bash
npm run ios       # iOS simulator
npm run android   # Android emulator
npm test          # unit tests
npm run typecheck # tsc --noEmit
```

Web is not supported — `expo-secure-store` has no web implementation.

## How it works

1. **Authorize** — the app requests a device code and shows an 8-character code. The user
   enters it at `github.com/login/device`. The app polls, respecting `interval` and
   `slow_down`, until authorized. (GitHub does not return `verification_uri_complete`, so
   the code cannot be pre-filled.)
2. **Install** — the user picks *which repositories* on GitHub's installation screen. This
   is where least privilege is enforced: the token can only reach
   `installation_repos ∩ user_accessible_repos`.
3. **Pick** — the app lists installations and their repos, and the user selects sources.
4. **Read** — `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1` for the file tree and
   `GET /repos/{o}/{r}/contents/{path}` for file contents.

Tokens live in the **iOS Keychain / Android Keystore** via `expo-secure-store` with
`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, so they are readable only while the device is unlocked
and never sync to iCloud Keychain or backups. Access tokens last 8 hours and are refreshed
automatically (proactively near expiry, and reactively on a 401); refresh tokens rotate on
every refresh and last 6 months.

## Architecture

```
app/                          expo-router routes
  index.tsx                   Sources list (+ button)
  sources/new.tsx             Source-type picker (registry-driven)
  sources/[id].tsx            Source detail + proof of life
  connect/github/             3-step connect wizard
src/
  config/env.ts               GitHub App identity from expo.extra
  lib/                        errors, http, kv, query, form, time, createStore
  sources/                    InfoSource union, type registry, persistence
  features/github/
    auth/                     device flow, token lifecycle, secure storage
    api/                      REST client, error classification, endpoints
    ui/                       GitHub-specific components
  ui/                         theme + shared primitives
```

Module boundaries worth preserving: `expo-secure-store` is imported in exactly one file
(`auth/secureTokenStore.ts`), `api.github.com` is called from exactly one file
(`api/client.ts`), and `github.com` OAuth endpoints from exactly one (`auth/deviceFlow.ts`).
Screens import none of them directly — they go through the source registry.

## Known limitations (no backend)

- **Disconnect cannot revoke on GitHub's side.** `DELETE /applications/{client_id}/token`
  requires Basic auth with the client secret. The app deletes local credentials and links
  the user to `github.com/settings/apps/authorizations`.
- **No webhooks**, so revocation and repo-selection changes are discovered lazily on the
  next API call.
- **Least privilege is enforced by GitHub's installation state, not baked into the token** —
  if the user later adds repos to the installation, the existing token gains access
  immediately with no notification.
- **Rate limit is 5,000 req/hr shared** with every other app acting for that user.
- Recursive trees are capped at 100,000 entries / 7 MB; the UI surfaces `truncated`.
- An LLM API key **cannot** ship in the bundle, so quiz generation will need either
  bring-your-own-key or a thin proxy.
