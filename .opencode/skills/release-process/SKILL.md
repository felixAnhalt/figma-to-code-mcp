---
name: release-process
description: Release workflow — release-please, npm publish, server.json version sync, and MCP registry publishing.
---

## What I do

I know the release process for the Figma-Context-MCP npm package.

## Trigger

Push to `main` branch triggers `.github/workflows/release.yml`.

## Workflow steps

1. **Release Please** (`googleapis/release-please-action@v4`)

   - Opens/updates a release PR
   - Follows `release-please-config.json` (node release-type, bump-minor-pre-major)
   - Updates version in `package.json` and `.release-please-manifest.json`
   - Generates/updates `CHANGELOG.md`

2. **If release created:**
   - Sets up pnpm 10.10.0, Node 24
   - Runs `pnpm type-check`
   - Runs `pnpm build`
   - Publishes to npm: `pnpm publish` with `NPM_CONFIG_PROVENANCE=true`
   - Updates `server.json` version with `jq`
   - Publishes to MCP Registry via `mcp-publisher` CLI

## Version locations

- `package.json` — `version` field (e.g., "0.28.1")
- `server.json` — `version` field (e.g., "0.14.0") — sync'd by release workflow
- `.release-please-manifest.json` — `{".": "0.28.1"}` — updated by release-please

## Configuration files

- `release-please-config.json` — release-type: node, changelog-path, bump-minor-pre-major
- `server.json` — MCP registry manifest (name, description, packages, env vars)

## When to use me

Use this when:

- Preparing a release
- Debugging CI/release failures
- Understanding the version sync between package.json and server.json
