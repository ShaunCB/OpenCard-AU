const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-passcode',
};

// Default CDR data holders for credit & charge card recommendations.
// These are confirmed publicBaseUris from the Australian CDR Register / data holders.
const DEFAULT_BANK_URLS = [
  'https://apigw.americanexpress.com/cdr/unauth',            // American Express (fixed base URL)
  'https://api.commbank.com.au/public',                      // Commonwealth Bank
  'https://api.productcloud.com.au/public/LATITUDECARDS',    // Latitude Credit Cards
  'https://openbank.api.nab.com.au',                         // National Australia Bank
  'https://digital-api.westpac.com.au',                      // Westpac
];

async function fetchBankData(url, env, xV = '5', xMinV = '4') {
  const cache = caches.default;
  const cacheKey = new Request(url, { method: 'GET', headers: { 'x-v': xV, 'x-min-v': xMinV } });
  let response = await cache.match(cacheKey);
  if (!response) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-v': xV,
          'x-min-v': xMinV,
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; OpenCard-AU/1.0; +https://shauncb.github.io/OpenCard-AU/)'
        },
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

  // Hard-filter: only process credit & charge card products.
  // This is the CDR product category for credit cards and charge cards.
  const CARD_CATEGORIES = ['CRED_AND_CHRG_CARDS', 'BUSINESS_CARDS', 'CORPORATE_CARDS'];
  const cardProducts = prdArray.filter(p => p && CARD_CATEGORIES.includes(p.productCategory));

  return cardProducts.map(product => {
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

      // 1. Data Pre-Fetching
      if (body.action === 'prefetch_data') {
        const bankUrls = DEFAULT_BANK_URLS;
        const fetchResults = await Promise.all(
          bankUrls.map(async bankUrl => {
            const productsUrl = bankUrl.replace(/\/$/, '') + '/cds-au/v1/banking/products?product-category=CRED_AND_CHRG_CARDS&page-size=100';
            const res = await fetchBankData(productsUrl, env, '5', '4');
            if (!res || !res.data || !res.data.products) return { bankUrl, success: false, products: [] };
            return {
              bankUrl,
              success: true,
              products: res.data.products.map(p => ({ ...p, _bankUrl: bankUrl }))
            };
          })
        );
        const rawCdrProducts = fetchResults.flatMap(r => r.products);
        const minifiedData = minifyCdrData(rawCdrProducts);
        return new Response(JSON.stringify({ success: true, cdrProducts: minifiedData }), { status: 200, headers: corsHeaders });
      }

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
2. VALUE & COST ANALYSIS: For the remaining eligible cards, calculate the net annual value by weighing the annual fees and standard interest rates against the estimated rewards return based on the user's stated spending habits.
3. RISK ASSESSMENT: Flag any hidden risks (e.g., high cash advance rates, expiring introductory promotional periods, or international transaction fees) that conflict with the user's profile.
4. SYNTHESIS: Select the single best card for the user and up to two runner-up alternatives.

Format your final output as a strict, structured JSON object containing the recommended card, a detailed numerical breakdown of its net value, the eligibility confidence score, and any important risk warnings. This JSON will be parsed directly by the UI to render the recommendation cards. Do not include speculative financial or trading advice; strictly evaluate consumer credit metrics.

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
      "estRewardValue": { "display": "Value string", "explanation": "Exact mathematical derivation" },
      "estNetAnnualCost": { "display": "Value string", "numValue": -150, "explanation": "Mathematical formula string" },
      "keyRisks": ["Risk 1", "Risk 2"],
      "decisionMatrix": {
        "inclusionSteps": ["Step 1 explaining why this matched their profile", "Step 2"],
        "decisiveFactor": "The single most important metric or perk that placed this card here."
      },
      "goalAlignment": "X/5"
    }
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

        const finalRecommendation = await callOpenRouter(env, 'meta-llama/llama-3.3-70b-instruct', systemPrompt, userMessage);
        
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
${JSON.stringify(minifyCdrData([targetCard])[0], null, 2)}

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
