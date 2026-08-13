# Implementation Plan: Fix Pre-Screener Model Slug

## Root Cause Analysis & Technical Constraints
The previously approved OpenRouter model slug `moonshotai/kimi-k2.7` is invalid on the OpenRouter network. We must update the backend to use the correct model slug `moonshotai/kimi-k2.7-code` and update the corresponding frontend label to reflect its context window.

## Target Files
- **Modified:** `worker.js` (Update model slug).
- **Modified:** `src/components/recommendation/RecommendationModal.js` (Update label in `AGENT_DEFINITIONS`).

## Persona Delegation
- **Backend Engineer:** Update `worker.js`.
- **Frontend Architect:** Update UI label.

## Cost Governance & Model Strategy
- **OpenRouter Models:** We are correcting the model slug for the pre-screener (which was already approved) to `moonshotai/kimi-k2.7-code`. No new net cost is introduced as this is a typo correction.

## Step-by-Step Execution Plan
1. Update `worker.js` replacing `moonshotai/kimi-k2.7` with `moonshotai/kimi-k2.7-code`.
2. Update `RecommendationModal.js` replacing `KIMI 2.7 (MOONSHOT AI)` with `KIMI K2.7 (262K CONTEXT)`.
3. Commit with message `fix: update invalid moonshot kimi openrouter slug` and push to main.
