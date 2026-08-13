# Implementation Plan: Credit & Charge Card Recommender Upgrades

## Root Cause Analysis & Technical Constraints
1. **Pre-Screener Architecture:** Currently, the recommender modal relies on `state.banking[idx].productDetails`, which only populates when a user explicitly loads a product's details in the UI. To evaluate *every* card, the frontend must ensure all products (or a fetched array of them) are passed to the worker. If we rely on the frontend to fetch all details, it could spam the CDR endpoints. Instead, we can have the frontend automatically trigger the fetching of all details for `CRED_AND_CHRG_CARDS` when the modal is opened or use a batch trigger, and then pass them. Alternatively, if `cdrProducts` is already expected to be fully populated, we just need to route it through a new `run_prescreen` backend step in `worker.js` that uses Gemini 2.5 Flash to reduce the `N` products down to 5 IDs before passing them to the Math Analyst.
2. **Charge Card vs. Credit Card Interest Fix:** The current `run_math` and `run_synth` prompts in `worker.js` assume an APR calculation (Spend * 30% * 12 * purchase_rate) applies universally. Charge cards require balances to be paid in full, so traditional interest does not accrue. The backend prompts need to conditionally apply logic based on whether the product is a Charge Card. The frontend UI must also dynamically handle missing or N/A "Estimated Interest" values.
3. **UI Status Updates:** The `AGENT_DEFINITIONS` in `RecommendationModal.js` must be expanded to include the new "Pre-Screener" agent assigned to Gemini 2.5 Flash, ensuring the UI reflects this initial filtering step.
4. **Transparency Tooltips:** The AI must output JSON containing `explanation` fields. Currently, the AI outputs a Markdown table directly! To add tooltips, the synthesizer must output a structured JSON response (or an HTML/Markdown payload that supports tooltips). Since rendering tooltips in pure Markdown is difficult without custom components, the Synthesizer agent might need to output structured JSON that the React frontend renders, OR we inject HTML `<abbr title="...">` or similar tooltip markup directly into the Markdown table.

## Target Files 
- **Modified:** `worker.js` (Add `run_prescreen` action, modify `run_math` and `run_synth` prompts to handle Charge Cards and output explanation tooltips via HTML/Markdown).
- **Modified:** `src/components/recommendation/RecommendationModal.js` (Add the new Pre-Screener to `AGENT_DEFINITIONS`, update orchestration logic to call `run_prescreen` first, handle potential frontend data-fetching modifications if needed, and ensure tooltips render correctly via DOMPurify).

## Persona Delegation 
- **Backend & API Engineer:** To wire up the new `run_prescreen` step in `worker.js`, adjust the prompt logic for the Math and Synthesizer agents, and ensure robust JSON/Markdown parsing.
- **Frontend & UX Architect:** To update the `RecommendationModal.js` loading sequence, integrate the new status indicator, and ensure the UI elegantly handles the new tooltip and Charge Card display logic.

## Cost Governance & Model Strategy 
- **Tier 1 (Google AI Pro via Native Subscription):** We will use **Gemini 2.5 Pro** as the primary workhorse to perform these code edits efficiently, as it involves coordinating state across a React frontend and a Cloudflare worker backend.
- **OpenRouter (Worker API):** In `worker.js`, we will update the API calls to use `google/gemini-2.5-flash` for the new `run_prescreen` step, which is ultra-cheap and fast for filtering large JSON arrays.

## Step-by-Step Execution Plan
1. **Frontend Fetching (Investigation):** Confirm how to fetch all `productDetails` on the frontend before calling the worker, ensuring the worker receives the full catalog of cards.
2. **Worker Pre-Screener:** Add `run_prescreen` to `worker.js`. It will take the massive `minifiedData`, prompt `google/gemini-2.5-flash` to return a JSON array of the top 5 `productId`s, and return these IDs.
3. **Worker Math & Synthesizer Update:** 
   - Modify `run_math` to filter `minifiedData` down to only the 5 IDs returned by the pre-screener.
   - Update `run_math` prompt to differentiate Charge Cards (no APR) and output explanations for its calculations.
   - Update `run_synth` prompt to utilize HTML `<abbr title="explanation">Label</abbr>` or similar syntax for the Markdown table to natively support tooltips in the UI, and to handle the absence of Estimated Interest for Charge Cards.
4. **Frontend Orchestration & UI:** Update `RecommendationModal.js` to:
   - Add the Pre-Screener to `AGENT_DEFINITIONS`.
   - Update `handleAnalyze` to sequentially await `run_prescreen`, then trigger `run_math` and `run_risk` in parallel with the filtered IDs, and finally `run_synth`.
   - Ensure `DOMPurify` allows the HTML attributes needed for tooltips (e.g., `<abbr title="...">`).

## Self-Testing Requirement 
- We will visually verify the UI sequence using the `browser_subagent` or `windows-ui-tester` (if applicable) to ensure the Pre-Screener step appears and tooltips render correctly in the Markdown output.
