# Implementation Plan: High-Performance Refactor & Lazy Fetching

## Root Cause Analysis & Technical Constraints
1. **The Issue:** The current backend logic receives an enormous JSON array (`cdrProducts`) from the frontend which has already fetched all product details. This results in massive payload sizes, slow serialization/deserialization, and sequential processing timeouts.
2. **The Fix:** We will shift the CDR fetching logic *into* the Cloudflare Worker itself and implement a Lazy Fetch architecture with parallelism:
   - The frontend will only send `bankUrls` to the backend.
   - **Step 1 & 2 (Pre-Screener):** The worker will fetch ONLY the high-level `/products` list from the banks in parallel with an 8-second timeout, cache the results using Cloudflare's Cache API, and pass the lightweight summary to the Pre-Screener to get the Top 5.
   - **Step 3 & 4 (Detailed Analysis):** The worker will then fetch the detailed `/products/{productId}` ONLY for the selected Top 5 cards in parallel.
   - **Agent Parallelism:** The worker will then execute the Value/Cost Analyst (`math`) and Eligibility Checker (`risk`) OpenRouter API calls **CONCURRENTLY** using `Promise.all()`.
   - **Synthesis:** Once both complete, their outputs are passed to the Recommendation Editor (`synth`).

## Target Files
- **Modified:** `worker.js` (Add `fetchWithTimeout`, Cache API integration, Lazy `/products` fetching, and combine the Math, Risk, and Synth agents into a single concurrent block).
- **Modified:** `src/components/recommendation/RecommendationModal.js` (Update the Redux `mapStateToProps` to pass `bankUrls`, and refactor the `handleAnalyze` pipeline to match the new optimized 2-step worker flow: `run_prescreen` -> `run_analysis_and_synth`, while simulating the 4-step UI progress so the UX remains intact).

## Persona Delegation
- **Backend & API Engineer:** Will implement the Cache API, `Promise.all()` concurrent agent execution, and the 8-second `AbortController` timeouts in `worker.js`.
- **Frontend Architect:** Will adapt the React orchestration logic in `RecommendationModal.js` to interface with the new high-performance worker endpoints.

## Cost Governance & Model Strategy
- **Primary Planning Model:** **Gemini 2.5 Pro** (Free via Subscription).
- **Worker Execution Models:** The worker will continue to use the previously approved OpenRouter models (`moonshotai/kimi-k2.7-code`, `deepseek-v4-pro`, `deepseek-v4-flash`, `gpt-oss-20b`). No model changes are occurring in this step.

## Step-by-Step Execution Plan
1. **Update `worker.js`:**
   - Implement `fetchBankData(url)` using `caches.default.match` and `fetch` with an 8s `AbortSignal` timeout.
   - Refactor `run_prescreen` to fetch `/products` from `body.bankUrls`, returning `topProducts: [{ bankUrl, id, name }]`.
   - Create a new combined endpoint `run_analysis_and_synth` that receives the Top 5. It will fetch `/products/{id}` for those 5, run Math & Risk in `Promise.all()`, then run Synth.
2. **Update `RecommendationModal.js`:**
   - Extract `bankUrls` from Redux state.
   - Refactor `handleAnalyze` to call `run_prescreen`, then call `run_analysis_and_synth`. It will update the 4 UI status bars accurately as the promises return.
3. **Deploy:** Commit and push to `main` to trigger the Cloudflare deployment.

Should I execute this plan now, or would you like to adjust the plan?
