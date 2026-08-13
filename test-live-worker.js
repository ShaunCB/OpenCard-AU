const https = require('https');

const data = JSON.stringify({
  action: 'run_prescreen',
  bankUrls: [
    "https://api.commbank.com.au/public/cds-au/v1",
    "https://openbank.api.nab.com.au/cds-au/v1"
  ],
  profile: {
    income: "100000",
    monthlySpend: "3000",
    primaryGoal: "Rewards",
    age: "30",
    needs: ""
  }
});

const req = https.request('https://cdr-recommender.mr-shaun.workers.dev', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-passcode': 'super-secret', // Replace with valid passcode if known, or bypass? wait, worker requires a passcode!
    'Content-Length': Buffer.byteLength(data)
  }
}, (res) => {
  let responseData = '';
  res.on('data', chunk => responseData += chunk);
  res.on('end', () => {
    console.log(`STATUS: ${res.statusCode}`);
    console.log(`BODY: ${responseData}`);
  });
});

req.on('error', (e) => {
  console.error(`problem with request: ${e.message}`);
});

req.write(data);
req.end();
