const fetch = require('node-fetch'); // wait, native fetch is available in Node 18+

async function testWorker() {
  const WORKER_URL = 'https://cdr-recommender.mr-shaun.workers.dev';
  const PASSCODE = 'super-secret'; // wait, I don't know the passcode.
  
  const body = {
    action: 'run_prescreen',
    profile: { income: 100000 },
    bankUrls: [
      'https://api.commbank.com.au/public/cds-au/v1',
      'https://openbank.api.nab.com.au/cds-au/v1'
    ]
  };

  try {
    // Actually, maybe I can just print the passcode from RecommendationModal.js
  } catch(e) {}
}

// wait, let me just check RecommendationModal.js for the default passcode.
