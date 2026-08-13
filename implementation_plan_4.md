# Implementation Plan: Fix Cloudflare Deployment Pipeline

## Root Cause Analysis & Technical Constraints
1. **The Build Error:** The Cloudflare worker deploy step failed with `npm error notarget No matching version found for miniflare...`.
2. **The Cause:** Cloudflare's build environment is using Yarn Berry (`Yarn 4.5.0`) because a `yarn.lock` exists. Yarn Berry uses Plug'n'Play (PnP) by default, meaning it does *not* create a standard `node_modules` folder. 
When Cloudflare runs its user deploy command (`npx wrangler deploy`), `npx` (which relies on npm conventions) cannot find `wrangler` locally because there is no `node_modules` directory. As a fallback, `npx` attempts to dynamically fetch the absolute latest version of `wrangler` from the global npm registry (currently `4.122.0`). This specific release of Wrangler is broken in npm because it depends on an alpha version of `miniflare` that does not exist.
3. **The Fix:** We must configure Yarn Berry to use the classic `node-modules` linker instead of PnP. This will force Yarn to create the `node_modules` folder and `.bin/wrangler` executable. When `npx` runs, it will find the local, stable version of Wrangler (`3.114.17`) already installed by Yarn, preventing it from fetching the broken release from the registry.

## Target Files
- **Modified:** `worker/.yarnrc.yml` (Add `nodeLinker: node-modules` to force standard `node_modules` resolution instead of PnP).

## Persona Delegation
- **Backend & API Engineer:** Will configure the Yarn environment explicitly to satisfy the hardcoded `npx` command in the Cloudflare CI pipeline.

## Cost Governance & Model Strategy
- **Tier 1 (Google AI Pro via Native Subscription):** We will use **Gemini 2.5 Pro** as this is a simple configuration fix requiring minimal reasoning.

## Step-by-Step Execution Plan
1. **Modify Configuration:** Append `nodeLinker: node-modules` to `worker/.yarnrc.yml`.
2. **Commit and Push:** Commit the configuration change and push to `main` to re-trigger the Cloudflare deployment pipeline.
3. **Wait for CI:** The build should now successfully resolve `wrangler` locally and deploy.
