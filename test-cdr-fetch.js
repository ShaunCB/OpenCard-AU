/**
 * Standalone CDR Fetch Diagnostic Script
 * 
 * RUN INSTRUCTIONS:
 * 1. Ensure you have Node.js 18+ installed (for native fetch support).
 * 2. Open your terminal in this directory.
 * 3. Run the script using: node test-cdr-fetch.js
 * 4. Review the console output to diagnose API failures.
 */

const BANKS = [
  { name: 'CommBank', url: 'https://api.commbank.com.au/public/cds-au/v1' },
  { name: 'NAB', url: 'https://openbank.api.nab.com.au/cds-au/v1' },
  { name: 'Westpac', url: 'https://digital-api.westpac.com.au/cds-au/v1' },
  { name: 'American Express', url: 'https://apigw.americanexpress.com/cdr/unauth/cds-au/v1' }
];

async function testFetchBankData(bank, xV = '5', xMinV = '1') {
  console.log(`\n======================================================`);
  console.log(`[TESTING] ${bank.name}`);
  
  const productsUrl = bank.url.replace(/\/$/, '') + '/banking/products?product-category=CRED_AND_CHRG_CARDS';
  console.log(`[REQUEST] GET ${productsUrl}`);
  console.log(`[HEADERS] x-v: ${xV}, x-min-v: ${xMinV}`);

  try {
    const response = await fetch(productsUrl, {
      method: 'GET',
      headers: { 'x-v': xV, 'x-min-v': xMinV },
    });

    console.log(`[RESPONSE] Status: ${response.status} ${response.statusText}`);
    
    // Dump Headers
    const headersObj = {};
    response.headers.forEach((value, key) => headersObj[key] = value);
    console.log(`[RESPONSE HEADERS]`, headersObj);

    if (!response.ok) {
      console.log(`[HTTP ERROR] Request failed. Response text follows:`);
      const text = await response.text();
      console.log(text.substring(0, 1000) + (text.length > 1000 ? '...\n[Truncated]' : ''));
      return;
    }

    // Try parsing JSON exactly as the application does
    const textData = await response.text();
    let data;
    try {
      data = JSON.parse(textData);
    } catch (e) {
      console.log(`[JSON PARSE ERROR] Failed to parse response as JSON:`, e.message);
      console.log(`[RAW PAYLOAD]`, textData.substring(0, 500) + '...');
      return;
    }

    // Checking the data structure
    console.log(`[DATA STRUCTURE] JSON parsed successfully. Keys at root:`, Object.keys(data));
    
    if (!data.data) {
      console.log(`[SCHEMA ERROR] Response is missing 'data' object at root.`);
      return;
    }

    if (!data.data.products) {
      console.log(`[SCHEMA ERROR] Response is missing 'data.products' array.`);
      console.log(`[AVAILABLE DATA KEYS]`, Object.keys(data.data));
      return;
    }

    const products = data.data.products;
    console.log(`[SUCCESS] Found ${products.length} products in data.products.`);
    
    if (products.length > 0) {
      console.log(`[SAMPLE PRODUCT] First item structure:`);
      console.log(JSON.stringify(products[0], null, 2));
    } else {
      console.log(`[WARNING] The products array is completely empty. The bank might not have any credit cards listed under this category.`);
    }

  } catch (error) {
    console.log(`[NETWORK/FETCH ERROR]`, error.message);
    if (error.cause) {
      console.log(`[CAUSE]`, error.cause);
    }
  }
}

async function runAllTests() {
  console.log(`Starting standalone CDR Fetch Diagnostics...`);
  for (const bank of BANKS) {
    await testFetchBankData(bank);
  }
  console.log(`\n[COMPLETE] All tests finished.`);
}

runAllTests();
