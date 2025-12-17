/**
 * AI Module Test Suite
 * Run this file to test all AI functionality
 * 
 * Usage: node ai/test-ai.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const { generatePropertyEmbedding, generateAllEmbeddings } = require("./services/embeddings.service");
const { searchSimilarProperties } = require("./services/vector-search.service");
const { generateAIResponse } = require("./services/llm-agent.service");

// Test configuration
const MONGO_URI = process.env.MONGO_URI;
const TEST_QUERY = "أريد شقة في دبي مارينا بسعر أقل من 2 مليون درهم";

async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error.message);
    process.exit(1);
  }
}

async function testEmbeddingGeneration() {
  console.log("\n🧪 Test 1: Embedding Generation");
  console.log("=====================================");
  
  try {
    const Property = require("../models/propertyModel");
    const property = await Property.findOne();
    
    if (!property) {
      console.log("⚠️  No properties found in database");
      return false;
    }

    console.log(`Testing with property: ${property.title}`);
    const result = await generatePropertyEmbedding(property._id);
    
    if (result.embedding && result.embedding.length === 3072) {
      console.log("✅ Embedding generated successfully");
      console.log(`   Dimensions: ${result.embedding.length}`);
      return true;
    } else {
      console.log("❌ Embedding generation failed");
      return false;
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    return false;
  }
}

async function testVectorSearch() {
  console.log("\n🧪 Test 2: Vector Search");
  console.log("=====================================");
  
  try {
    console.log(`Query: "${TEST_QUERY}"`);
    const results = await searchSimilarProperties(TEST_QUERY, 3);
    
    if (results.length > 0) {
      console.log(`✅ Found ${results.length} matching properties`);
      results.forEach((prop, index) => {
        console.log(`\n${index + 1}. ${prop.title}`);
        console.log(`   Price: ${prop.price?.toLocaleString()} AED`);
        console.log(`   Location: ${prop.location?.city} - ${prop.location?.area}`);
        console.log(`   Match Score: ${(prop.score * 100).toFixed(1)}%`);
      });
      return true;
    } else {
      console.log("⚠️  No results found. Have you generated embeddings?");
      return false;
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.message.includes("index")) {
      console.log("\n💡 TIP: Make sure you created the MongoDB Atlas Vector Search Index");
      console.log("   See INTEGRATION_GUIDE.md for instructions");
    }
    return false;
  }
}

async function testAIResponse() {
  console.log("\n🧪 Test 3: AI Response Generation");
  console.log("=====================================");
  
  try {
    console.log(`Query: "${TEST_QUERY}"`);
    
    // Get properties first
    const properties = await searchSimilarProperties(TEST_QUERY, 3);
    
    if (properties.length === 0) {
      console.log("⚠️  No properties to test with");
      return false;
    }

    // Generate AI response
    const aiAnswer = await generateAIResponse(TEST_QUERY, properties, []);
    
    console.log("\n✅ AI Response:");
    console.log("─────────────────────────────────────");
    console.log(aiAnswer);
    console.log("─────────────────────────────────────");
    
    return true;
  } catch (error) {
    console.error("❌ Error:", error.message);
    if (error.message.includes("API key")) {
      console.log("\n💡 TIP: Check your OPENAI_API_KEY in .env file");
    }
    return false;
  }
}

async function testBatchEmbeddings() {
  console.log("\n🧪 Test 4: Batch Embedding Generation");
  console.log("=====================================");
  
  try {
    const Property = require("../models/propertyModel");
    const count = await Property.countDocuments({ 
      $or: [{ embedding: null }, { embedding: { $exists: false } }] 
    });
    
    if (count === 0) {
      console.log("✅ All properties already have embeddings");
      return true;
    }

    console.log(`Found ${count} properties without embeddings`);
    console.log("Generating embeddings (this may take a while)...");
    
    const result = await generateAllEmbeddings();
    console.log(`✅ Generated embeddings for ${result} properties`);
    
    return true;
  } catch (error) {
    console.error("❌ Error:", error.message);
    return false;
  }
}

async function runAllTests() {
  console.log("🚀 Starting AI Module Tests");
  console.log("=====================================\n");

  await connectDB();

  const results = {
    embedding: await testEmbeddingGeneration(),
    vectorSearch: await testVectorSearch(),
    aiResponse: await testAIResponse(),
    batchEmbeddings: await testBatchEmbeddings(),
  };

  console.log("\n📊 Test Results Summary");
  console.log("=====================================");
  console.log(`Embedding Generation: ${results.embedding ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Vector Search: ${results.vectorSearch ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`AI Response: ${results.aiResponse ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Batch Embeddings: ${results.batchEmbeddings ? "✅ PASS" : "❌ FAIL"}`);

  const allPassed = Object.values(results).every(r => r === true);
  
  if (allPassed) {
    console.log("\n🎉 All tests passed! Your AI module is ready to use.");
  } else {
    console.log("\n⚠️  Some tests failed. Check the errors above.");
  }

  await mongoose.disconnect();
  console.log("\n✅ Disconnected from MongoDB");
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    console.error("❌ Test suite failed:", error);
    process.exit(1);
  });
}

module.exports = {
  testEmbeddingGeneration,
  testVectorSearch,
  testAIResponse,
  testBatchEmbeddings,
};
