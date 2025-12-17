const axios = require('axios');

async function quickTest() {
  try {
    console.log('Testing /api/ai/query endpoint...');
    
    const response = await axios.post('http://localhost:5000/api/ai/query', {
      query: 'شقة في القاهرة'
    });

    console.log('\n✅ SUCCESS! Status:', response.status);
    console.log('Response data:', JSON.stringify(response.data, null, 2));
    process.exit(0);
    
  } catch (error) {
    console.error('\n❌ FAILED!');
    console.error('Error message:', error.message);
    
    if (error.response) {
      console.error('Status code:', error.response.status);
      console.error('Response:', JSON.stringify(error.response.data, null, 2));
    } else if (error.request) {
      console.error('No response received from server');
    }
    
    process.exit(1);
  }
}

quickTest();
