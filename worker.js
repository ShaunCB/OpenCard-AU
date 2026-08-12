const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-passcode',
};

/**
 * Minifies CDR Product Reference Data (PRD) to reduce LLM token usage.
 */
function minifyCdrData(prdArray) {
  if (!Array.isArray(prdArray)) return [];

  return prdArray.map(product => {
    const minified = {
      id: product.productId,
      name: product.name,
      brand: product.brand,
      isTailored: product.isTailored,
      features: [],
      fees: [],
      rates: [],
      eligibility: []
    };

    if (product.features) {
      minified.features = product.features
        .filter(f => f.featureType !== 'OTHER' && f.featureType !== 'DIGITAL_BANKING')
        .map(f => ({ type: f.featureType, info: f.additionalInfo }));
    }

    if (product.fees) {
      minified.fees = product.fees.map(f => ({
        type: f.feeType,
        amount: f.amount,
        name: f.name
      }));
    }

    if (product.lendingRates) {
      minified.rates = product.lendingRates.map(r => ({
        type: r.lendingRateType,
        rate: r.rate,
        name: r.name
      }));
    }

    if (product.eligibility) {
      minified.eligibility = product.eligibility.map(e => ({
        type: e.eligibilityType,
        info: e.additionalInfo,
        value: e.additionalValue
      }));
    }

    Object.keys(minified).forEach(key => {
      if (Array.isArray(minified[key]) && minified[key].length === 0) {
        delete minified[key];
      }
      if (minified[key] === null || minified[key] === undefined) {
        delete minified[key];
      }
    });

    return minified;
  });
}

// Mock function to simulate fetching PRD data from a Data Holder
async function fetchCdrData() {
  const mockData = [
    {
      productId: "CC-001",
      name: "Low Rate Master Card",
      brand: "Bank of AU",
      features: [
        { featureType: "COMPLEMENTARY_INSURANCE", additionalInfo: "Travel insurance included" }
      ],
      fees: [
        { feeType: "PERIODIC", name: "Annual Fee", amount: "59.00" }
      ],
      lendingRates: [
        { lendingRateType: "PURCHASE", name: "Purchase Rate", rate: "0.1199" },
      ],
      eligibility: [
        { eligibilityType: "MIN_AGE", additionalValue: "18" },
        { eligibilityType: "MIN_INCOME", additionalValue: "35000" }
      ]
    },
    {
      productId: "CC-002",
      name: "Platinum Rewards Visa",
      brand: "Bank of AU",
      features: [
        { featureType: "REWARDS_PROGRAM", additionalInfo: "1 point per $1 spent" }
      ],
      fees: [
        { feeType: "PERIODIC", name: "Annual Fee", amount: "250.00" }
      ],
      lendingRates: [
        { lendingRateType: "PURCHASE", name: "Purchase Rate", rate: "0.1999" }
      ],
      eligibility: [
        { eligibilityType: "MIN_INCOME", additionalValue: "75000" }
      ]
    }
  ];
  return minifyCdrData(mockData);
}

/**
 * Helper function to call OpenRouter API using native fetch
 */
async function callOpenRouter(env, model, systemPrompt, userMessage) {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not defined in environment variables.");
  }

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
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    try {
      // Passcode Auth
      const providedPasscode = request.headers.get('x-passcode');
      const validPasscode = env.RECOMMENDATION_PASSCODE;

      if (!validPasscode) {
        console.warn("WARNING: RECOMMENDATION_PASSCODE not set in env variables.");
      }

      if (!providedPasscode || providedPasscode !== validPasscode) {
        return new Response(JSON.stringify({ error: 'Unauthorized. Invalid passcode.' }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Parse JSON body
      let body;
      try {
        body = await request.json();
      } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const userProfile = body.profile;
      if (!userProfile) {
        return new Response(JSON.stringify({ error: 'User profile is required.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Fetch and minify CDR Data
      const minifiedData = await fetchCdrData();
      
      const dataContext = `User Profile:\n${JSON.stringify(userProfile, null, 2)}\n\nAvailable Credit Cards (Minified PRD):\n${JSON.stringify(minifiedData, null, 2)}`;

      // Step A: Math Agent and Risk Agent in parallel
      const mathAgentPrompt = "You are a quantitative financial AI. Analyze the provided CDR PRD JSON against the user's prompt. Calculate the estimated annual cost (fees + interest) and quantitative value of rewards. Return raw mathematical reasoning and your top 2 card picks. Ignore fine print.";
      const riskAgentPrompt = "You are a compliance and risk AI. Analyze the provided CDR PRD JSON against the user's prompt. Identify strict eligibility criteria the user might fail, highlight balance transfer traps, and point out interest-free period conditions. Return a list of risks.";

      const mathAgentPromise = callOpenRouter(env, 'deepseek/deepseek-r1', mathAgentPrompt, dataContext);
      const riskAgentPromise = callOpenRouter(env, 'anthropic/claude-3.5-sonnet', riskAgentPrompt, dataContext);

      const [mathAnalysis, riskAnalysis] = await Promise.all([mathAgentPromise, riskAgentPromise]);

      // Step B: Synthesizer Agent
      const synthesizerPrompt = "You are the final formatter. Combine the Math and Risk insights into a clean Markdown table. CONSTRAINTS: You MUST start your response with: '**⚠️ TECH DEMO DISCLAIMER:** This analysis is generated by AI for demonstration purposes only. It is not financial advice under ASIC RG 244.'";
      const synthesizerUserMessage = `Math/Value Agent Analysis:\n${mathAnalysis}\n\nRisk/Eligibility Agent Analysis:\n${riskAnalysis}\n\nPlease synthesize the agent reports based on your constraints.`;

      const finalRecommendation = await callOpenRouter(env, 'google/gemini-2.5-flash', synthesizerPrompt, synthesizerUserMessage);

      return new Response(JSON.stringify({ success: true, recommendation: finalRecommendation }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      console.error("Worker Error:", error);
      return new Response(JSON.stringify({ error: 'An error occurred while generating the recommendation.', details: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  }
};
