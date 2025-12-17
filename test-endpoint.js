const axios = require('axios');

async function testAIEndpoint() {
  try {
    console.log('🧪 Testing AI endpoint...\n');
    
    const response = await axios.post(
      'http://localhost:5000/api/ai/query',
      { query: 'شقة في القاهرة' },
      {
        headers: {
          'Content-Type': 'application/json',
          // Add your JWT token here if needed
          // 'Authorization': 'Bearer YOUR_TOKEN'
        }
      }
    );

    console.log('✅ Success!');
    console.log('📊 Response:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

testAIEndpoint();
