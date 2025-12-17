// Simple single test
const http = require('http');

const query = process.argv[2] || "إيه حالة التفاوض؟ البائع رد؟";

const data = JSON.stringify({ query });

const options = {
  hostname: 'localhost',
  port: 5000,
  path: '/api/ai/query',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const result = JSON.parse(body);
      console.log('\n========== RESULT ==========');
      console.log('Query:', query);
      console.log('Results count:', result.meta?.resultsCount || 0);
      console.log('AI Response:', result.answer);
      console.log('============================\n');
    } catch (e) {
      console.log('Parse error:', e.message);
      console.log('Raw response:', body);
    }
  });
});

req.on('error', (e) => {
  console.log('Request error:', e.message);
});

req.write(data);
req.end();
