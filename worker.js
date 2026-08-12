const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-passcode',
};

/**
 * Minifies CDR Product Reference Data (PRD) to reduce LLM token usage.
 * Accepts real CDR product detail objects (from the `data` field of the Get Product Detail response).
 * Extracts cardArt imageUri so the synthesizer AI can embed card images in its output.
 */
function minifyCdrData(prdArray) {
  if (!Array.isArray(prdArray)) return [];

  return prdArray.map(product => {
    // Extract card image from the CDR cardArt array (real CDR data format)
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
      minified.fees = product.fees
        .filter(f => f)
        .map(f => ({
          type: f.feeType,
          // Support both direct amount and fixedAmount.amount CDR patterns
          amount: f.amount != null ? f.amount : (f.fixedAmount?.amount ?? null),
          name: f.name
        }));
    }

    if (product.lendingRates) {
      minified.rates = product.lendingRates
        .filter(r => r)
        .map(r => ({
          type: r.lendingRateType,
          rate: r.rate,
          name: r.name
        }));
    }

    if (product.eligibility) {
      minified.eligibility = product.eligibility
        .filter(e => e)
        .map(e => ({
          type: e.eligibilityType,
          info: e.additionalInfo,
          value: e.additionalValue
        }));
    }

    // Remove empty arrays and null/undefined fields to save tokens
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
      const rawProvided = request.headers.get('x-passcode');
      const providedPasscode = rawProvided ? rawProvided.trim() : null;
      const rawValid = env.RECOMMENDATION_PASSCODE;
      const validPasscode = rawValid ? rawValid.trim() : null;

      if (!validPasscode) {
        console.warn("WARNING: RECOMMENDATION_PASSCODE not set in env variables.");
      }

      if (!providedPasscode || providedPasscode !== validPasscode) {
        return new Response(JSON.stringify({ 
          error: 'Unauthorized. Invalid passcode.'
          // NOTE: Never expose the valid passcode in the response body
        }), {
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
      
      // If action is verify, just return success since passcode is already validated
      if (body.action === 'verify') {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (!userProfile) {
        return new Response(JSON.stringify({ error: 'User profile is required.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Read real CDR product data sent from the client (from Redux state)
      const rawCdrProducts = body.cdrProducts;
      if (!Array.isArray(rawCdrProducts) || rawCdrProducts.length === 0) {
        return new Response(JSON.stringify({ 
          error: 'No CDR product data provided. Please ensure at least one Data Source is loaded on the Credit & Charge Cards tab before running the analysis.' 
        }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Minify for LLM token efficiency
      const minifiedData = minifyCdrData(rawCdrProducts);
      const dataContext = `User Profile:\n${JSON.stringify(userProfile, null, 2)}\n\nAvailable Credit Cards (Minified PRD from CDR):\n${JSON.stringify(minifiedData, null, 2)}`;

      if (body.action === 'run_math') {
        const { income, monthlySpend, primaryGoal } = userProfile;
        const mathAgentPrompt = `You are a quantitative financial analyst. Using the user's EXACT financial data below, calculate the true annual cost and value for each credit/charge card in the PRD.

User Data:
- Annual Income: $${income || 'Unknown'}
- Monthly Spend: $${monthlySpend || 'Unknown'} (assume 30% is carried as revolving balance for interest calc)
- Primary Goal: ${primaryGoal || 'Not specified'}

For each card, output:
1. Annual Fee
2. Estimated Annual Interest (monthlySpend * 0.3 * 12 * purchase_rate)
3. Estimated Reward Value (calculate from spend and program details if available)
4. Net Annual Cost (fees + interest - rewards value)
5. Goal Alignment score (1-5) for the stated Primary Goal

Be precise with numbers. Do not round. Output structured reasoning.`;
        const mathAnalysis = await callOpenRouter(env, 'deepseek/deepseek-chat', mathAgentPrompt, dataContext);
        return new Response(JSON.stringify({ success: true, result: mathAnalysis }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (body.action === 'run_risk') {
        const { income, age, primaryGoal } = userProfile;
        const riskAgentPrompt = `You are an Australian consumer credit compliance expert. Check every eligibility criterion in the PRD against the user's profile and flag any issue.

User Data:
- Age: ${age || 'Unknown'}
- Annual Income: $${income || 'Unknown'}
- Primary Goal: ${primaryGoal || 'Not specified'}

For each card, output a risk assessment:
- ELIGIBLE / INELIGIBLE / UNKNOWN (if data is missing, flag as UNKNOWN RISK)
- List each eligibility criterion and whether the user passes or fails
- Flag any hidden risks: revert rates after promotional periods, balance transfer fees, missing interest-free period data
- If critical data is absent from the PRD, explicitly state 'DATA GAP — verify with issuer'

Be conservative: if in doubt, flag as a risk.`;
        const riskAnalysis = await callOpenRouter(env, 'google/gemini-2.5-flash', riskAgentPrompt, dataContext);
        return new Response(JSON.stringify({ success: true, result: riskAnalysis }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      if (body.action === 'run_synth') {
        const { mathAnalysis, riskAnalysis } = body;
        if (!mathAnalysis || !riskAnalysis) {
           return new Response(JSON.stringify({ error: 'Missing agent analysis outputs.' }), {
             status: 400,
             headers: { ...corsHeaders, 'Content-Type': 'application/json' }
           });
        }
        
        // Re-minify CDR data so the Synthesizer has access to card names and image URLs
        const minifiedData = minifyCdrData(Array.isArray(body.cdrProducts) ? body.cdrProducts : []);
        
        const { primaryGoal, needs: rawExtraNeeds } = body.userProfile || {};
        
        // Sanitize free-text input to prevent prompt injection:
        // Strip control characters, HTML tags, and excessive length
        const sanitizePromptInput = (str, maxLen = 500) => {
          if (typeof str !== 'string') return 'None';
          return str
            .replace(/[\u0000-\u001F\u007F]/g, '')  // strip control chars
            .replace(/<[^>]*>/g, '')                  // strip any HTML tags
            .slice(0, maxLen)                         // limit length
            .trim() || 'None';
        };
        const safeExtraNeeds = sanitizePromptInput(rawExtraNeeds);
        const safePrimaryGoal = sanitizePromptInput(primaryGoal, 100);
        
        const synthesizerPrompt = `You are a senior financial product comparison editor. Synthesise the Math and Risk agent reports into a polished, easy-to-read recommendation.

FORMATTING RULES:
1. Start with exactly: '**⚠️ TECH DEMO DISCLAIMER:** This analysis is generated by AI for demonstration purposes only. It is not financial advice under ASIC RG 244.'
2. Then output a brief 1-2 sentence summary of the user's primary goal: "${safePrimaryGoal || 'general value'}"
3. Show each card as a column in a Markdown comparison table with visible borders. Use the card's full brand + product name — never use internal IDs like CC-001.
4. For each card header in the table, embed the card image using: ![Card Name](image_url)
5. Include rows for: Eligibility Status, Annual Fee, Est. Annual Interest, Est. Reward Value, Net Annual Cost, Key Risks, Goal Alignment
6. After the table, add a bold "🏆 Top Pick:" section naming the single best card and a 2-sentence plain-English reason why.
7. End with a "⚠️ Data Gaps" section listing any information the user must verify directly with the issuer.`;
        const synthesizerUserMessage = `Math/Value Agent Analysis:\n${mathAnalysis}\n\nRisk/Eligibility Agent Analysis:\n${riskAnalysis}\n\nCards PRD Context (includes image URLs):\n${JSON.stringify(minifiedData, null, 2)}\n\nUser's extra notes: ${safeExtraNeeds}\n\nPlease synthesise now.`;

        const finalRecommendation = await callOpenRouter(env, 'google/gemini-2.5-flash', synthesizerPrompt, synthesizerUserMessage);
        
        return new Response(JSON.stringify({ success: true, recommendation: finalRecommendation }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      return new Response(JSON.stringify({ error: 'Invalid action provided.' }), {
        status: 400,
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
