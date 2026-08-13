# Implementation Plan: Recommender UX & Content Fixes

## Root Cause Analysis & Technical Constraints
1. **Mobile-First Popovers vs. Markdown Output:** The current recommender output is generated as a Markdown table that is parsed into raw HTML via `marked` and injected using `dangerouslySetInnerHTML`. React components (like MUI Popover) cannot be directly embedded in this raw HTML. To solve this, the Synthesizer agent will be instructed to output interactive HTML buttons for tooltips, e.g., `<button class="info-btn" data-expl="explanation text">ⓘ</button>`. The React `RecommendationModal` component will attach a delegated `onClick` event listener to the markdown wrapper container. When an `.info-btn` is clicked, React will capture the `data-expl` attribute and open a standard Material UI `<Dialog>` (acting as the mobile-friendly modal) containing the explanation text and a required "Close" button.
2. **Calculation Rules:** The Math agent needs stricter prompting so it does not hallucinate assumed late fees, and strictly follows the formula `(Annual Fee + Est. Annual Interest) - Est. Reward Value`.
3. **Content Restructuring:** The Synthesizer agent's prompt must be completely rewritten to structure the final output with the new "Verification Required Checklist" at the top, concise bullet points with 🔺 for Key Risks, and the renaming of "Net Annual Cost" to "Est. Net Annual Cost" (with its own info button). 

## Target Files
- **Modified:** `worker.js` (Update `run_math` and `run_risk` prompts for calculation integrity and eligibility rules. Update `run_synth` prompt to generate the new layout, checklists, and `<button class="info-btn" data-expl="...">` markup).
- **Modified:** `src/components/recommendation/RecommendationModal.js` (Add a `PopoverDialog` state and component, add delegated click handling for `.info-btn` elements inside the markdown wrapper, add the global assumption legend, and ensure DOMPurify allows `button` and `data-expl` attributes).
- **Modified:** `src/index.css` (Add styling for `.info-btn` to make it look like an accessible, clickable icon and remove the old `abbr` styles).

## Persona Delegation
- **Frontend & UX Architect:** Will design the mobile-first tooltip modal dialog and delegated event listener inside `RecommendationModal.js`.
- **Backend & API Engineer:** Will engineer the prompt upgrades in `worker.js` to ensure the AI perfectly adheres to the strict calculation formulas and formatting rules.

## Cost Governance & Model Strategy
- **Tier 1 (Google AI Pro via Native Subscription):** We will continue using **Gemini 2.5 Pro** as the primary planner and coder.
- **Worker AI:** The `worker.js` will continue using `deepseek/deepseek-chat` for Math and `google/gemini-2.5-flash` for Risk and Synthesis, which are highly capable and cost-effective.

## Step-by-Step Execution Plan
1. **Update `worker.js` Math & Risk Prompts:** Add the strict formula for Est. Net Annual Cost and the instruction to avoid assuming fees unless prompted. Instruct the Risk agent to output "Verification Required (Reason)" instead of "ELIGIBLE" when data gaps exist.
2. **Update `worker.js` Synthesizer Prompt:**
   - Change the Est. Annual Interest, Est. Reward Value, and Est. Net Annual Cost rows to use the `<button class="info-btn" data-expl="...">ⓘ</button>` pattern.
   - Force the creation of a "Verification Required Checklist" section before the table.
   - Restrict Key Risks to concise bullets with 🔺.
3. **Update `RecommendationModal.js`:**
   - Add state for the info modal: `[infoModalOpen, setInfoModalOpen]` and `[infoModalContent, setInfoModalContent]`.
   - Add a delegated `onClick` handler to the `.markdownWrapper` div that checks if the clicked target matches `.info-btn`, reads `dataset.expl`, and opens the modal.
   - Render the MUI Dialog with a clear "Close" button.
   - Update `DOMPurify` to allow `button`, `class`, and `data-expl`.
   - Add the assumption legend below the table.
4. **Update `src/index.css`:** Remove `abbr` styles and add `.info-btn` styles (transparent background, blue text, cursor pointer, etc.).
5. **Self-Testing:** Run terminal commands to stage, commit, and push. Visual QA can be performed once Cloudflare deploys.
