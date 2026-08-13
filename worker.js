const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-passcode',
};

// Data fetching and minification are now handled by the frontend client.
async function callOpenRouter(env, requestedModel, systemPrompt, userMessage) {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");

  // If the user requests a fictional/future model, we attempt it, but fallback to a real model if it fails
  const attemptCall = async (modelToUse) => {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://shauncb.github.io/OpenCard-AU/',
        'X-Title': 'OpenCard AU'
      },
      body: JSON.stringify({
        model: modelToUse,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage }
        ]
      })
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`OpenRouter API error: ${res.status} ${errorText}`);
    }
    const data = await res.json();
    return data.choices[0].message.content;
  };

  try {
    return await attemptCall(requestedModel);
  } catch (error) {
    console.warn(`[Model Fallback] Requested model '${requestedModel}' failed (${error.message}). Falling back to deepseek/deepseek-v4-flash.`);
    return await attemptCall('deepseek/deepseek-v4-flash');
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    if (request.method === 'GET' && url.pathname === '/health') {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });

    try {
      const providedPasscode = (request.headers.get('x-passcode') || '').trim();
      const validPasscode = (env.RECOMMENDATION_PASSCODE || '').trim();

      if (!providedPasscode || providedPasscode !== validPasscode) {
        return new Response(JSON.stringify({ error: 'Unauthorized.' }), { status: 401, headers: corsHeaders });
      }

      const body = await request.json();
      if (body.action === 'verify') return new Response(JSON.stringify({ success: true }), { status: 200, headers: corsHeaders });

      const userProfile = body.profile;
      if (!userProfile) return new Response(JSON.stringify({ error: 'User profile is required.' }), { status: 400, headers: corsHeaders });

      const sanitizePromptInput = (str, maxLen = 500) => {
        if (typeof str !== 'string') return 'None';
        return str.replace(/[\u0000-\u001F\u007F]/g, '').replace(/<[^>]*>/g, '').slice(0, maxLen).trim() || 'None';
      };

      // 2. Single-Pass Monolithic Architecture
      if (body.action === 'run_single_analysis') {
        const { cdrProducts } = body;
        let dataToProcess = cdrProducts || [];
        
        let stringifiedData = JSON.stringify(dataToProcess);
        if (stringifiedData.length > 400000) {
           dataToProcess = dataToProcess.filter(p => {
               const lowerName = (p.name || '').toLowerCase();
               return !lowerName.includes('business') && !lowerName.includes('commercial') && !lowerName.includes('corporate');
           });
           stringifiedData = JSON.stringify(dataToProcess);
        }

        const { income, monthlySpend, primaryGoal, age, needs: rawExtraNeeds, payInFull, topCategories } = userProfile;
        const cats = Array.isArray(topCategories) ? topCategories.join(', ') : 'None specified';
        
        const systemPrompt = `You are an expert Consumer Data Right (CDR) Credit Card Recommender. Your goal is to analyze the provided user financial profile against the provided JSON array of available credit card products and output a synthesized, highly accurate recommendation.

Execute the following logical steps internally before returning your output:
1. PRE-SCREENING: Filter out any cards in the CDR data where the user does not meet the minimum income, age, or residency eligibility criteria.
   - DO NOT exclude a card just because the user's income is ABOVE the minimum requirement. High-income users are fully eligible for basic/low-fee cards.
   - STRICT GOAL ALIGNMENT: The recommended cards MUST possess features that directly satisfy the user's Primary Goal (e.g., if the goal is 'Balance Transfer', the card MUST have a balance transfer feature; if 'Cashback', it MUST be a cashback card). Do not recommend irrelevant cards.
   - CRITICAL DATA HOLDER MANDATE: You must evaluate products across all provided issuers. If standard major bank cards (e.g., CommBank, NAB, Westpac) are excluded, you MUST document the specific disqualification reason for each in the "excludedMajorCards" array.
   - PROVIDER DIVERSITY: Ensure your recommended cards are diversified. Do NOT recommend all 4 cards from the exact same provider/brand.
   - If the user's goal is "Flexible Bank Points", prioritize cards with flexible bank reward programs over direct-earn airline cards (like Velocity or Qantas).
2. VALUE & COST ANALYSIS: For the remaining eligible cards, calculate the net annual value by weighing the annual fees and standard interest rates against the estimated rewards return based on the user's stated spending habits.
   - REWARD VALUATION RULES (CRITICAL): NEVER assume 1 Point = $1.00 AUD. You must apply these baseline valuations:
     - Airline Frequent Flyer Points (e.g., Velocity, Qantas): $0.01 AUD per point.
     - Flexible Bank Reward Points (e.g., Amex MR, CBA Awards, NAB Rewards): $0.005 AUD per point.
   - CATEGORY SPEND ASSUMPTION: Do not apply the highest point multiplier to 100% of the spend. Assume a realistic split: 30% of spend goes to bonus categories (e.g., supermarkets/petrol at the higher rate) and 70% goes to the base 1x earn rate. Factor in flat annual perks like travel credits by adding them directly to the reward value.
   - Calculate Est. Net Annual Cost using this exact formula: Annual Fee - (Total Reward Value) + Estimated Annual Interest.
3. RISK ASSESSMENT: Flag any hidden risks (e.g., high cash advance rates, expiring introductory promotional periods, or international transaction fees) that conflict with the user's profile.
4. SYNTHESIS: Select EXACTLY ONE Top Recommended Card and AT LEAST 3 Runner-Up Cards (you must recommend a minimum of 4 cards in total).

Format your final output as a strict, structured JSON object containing the recommended card, a detailed numerical breakdown of its net value, the eligibility confidence score, any important risk warnings, and the excluded major cards reasoning. Do not include speculative financial or trading advice.

JSON SCHEMA:
{
  "goalSummary": "1-2 sentence summary of user's primary goal",
  "verificationChecklist": ["item 1", "item 2", "..."],
  "cards": [
    {
      "name": "Full product name",
      "brand": "Brand name",
      "image": "image url or null",
      "applicationUri": "application url or null",
      "eligibility": "Eligibility status",
      "annualFee": "Annual fee string",
      "estAnnualInterest": { "display": "Value string (or N/A for charge cards)", "explanation": "Exact mathematical derivation" },
      "avoidableFees": { "display": "Value string", "explanation": "Brief explanation" },
      "estRewardValue": { "display": "Value string", "explanation": "MUST SHOW EXACT FORMULA like: Calculation: ((Annual Spend $48,000 x 30% in 3x category) + (Annual Spend $48,000 x 70% in 1x category)) x $0.005 per point + $200 Travel Credit = Total Est Value" },
      "estNetAnnualCost": { "display": "Value string", "numValue": -150, "explanation": "Exact breakdown, e.g. Annual Fee ($440) - Reward Value (75k pts x $0.01/pt = $750) + Interest ($0) = -$310 Net Cost" },
      "keyRisks": ["Risk 1", "Risk 2"],
      "decisionMatrix": {
        "inclusionSteps": ["Step 1 explaining why this matched their profile", "Step 2"],
        "decisiveFactor": "The single most important metric or perk that placed this card here."
      },
      "goalAlignment": "X/5"
    }
  ],
  "excludedMajorCards": [
    { "brand": "Brand name", "cardName": "Card name", "reason": "Specific disqualification reason" }
  ],
  "topPickReason": "2-sentence reason naming the best card",
  "dataGaps": ["gap 1"]
}`;

        const userMessage = `User Profile:
- Goal: ${primaryGoal}
- Pays balance in full: ${payInFull}
- Spend: $${monthlySpend}/month (Top categories: ${cats})
- Income: $${income}, Age: ${age}
- Extra Needs: ${sanitizePromptInput(rawExtraNeeds)}

Cards Metadata:
${stringifiedData}`;

        const finalRecommendation = await callOpenRouter(env, 'deepseek/deepseek-v4-flash', systemPrompt, userMessage);
        
        return new Response(JSON.stringify({ success: true, recommendation: finalRecommendation }), { status: 200, headers: corsHeaders });
      }
      
      // 4. Cutting Room Floor Assessment
      if (body.action === 'run_exclusion_reasoning') {
        const { cardId, targetCard } = body;
        if (!cardId || !targetCard) return new Response(JSON.stringify({ error: 'Missing card details.' }), { status: 400, headers: corsHeaders });
        
        const { income, monthlySpend, primaryGoal, age, needs: rawExtraNeeds, payInFull, topCategories } = userProfile;
        const cats = Array.isArray(topCategories) ? topCategories.join(', ') : 'None specified';
        
        const reasoningPrompt = `You are a strict financial product reviewer. A user has asked why the following credit/charge card was EXCLUDED from their top recommendations.
User Profile:
- Goal: ${primaryGoal}
- Pays balance in full: ${payInFull}
- Spend: $${monthlySpend}/month (Top categories: ${cats})
- Income: $${income}, Age: ${age}
- Extra Needs: ${sanitizePromptInput(rawExtraNeeds)}

Card Details:
${JSON.stringify(targetCard, null, 2)}

Provide a concise, direct paragraph explaining exactly why this card was not a top recommendation for this specific user. Be highly specific (e.g. "Excluded because the user selected 'Balance Transfer', and this card does not offer balance transfer facilities" or "The $695 fee offsets the rewards on a $5k spend"). Do NOT output JSON, just the text string.`;

        const reasoning = await callOpenRouter(env, 'deepseek/deepseek-v4-flash', reasoningPrompt, "Explain exclusion now.");
        return new Response(JSON.stringify({ success: true, reasoning: reasoning.trim() }), { status: 200, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'Invalid action provided.' }), { status: 400, headers: corsHeaders });
    } catch (error) {
      console.error("Worker Error:", error);
      return new Response(JSON.stringify({ error: 'An error occurred while generating the recommendation.', details: error.message }), { status: 500, headers: corsHeaders });
    }
  }
};
