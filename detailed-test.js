const axios = require('axios');

async function detailedTest() {
  try {
    console.log('🧪 Testing AI endpoint with detailed logging...\n');
    
    const url = 'http://localhost:5000/api/ai/query';
    const payload = { query: 'شقة في القاهرة' };
    
    console.log('📤 Sending request to:', url);
    console.log('📦 Payload:', JSON.stringify(payload, null, 2));
    
    const startTime = Date.now();
    const response = await axios.post(url, payload, {
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    const duration = Date.now() - startTime;

    console.log(`\n✅ SUCCESS! (${duration}ms)`);
    console.log('📊 Status:', response.status);
    console.log('📊 Response data:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('\n❌ FAILED!');
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    
    if (error.response) {
      console.error('\n📊 Response details:');
      console.error('  Status:', error.response.status);
      console.error('  Status text:', error.response.statusText);
      console.error('  Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('  Data:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('\n❌ No response received from server');
      console.error('Request details:', error.request._header);
    } else {
      console.error('\n❌ Error setting up request:', error.message);
    }
    
    process.exit(1);
  }
}

detailedTest();
