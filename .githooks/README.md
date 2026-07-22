# Git hooks

Version-controlled git hooks for this repo. They scan for secrets so nobody
accidentally commits a secret value into history.

## Enable

```sh
git config core.hooksPath .githooks
```

That points git at this directory for all hooks. To go back to the default:

```sh
git config --unset core.hooksPath
```

## What runs

- `pre-commit` — scans the **added** lines of staged files for any configured
  secret value and blocks the commit if one is found.
- `commit-msg` — scans the commit message for the same values.

Configured secret names are read (comma-separated) from the
`CLOUD_AGENT_INJECTED_SECRET_NAMES` environment variable; each name's value is
read from the environment.

## The bug these fixes

An earlier version of the scanner resolved a secret's value from its name with
bash indirect expansion, `${!name}`. Secret names are human-readable and can
contain spaces or other characters that are not valid shell variable
identifiers (for example `API Key`). On such a name `${!name}` fails with
`invalid variable name`, and because the script runs under `set -e` the whole
hook aborted **before scanning anything** — so every commit failed and people
resorted to `git commit --no-verify`, defeating the scanner entirely.

The fix: iterate the names as an array (quoted, so spaces are preserved) and
read each value with `printenv` instead of `${!name}`. `printenv` accepts any
name, including ones with spaces, and never aborts the hook.

## Intentional secrets in fixtures

If a line legitimately contains something that looks like a secret (e.g. a test
fixture), add a trailing marker so the scanner skips it:

```
const token = "example-value"; // pragma: allowlist secret
```
