## Root Cause Analysis & Technical Constraints
1. **The Ghost Fix (Local vs. Deployed):** The previous AI session modified `worker.js` locally to adjust `x-v` headers, but the frontend (`RecommendationModal.js` line 12) is hardcoded to call the LIVE Cloudflare Worker at `https://cdr-recommender.mr-shaun.workers.dev`. Because the previous fix was never deployed to Cloudflare, the frontend is still hitting the old, buggy backend.
2. **The True Bug (LLM Prompt Hallucination):** Our terminal test scripts (`test-cdr-fetch.js` and `test-x-v-7.js`) prove that the CDR APIs for CommBank, NAB, Westpac, and Amex are responding perfectly to both `x-v: 5` and `x-v: 7`. The `DataValidationError` is actually a prompt engineering failure in `worker.js`. The prescreening prompt explicitly says: 
   `"Example: ["CC-01", "CC-02"]"`
   The LLM literalizes this instruction and outputs the fake example IDs instead of the real CDR UUIDs. When the worker tries to filter the real products using these fake IDs, it results in an empty array (`topProducts: []`), which triggers the `DataValidationError` in the UI.
3. **Invalid Model Identifiers:** The local `worker.js` attempts to call `moonshotai/kimi-k2.7-code`, which is an invalid OpenRouter model. 

## Target Files
- **Modified:** `worker.js` (Prompt rewriting and model updates)
- **Deployed:** We must run `wrangler deploy` to push the worker live.

## Persona Delegation
- **Backend & API Engineer:** To restructure the AI prompt engineering in the worker, align the OpenRouter model routing, and execute the Cloudflare deployment.

## Cost Governance & Model Strategy
- **google/gemini-2.5-pro:** Used for this planning and reasoning phase (Free/Subscription).
- **Worker OpenRouter Models (Automatic):** I will update `worker.js` to use `google/gemini-2.5-flash` for the fast prescreening task, and `google/gemini-2.5-pro` for the complex math and synthesis tasks to ensure reliable JSON output at negligible/free tier costs.

## Step-by-Step Execution Plan
1. **Document `x-v` Configs:** Output the requested mapping of `x-v` configurations currently in the codebase.
2. **Update `worker.js`:**
   - Rewrite the `prescreenPrompt` to remove the fake `"CC-01"` example and enforce strict extraction of real `id` values.
   - Update the model strings to reliable Gemini versions on OpenRouter.
3. **Deploy Backend:** Execute `npx wrangler deploy` in the `/worker` directory to push the fixes to `https://cdr-recommender.mr-shaun.workers.dev`.
4. **Validation:** The frontend will automatically use the fixed worker on the next run.

## Self-Testing Requirement
Standalone terminal testing for the CDR fetch has already been successfully executed, proving the API fetch works. The final self-test will be confirming a successful `wrangler deploy` exit code.
