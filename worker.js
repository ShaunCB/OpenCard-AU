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

      // 1. Pre-Screening: Lazy fetch high-level products
      if (body.action === 'run_prescreen') {
        // Always use DEFAULT_BANK_URLS — do NOT trust the frontend to supply correct bank URLs.
        // The frontend may have energy or other non-banking data sources in Redux state.
        const bankUrls = DEFAULT_BANK_URLS;

        const fetchResults = await Promise.all(
          bankUrls.map(async bankUrl => {
            const productsUrl = bankUrl.replace(/\/$/, '') + '/cds-au/v1/banking/products?product-category=CRED_AND_CHRG_CARDS&page-size=100';
            // Products list: x-v 5, x-min-v 4
            const res = await fetchBankData(productsUrl, env, '5', '4');
            if (!res || !res.data || !res.data.products) {
              console.error(`[CDR] Bank fetch failed or returned no products: ${bankUrl}`);
              return { bankUrl, success: false, products: [] };
            }
            return {
              bankUrl,
              success: true,
              products: res.data.products.map(p => ({ ...p, _bankUrl: bankUrl }))
            };
          })
        );

        const failedBanks = fetchResults.filter(r => !r.success).map(r => r.bankUrl);
        const rawCdrProducts = fetchResults.flatMap(r => r.products);

        if (failedBanks.length > 0) {
          console.warn(`[CDR] ${failedBanks.length} bank(s) failed:`, failedBanks);
        }

        if (rawCdrProducts.length === 0) {
          return new Response(JSON.stringify({
            error: 'Worker Fetch Failed',
            details: 'All bank CDR endpoints failed to return products. They may be blocking Cloudflare Worker IPs.',
            failedBanks,
          }), { status: 502, headers: corsHeaders });
        }

        const minifiedData = minifyCdrData(rawCdrProducts);
        
        const dataContext = `User Profile:\n${JSON.stringify(userProfile, null, 2)}\n\nAvailable Credit Cards:\n${JSON.stringify(minifiedData, null, 2)}`;
        const prescreenPrompt = `You are a high-speed AI screener. Filter the provided credit/charge cards based on the user's profile.
Return ONLY a raw JSON array of the top 5 most relevant products. Format strictly as:
[{"card_id": "exact-id-1", "matched_perks": ["perk1", "perk2"]}]
No markdown, no explanation, no prose. Use exact "id" strings.`;
        
        const prescreenAnalysis = await callOpenRouter(env, 'deepseek/deepseek-chat', prescreenPrompt, dataContext);
        
        let topProductIds = [];
        try {
          const jsonMatch = prescreenAnalysis.match(/\[.*?\]/s);
          const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : prescreenAnalysis);
          topProductIds = parsed.map(item => typeof item === 'string' ? item : item.card_id);
        } catch (e) {
          topProductIds = minifiedData.slice(0, 5).map(p => p.id);
        }
        
        const topProducts = minifiedData
          .filter(p => topProductIds.includes(p.id))
          .map(p => ({ id: p.id, bankUrl: p._bankUrl }));

        if (topProducts.length === 0) {
          console.error("Worker Diagnostic: LLM returned no valid IDs.", { prescreenAnalysis, topProductIds });
          const fallbackProducts = minifiedData.slice(0, 5).map(p => ({ id: p.id, bankUrl: p._bankUrl }));
          return new Response(JSON.stringify({ success: true, topProducts: fallbackProducts, failedBanks, warning: 'Pre-screener fallback used.' }), { status: 200, headers: corsHeaders });
        }

        return new Response(JSON.stringify({ success: true, topProducts, failedBanks }), { status: 200, headers: corsHeaders });
      }

      // 2. Parallel Agent Execution (Math & Risk)
      if (body.action === 'run_analysis') {
        const topProducts = (body.topProducts || []).slice(0, 5);
        if (topProducts.length === 0) return new Response(JSON.stringify({ error: 'Bad Request', details: 'No topProducts provided.' }), { status: 400, headers: corsHeaders });

        const fetchPromises = topProducts.map(tp => {
          const detailUrl = tp.bankUrl.replace(/\/$/, '') + '/cds-au/v1/banking/products/' + encodeURIComponent(tp.id);
          return fetchBankData(detailUrl, env, '7', '6').then(res => res && res.data ? { ...res.data, _bankUrl: tp.bankUrl } : null);
        });
        
        const detailResults = (await Promise.all(fetchPromises)).filter(p => p);
        const minifiedData = minifyCdrData(detailResults);
        const dataContext = `User Profile:\n${JSON.stringify(userProfile, null, 2)}\n\nCandidate Cards Details:\n${JSON.stringify(minifiedData, null, 2)}`;

        const { income, monthlySpend, primaryGoal, age, needs: rawExtraNeeds } = userProfile;
        const safeExtraNeeds = sanitizePromptInput(rawExtraNeeds);

        const mathAgentPrompt = `You are a Value & Cost Analyst. Calculate true annual cost/value for each card.
Formula: Net Annual Cost = (Annual Fee + Est Interest) - Est Reward Value
Interest: (Monthly Spend * 0.30 * 12 * Purchase Rate). For Charge Cards, Interest = 0.
Return ONLY a raw JSON object mapped by card_id. No prose, no CoT.
Format:
{
  "card_id": { "cardType": "Credit Card", "annualFee": 150, "estInterest": 0, "estRewardValue": 50, "netAnnualCost": 100, "goalAlignmentScore": 4 }
}`;

        const riskAgentPrompt = `You are an Eligibility Checker. Perform strict boolean evaluation on eligibility criteria.
Return ONLY a raw JSON object mapped by card_id. No prose.
Format:
{
  "card_id": { "eligible": true, "failedCriteria": [], "hiddenRisks": ["high revert rate"] }
}`;

        // Execute Agent 2 and Agent 3 CONCURRENTLY using Promise.all()
        const [mathAnalysis, riskAnalysis] = await Promise.all([
          callOpenRouter(env, 'deepseek/deepseek-chat', mathAgentPrompt, dataContext),
          callOpenRouter(env, 'deepseek/deepseek-chat', riskAgentPrompt, dataContext)
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
          const detailUrl = tp.bankUrl.replace(/\/$/, '') + '/cds-au/v1/banking/products/' + encodeURIComponent(tp.id);
          return fetchBankData(detailUrl, env, '7', '6').then(res => res && res.data ? { ...res.data, _bankUrl: tp.bankUrl } : null);
        });
        const detailResults = (await Promise.all(fetchPromises)).filter(p => p);
        const minifiedData = minifyCdrData(detailResults);
        
        const primaryGoal = userProfile.primaryGoal || 'Not specified';
        const safeExtraNeeds = sanitizePromptInput(userProfile.needs);
        
        const synthesizerPrompt = `You are the Recommendation Editor. Synthesise the structured Math and Risk outputs into the final JSON format. DO NOT output markdown, prose, or anything other than valid JSON.

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
      "estAnnualInterest": { "display": "Value string", "explanation": "Brief explanation" },
      "avoidableFees": { "display": "Value string", "explanation": "Brief explanation" },
      "estRewardValue": { "display": "Value string", "explanation": "Brief explanation" },
      "estNetAnnualCost": { "display": "Value string", "numValue": -150, "explanation": "Brief explanation" },
      "keyRisks": ["Risk 1", "Risk 2"],
      "goalAlignment": "X/5"
    }
  ],
  "topPickReason": "2-sentence reason naming the best card",
  "dataGaps": ["gap 1"]
}`;

        const synthMetadata = minifiedData.map(c => ({
          id: c.id,
          name: c.name,
          brand: c.brand,
          image: c.image,
          applicationUri: c.applicationUri
        }));

        const synthesizerUserMessage = `Math/Value Agent Analysis:\n${mathAnalysis}\n\nRisk/Eligibility Agent Analysis:\n${riskAnalysis}\n\nCards Metadata:\n${JSON.stringify(synthMetadata, null, 2)}\n\nUser's stated primary goal: ${primaryGoal}\nUser's extra notes: ${safeExtraNeeds}\n\nPlease synthesise into JSON now.`;

        const finalRecommendation = await callOpenRouter(env, 'deepseek/deepseek-chat', synthesizerPrompt, synthesizerUserMessage);
        
        return new Response(JSON.stringify({ success: true, recommendation: finalRecommendation }), { status: 200, headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: 'Invalid action provided.' }), { status: 400, headers: corsHeaders });
    } catch (error) {
      console.error("Worker Error:", error);
      return new Response(JSON.stringify({ error: 'An error occurred while generating the recommendation.', details: error.message }), { status: 500, headers: corsHeaders });
    }
  }
};
