# Implementation Plan: SOTA Upgrade & UX Fixes

## Root Cause Analysis & Technical Constraints
1. **Model Upgrades (Part 1):** You requested upgrading the agents to state-of-the-art OpenRouter models (`moonshotai/kimi-k2.7`, `deepseek/deepseek-v4-pro`, `deepseek/deepseek-v4-flash`, `openai/gpt-oss-20b`). Because these are paid, third-party OpenRouter models and NOT the native Google AI subscription models, I am strictly required by my governance rules to pause and explicitly request your permission before routing traffic to them.
2. **Form Defaults (Part 2A):** I will update the baseline defaults in `RecommendationModal.js` so that Annual Income defaults to `$100,000` and Age defaults to `30`.
3. **Charge Card vs Credit Card Logic (Part 2B):** I will update the backend JSON schema to output `avoidableFees` instead of `estAnnualInterest` for Charge Cards. I will also update the frontend UI to dynamically render either the Interest field or the Avoidable Fees field based on the card type.
4. **Already Completed Items (Part 2C & 2D):** The renaming of "Est. Net Annual Cost", the strict math rules, the mobile-first accessible tap popovers with a mandatory close button, the "Verification Required Checklist", and the concise bulleted key risks using the hazard symbol ($\triangle$) were **already fully implemented** in our previous sprint (see my last message). I will simply ensure they remain intact.

## Target Files
- **Modified:** `worker.js` (Update API calls to use the specified OpenRouter models. Update the `run_synth` prompt's JSON schema to handle `avoidableFees` for Charge Cards).
- **Modified:** `src/components/recommendation/RecommendationModal.js` (Update `AGENT_DEFINITIONS` labels. Update the default state for `income` to `'100000'` and `age` to `'30'`. Add dynamic rendering logic to hide `Est. Annual Interest` and show `Avoidable Fees` for Charge Cards).

## Persona Delegation
- **Backend & API Engineer:** Will rewire the API calls in `worker.js` to target the specific OpenRouter models and enforce the new JSON schema for charge cards.
- **Frontend & UX Architect:** Will update the UI labels, form defaults, and dynamic rendering logic in `RecommendationModal.js`.

## Cost Governance & Model Strategy
- **Primary Planning Model:** **Gemini 2.5 Pro** (Free via Subscription) is currently planning this implementation.
- **Worker Execution Models:** You requested paid models on OpenRouter for the worker pipeline:
  - **`moonshotai/kimi-k2.7`**
  - **`deepseek/deepseek-v4-pro`**
  - **`deepseek/deepseek-v4-flash`**
  - **`openai/gpt-oss-20b`**
- **Estimated Run Cost:** Assuming the typical CDR data payload size and synthesis output, a single run of this pipeline across these four frontier models will cost approximately **~$0.15 - $0.35 per execution** on OpenRouter.

## Step-by-Step Execution Plan
1. **Update `RecommendationModal.js`:** Change the `AGENT_DEFINITIONS` labels, update `income` and `age` `useState` defaults, and add the dynamic UI logic for `avoidableFees`.
2. **Update `worker.js`:** Update the `callOpenRouter` targets for each agent phase. Update the math and synthesizer prompts to strictly omit `estAnnualInterest` for Charge Cards and provide `avoidableFees` instead.
3. **Self-Testing & Deployment:** Execute `git commit` and `git push` to trigger the Cloudflare auto-deployment pipeline.

## Required Approval
I cannot proceed with swapping to paid OpenRouter models without your explicit permission.

Should I execute this plan now, or would you like to adjust the plan?
