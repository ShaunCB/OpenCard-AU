const BANKS = [
  { name: 'CommBank', url: 'https://api.commbank.com.au/public/cds-au/v1' },
  { name: 'NAB', url: 'https://openbank.api.nab.com.au/cds-au/v1' },
  { name: 'Westpac', url: 'https://digital-api.westpac.com.au/cds-au/v1' },
  { name: 'American Express', url: 'https://apigw.americanexpress.com/cdr/unauth/cds-au/v1' }
];

async function testFetch(bank, listXV = '5', detailXV = '7') {
  console.log(`\n======================================================`);
  console.log(`[TESTING] ${bank.name} with detail x-v: ${detailXV}`);
  
  const productsUrl = bank.url.replace(/\/$/, '') + '/banking/products?product-category=CRED_AND_CHRG_CARDS';
  
  try {
    const listResponse = await fetch(productsUrl, {
      method: 'GET',
      headers: { 'x-v': listXV, 'x-min-v': '1' },
    });
    const listData = await listResponse.json();
    if (!listData.data || !listData.data.products || listData.data.products.length === 0) {
      console.log(`[LIST] No products found.`);
      return;
    }
    const productId = listData.data.products[0].productId;
    console.log(`[LIST] Found product: ${productId}`);
    
    const detailUrl = bank.url.replace(/\/$/, '') + '/banking/products/' + encodeURIComponent(productId);
    console.log(`[REQUEST] GET ${detailUrl}`);
    const detailResponse = await fetch(detailUrl, {
      method: 'GET',
      headers: { 'x-v': detailXV, 'x-min-v': '1' },
    });
    
    console.log(`[RESPONSE] Status: ${detailResponse.status} ${detailResponse.statusText}`);
    const text = await detailResponse.text();
    console.log(text.substring(0, 300) + (text.length > 300 ? '...' : ''));
  } catch (error) {
    console.log(`[ERROR]`, error.message);
  }
}

async function runAllTests() {
  for (const bank of BANKS) {
    await testFetch(bank, '5', '7');
  }
}

runAllTests();
