require('dotenv').config();
const mongoose = require('mongoose');
const { generatePropertyEmbedding, searchSimilarProperties, vectorStore } = require('./ai/services/embeddings.service');
const Property = require('./models/propertyModel');

async function testFullAI() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    // Get first property
    const property = await Property.findOne();
    if (!property) {
      console.log('❌ No properties found in database');
      return;
    }

    console.log('\n📝 Testing with property:', property.title);
    console.log('Property ID:', property._id);

    // Generate embedding
    console.log('\n🔄 Generating embedding...');
    await generatePropertyEmbedding(property._id);
    
    console.log('✅ Embedding generated');
    console.log('📊 Vector store size:', vectorStore.embeddings.length);

    // Test search
    console.log('\n🔍 Testing search...');
    const results = await searchSimilarProperties('شقة في دبي', 3);
    
    console.log(`\n✅ Found ${results.length} results:`);
    results.forEach((r, i) => {
      console.log(`${i + 1}. ${r.title} - Score: ${r.score?.toFixed(4)}`);
    });

    await mongoose.disconnect();
    console.log('\n✅ Test complete');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

testFullAI();
