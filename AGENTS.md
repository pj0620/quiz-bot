# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Releasing

`.eas/workflows/deploy.yml` runs on every push to `main`. There is no separate
release step, so **a merge to main ships to real devices.**

What happens depends on whether the change touches the native runtime:

- **JS, styles, assets** — published as an over-the-air update. Live in seconds,
  on next app launch. This is the common case.
- **Native runtime** — a new build plus a TestFlight submission, ~15 minutes.
  Triggered by changing a native dependency, anything in `app.json` that affects
  the build, or `patches/`. EAS decides this by fingerprint; you do not choose it.

Prefer changes that stay on the OTA path. If a change forces a rebuild, say so
in the PR description — it changes the release from seconds to a quarter hour,
and it consumes one of a limited number of monthly builds.

`npm run typecheck` and `npm test` gate the whole pipeline. If either fails,
nothing ships. Run both before opening a PR.

iOS only. `android` in `app.json` has no `package` set, so Android cannot build.

# Repo

`notes-clone/` is a local Obsidian vault used as test data. It is gitignored and
is not present in a fresh clone. Do not depend on it, and never commit it.

Submission is configured non-interactively in `eas.json` (`ascAppId`,
`appleTeamId`). Without those, a submit job on an EAS worker fails at
"Prepare credentials", because resolving the App Store Connect app needs a
prompt that no worker can answer.

`deploy.yml` cannot retry a failed submit: once a build exists for the current
fingerprint, `get-build` finds it, `build_ios` is skipped, and `submit_ios` is
skipped along with it. Use `submit.yml` with a build ID to submit a binary that
already exists.
