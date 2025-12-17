require('dotenv').config();
const mongoose = require('mongoose');
const { generateAllEmbeddings, vectorStore } = require('./ai/services/embeddings.service');

async function generateAll() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ MongoDB connected');

    console.log('🔄 Generating embeddings for all properties...');
    const count = await generateAllEmbeddings();
    
    console.log(`\n✅ Generated ${count} embeddings`);
    console.log('📊 Vector store size:', vectorStore.embeddings.length);

    await mongoose.disconnect();
    console.log('✅ Done');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
  }
}

generateAll();
