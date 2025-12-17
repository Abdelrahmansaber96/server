require('dotenv').config();
const axios = require('axios');

async function testFireworksEmbedding() {
  try {
    console.log('🔑 Fireworks API Key:', process.env.FIREWORKS_API_KEY?.substring(0, 10) + '...');
    
    const response = await axios.post(
      'https://api.fireworks.ai/inference/v1/embeddings',
      {
        input: 'شقة في دبي',
        model: 'fireworks/qwen3-embedding-8b',
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.FIREWORKS_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('✅ Fireworks API works!');
    console.log('📊 Embedding dimensions:', response.data.data[0].embedding.length);
    console.log('📊 First 5 values:', response.data.data[0].embedding.slice(0, 5));
    
  } catch (error) {
    console.error('❌ Error:', error.response?.data || error.message);
  }
}

testFireworksEmbedding();
