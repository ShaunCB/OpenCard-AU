const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-passcode',
};

async function fetchBankData(url, env, xV = '5', xMinV = '1') {
  const cache = caches.default;
  const cacheKey = new Request(url, { method: 'GET', headers: { 'x-v': xV, 'x-min-v': xMinV } });
  let response = await cache.match(cacheKey);
  if (!response) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { 'x-v': xV, 'x-min-v': xMinV },
        signal: controller.signal
      });
      clearTimeout(timeout);
      
      const respondedVersion = response.headers.get('x-v');
      console.log(`[CDR API] Fetched ${url}. Target: v${xV}, Negotiated: v${respondedVersion}, Status: ${response.status}`);
      
      if (response.ok) {
        const responseToCache = new Response(response.clone().body, response);
        responseToCache.headers.append("Cache-Control", "s-maxage=86400");
        await cache.put(cacheKey, responseToCache);
      }
    } catch (e) {
      clearTimeout(timeout);
      console.warn("Fetch timeout or error for:", url, e.message);
      return null;
    }
  }
  return response && response.ok ? await response.json() : null;
}

function minifyCdrData(prdArray) {
  if (!Array.isArray(prdArray)) return [];

  return prdArray.map(product => {
    const cardArtEntry = Array.isArray(product.cardArt)
      ? product.cardArt.find(a => a && a.imageUri)
      : null;
    const imageUri = cardArtEntry ? cardArtEntry.imageUri : null;

    const minified = {
      id: product.productId,
      name: product.name,
      brand: product.brand || product.brandName,
      isTailored: product.isTailored,
      image: imageUri,
      applicationUri: product.applicationUri || null,
      _bankUrl: product._bankUrl, // Track origin bank for targeted detail fetching
      features: [],
      fees: [],
      rates: [],
      eligibility: []
    };

    if (product.features) {
      minified.features = product.features
        .filter(f => f && f.featureType !== 'OTHER' && f.featureType !== 'DIGITAL_BANKING')
        .map(f => ({ type: f.featureType, info: f.additionalInfo }));
    }
    if (product.fees) {
      minified.fees = product.fees.filter(f => f).map(f => ({
        type: f.feeType,
        amount: f.amount != null ? f.amount : (f.fixedAmount?.amount ?? null),
        name: f.name
      }));
    }
    if (product.lendingRates) {
      minified.rates = product.lendingRates.filter(r => r).map(r => ({
        type: r.lendingRateType,
        rate: r.rate,
        name: r.name
      }));
    }
    if (product.eligibility) {
      minified.eligibility = product.eligibility.filter(e => e).map(e => ({
        type: e.eligibilityType,
        info: e.additionalInfo,
        value: e.additionalValue
      }));
    }

    Object.keys(minified).forEach(key => {
      if (Array.isArray(minified[key]) && minified[key].length === 0) delete minified[key];
      if (minified[key] === null || minified[key] === undefined) delete minified[key];
    });

    return minified;
  });
}

async function callOpenRouter(env, model, systemPrompt, userMessage) {
  if (!env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is not defined.");

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://shauncb.github.io/OpenCard-AU/',
      'X-Title': 'OpenCard-AU Multi-Agent Worker'
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage }
      ]
    })
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenRouter API error: ${errText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
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

      // 1. Pre-Screening: Lazy fetch high-level products
      if (body.action === 'run_prescreen') {
        const bankUrls = (Array.isArray(body.bankUrls) ? body.bankUrls : []).slice(0, 5);
        if (bankUrls.length === 0) return new Response(JSON.stringify({ error: 'Bad Request', details: 'No bankUrls provided.' }), { status: 400, headers: corsHeaders });

        const fetchPromises = bankUrls.map(bankUrl => {
          const productsUrl = bankUrl.replace(/\/$/, '') + '/banking/products?product-category=CRED_AND_CHRG_CARDS';
          return fetchBankData(productsUrl, env, '5', '1').then(res => {
            if (!res || !res.data || !res.data.products) return [];
            return res.data.products.map(p => ({ ...p, _bankUrl: bankUrl }));
          });
        });
        
        const allResults = await Promise.all(fetchPromises);
        const rawCdrProducts = allResults.flat();
        const minifiedData = minifyCdrData(rawCdrProducts);
        
        const dataContext = `User Profile:\n${JSON.stringify(userProfile, null, 2)}\n\nAvailable Credit Cards:\n${JSON.stringify(minifiedData, null, 2)}`;
        const prescreenPrompt = `You are a high-speed AI screener. Review the user's profile and the full catalog of credit & charge cards provided in the JSON data.
Filter the list and select the Top 5 most relevant product IDs for this user based on their primary goal, income, and spend.
Return ONLY a raw JSON array of up to 5 product ID strings. Do not include markdown formatting, backticks, or any explanation. Example of the output format: ["exact-id-1", "exact-id-2"]. You MUST strictly use the exact string values from the "id" fields in the provided JSON data. Do not hallucinate or use fake IDs.`;
        
        const prescreenAnalysis = await callOpenRouter(env, 'google/gemini-2.5-flash', prescreenPrompt, dataContext);
        
        let topProductIds = [];
        try {
          const jsonMatch = prescreenAnalysis.match(/\[.*\]/s);
          topProductIds = JSON.parse(jsonMatch ? jsonMatch[0] : prescreenAnalysis);
        } catch (e) {
          topProductIds = minifiedData.slice(0, 5).map(p => p.id);
        }
        
        const topProducts = minifiedData
          .filter(p => topProductIds.includes(p.id))
          .map(p => ({ id: p.id, bankUrl: p._bankUrl }));

        return new Response(JSON.stringify({ success: true, topProducts }), { status: 200, headers: corsHeaders });
      }

      // 2. Parallel Agent Execution (Math & Risk)
      if (body.action === 'run_analysis') {
        const topProducts = (body.topProducts || []).slice(0, 5);
        if (topProducts.length === 0) return new Response(JSON.stringify({ error: 'Bad Request', details: 'No topProducts provided.' }), { status: 400, headers: corsHeaders });

        const fetchPromises = topProducts.map(tp => {
          const detailUrl = tp.bankUrl.replace(/\/$/, '') + '/banking/products/' + encodeURIComponent(tp.id);
          return fetchBankData(detailUrl, env, '7', '1').then(res => res && res.data ? { ...res.data, _bankUrl: tp.bankUrl } : null);
        });
        
        const detailResults = (await Promise.all(fetchPromises)).filter(p => p);
        const minifiedData = minifyCdrData(detailResults);
        const dataContext = `User Profile:\n${JSON.stringify(userProfile, null, 2)}\n\nCandidate Cards Details:\n${JSON.stringify(minifiedData, null, 2)}`;

        const { income, monthlySpend, primaryGoal, age, needs: rawExtraNeeds } = userProfile;
        const safeExtraNeeds = sanitizePromptInput(rawExtraNeeds);

        const mathAgentPrompt = `You are a quantitative financial analyst. Using the user's EXACT financial data below, calculate the true annual cost and value for each credit/charge card in the PRD.
User Data:
- Annual Income: $${income || 'Unknown'}
- Monthly Spend: $${monthlySpend || 'Unknown'} (assume 30% is carried as revolving balance for interest calc if it is a credit card)
- Primary Goal: ${primaryGoal || 'Not specified'}
- Extra Needs: ${safeExtraNeeds || 'None'}

For each card, output:
1. Card Type: State whether it is a "Credit Card" or "Charge Card" (check descriptions and features).
2. Annual Fee
3. Estimated Interest/Fees: If it is a Credit Card, calculate (monthlySpend * 0.3 * 12 * purchase_rate). If it is a Charge Card, explicitly state "$0 (Charge Card - balance paid in full)" and note any late/statement fees instead. Include a brief explanation for the calculation.
   - CRITICAL RULE: DO NOT assume or calculate avoidable fees (like late fees, foreign transaction fees, or cash advance fees) unless the user's "Extra Needs" explicitly states an intention to incur them.
4. Estimated Reward Value: Calculate from spend and program details if available. Include a brief explanation for the calculation.
5. Est. Net Annual Cost: Calculate strictly as (Annual Fee + Estimated Interest) - Estimated Reward Value. Output the value and a brief explanation for the calculation.
6. Goal Alignment score (1-5) for the stated Primary Goal

Be precise with numbers. Do not round. Output structured reasoning. Note whether each card is a Credit Card or Charge Card.`;

        const riskAgentPrompt = `You are an Australian consumer credit compliance expert. Check every eligibility criterion in the PRD against the user's profile and flag any issue.
User Data:
- Age: ${age || 'Unknown'}
- Annual Income: $${income || 'Unknown'}
- Primary Goal: ${primaryGoal || 'Not specified'}

For each card, output a risk assessment:
- ELIGIBLE / INELIGIBLE / VERIFICATION REQUIRED (if data like residency or exact income is missing, flag as VERIFICATION REQUIRED and state the reason)
- List each eligibility criterion and whether the user passes or fails
- Flag any hidden risks: revert rates after promotional periods, balance transfer fees, missing interest-free period data
- If critical data is absent from the PRD, explicitly state 'DATA GAP — verify with issuer'

Be conservative: if in doubt, flag as a risk.`;

        // Execute Agent 2 and Agent 3 CONCURRENTLY using Promise.all()
        const [mathAnalysis, riskAnalysis] = await Promise.all([
          callOpenRouter(env, 'google/gemini-2.5-pro', mathAgentPrompt, dataContext),
          callOpenRouter(env, 'google/gemini-2.5-flash', riskAgentPrompt, dataContext)
        ]);

        return new Response(JSON.stringify({ success: true, mathAnalysis, riskAnalysis }), { status: 200, headers: corsHeaders });
      }

      // 3. Final Synthesis
      if (body.action === 'run_synth') {
        const { mathAnalysis, riskAnalysis } = body;
        const topProducts = (body.topProducts || []).slice(0, 5);
        if (!mathAnalysis || !riskAnalysis) return new Response(JSON.stringify({ error: 'Bad Request', details: 'Missing agent analysis outputs.' }), { status: 400, headers: corsHeaders });
        if (topProducts.length === 0) return new Response(JSON.stringify({ error: 'Bad Request', details: 'No topProducts provided.' }), { status: 400, headers: corsHeaders });

        const fetchPromises = topProducts.map(tp => {
          const detailUrl = tp.bankUrl.replace(/\/$/, '') + '/banking/products/' + encodeURIComponent(tp.id);
          return fetchBankData(detailUrl, env, '7', '1').then(res => res && res.data ? { ...res.data, _bankUrl: tp.bankUrl } : null);
        });
        const detailResults = (await Promise.all(fetchPromises)).filter(p => p);
        const minifiedData = minifyCdrData(detailResults);
        
        const safeExtraNeeds = sanitizePromptInput(userProfile.needs);
        
        const synthesizerPrompt = `You are a senior financial product comparison editor. Synthesise the Math and Risk agent reports into a strict JSON object. DO NOT output markdown, code blocks, or any other text. Output ONLY valid JSON.

JSON SCHEMA:
{
  "goalSummary": "1-2 sentence summary of user's primary goal",
  "verificationChecklist": ["item 1", "item 2", "..."], // Consolidate all generic data gaps/global verification requirements here. Empty array if none.
  "cards": [
    {
      "name": "Full product name",
      "brand": "Brand name",
      "image": "image url or null",
      "applicationUri": "application url or null",
      "eligibility": "Eligibility status (e.g. 'Verification Required (Reason)')",
      "annualFee": "Annual fee string",
      "estAnnualInterest": { "display": "Value string", "explanation": "Brief explanation of calculation" }, // set to null if Charge Card
      "avoidableFees": { "display": "Value string", "explanation": "Brief explanation of avoidable fees" }, // omit if Credit Card, include only if Charge Card
      "estRewardValue": { "display": "Value string", "explanation": "Brief explanation" },
      "estNetAnnualCost": { "display": "Value string", "numValue": -150, "explanation": "Brief explanation. numValue must be a number representing the cost (negative for profit/gain, positive for cost)" },
      "keyRisks": ["High revert rate", "Risk 2"], // Concise high-priority risks not in global checklist
      "goalAlignment": "X/5"
    }
  ],
  "topPickReason": "2-sentence reason naming the best card",
  "dataGaps": ["gap 1"] // Any remaining data gaps
}

CRITICAL INSTRUCTIONS:
1. Ensure the JSON is perfectly formatted.
2. The cards array MUST contain an object for EVERY card analyzed.
3. For keyRisks, use concise strings without bullet points or emojis (the UI will add the 🔺).
4. estNetAnnualCost.numValue must be a raw number representing the financial cost (e.g., if the user makes a net profit of $150, numValue is -150).`;

        const synthesizerUserMessage = `Math/Value Agent Analysis:\n${mathAnalysis}\n\nRisk/Eligibility Agent Analysis:\n${riskAnalysis}\n\nCards PRD Context:\n${JSON.stringify(minifiedData, null, 2)}\n\nUser's extra notes: ${safeExtraNeeds}\n\nPlease synthesise into JSON now.`;

        const finalRecommendation = await callOpenRouter(env, 'google/gemini-2.5-pro', synthesizerPrompt, synthesizerUserMessage);
        
        return new Response(JSON.stringify({ success: true, recommendation: finalRecommendation }), { status: 200, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'Invalid action provided.' }), { status: 400, headers: corsHeaders });
    } catch (error) {
      console.error("Worker Error:", error);
      return new Response(JSON.stringify({ error: 'An error occurred while generating the recommendation.', details: error.message }), { status: 500, headers: corsHeaders });
    }
  }
};
