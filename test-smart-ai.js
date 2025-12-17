// Test script to verify AI smart behavior
const http = require('http');

const testQueries = [
  { query: "عايز شقة", expected: "should ask for budget/location" },
  { query: "محتاج فيلا", expected: "should ask for budget/location" },
  { query: "عايز شقة في القاهرة", expected: "has location, might ask for budget" },
  { query: "عايز شقة بميزانية مليون", expected: "has budget, might search" },
  { query: "مرحبا", expected: "general chat" },
];

async function testQuery(queryObj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query: queryObj.query });
    
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
          resolve({
            query: queryObj.query,
            expected: queryObj.expected,
            answer: result.answer,
            resultsCount: result.meta?.resultsCount || 0,
            success: result.success
          });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function runTests() {
  console.log('🧪 Testing AI Smart Behavior...\n');
  
  for (const testCase of testQueries) {
    try {
      console.log(`📝 Query: "${testCase.query}"`);
      console.log(`   Expected: ${testCase.expected}`);
      
      const result = await testQuery(testCase);
      
      console.log(`   Results count: ${result.resultsCount}`);
      console.log(`   AI Response: ${result.answer?.substring(0, 200)}...`);
      console.log(`   ✅ Test completed\n`);
      console.log('-'.repeat(60) + '\n');
      
      // Wait between requests
      await new Promise(r => setTimeout(r, 2000));
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
      console.log(`   Stack: ${error.stack}\n`);
    }
  }
}

runTests().catch(console.error);
