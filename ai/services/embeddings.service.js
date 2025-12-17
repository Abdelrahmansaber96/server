const axios = require("axios");
const Property = require("../../models/propertyModel");

// Fireworks AI configuration
const FIREWORKS_API_URL = "https://api.fireworks.ai/inference/v1/embeddings";
const FIREWORKS_MODEL = "fireworks/qwen3-embedding-8b";

// In-memory vector storage
const vectorStore = {
  embeddings: [], // Array of { propertyId, embedding, property }
};

function getFireworksConfig() {
  return {
    url: FIREWORKS_API_URL,
    model: FIREWORKS_MODEL,
    apiKey: process.env.FIREWORKS_API_KEY,
  };
}

// Calculate cosine similarity
function cosineSimilarity(vecA, vecB) {
  const dotProduct = vecA.reduce((sum, a, i) => sum + a * vecB[i], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Generate embedding for a property and save it to MongoDB
 * @param {String} propertyId - MongoDB property ID
 * @returns {Promise<Object>} Updated property with embedding
 */
async function generatePropertyEmbedding(propertyId) {
  try {
    // Fetch property from database
    const property = await Property.findById(propertyId);
    if (!property) {
      throw new Error("Property not found");
    }

    // Create a rich text representation of the property
    const propertyText = `
      العنوان: ${property.title || property.projectName || "عقار"}
      الوصف: ${property.description || "لا يوجد وصف"}
      السعر: ${property.price ? property.price + " جنيه" : "غير محدد"}
      الموقع: ${property.location?.city || ""} - ${property.location?.area || ""}
      النوع: ${property.type || ""}
      غرف النوم: ${property.bedrooms || 0}
      الحمامات: ${property.bathrooms || 0}
      المساحة: ${property.area || 0} متر مربع
      الحالة: ${property.listingStatus || ""}
      ${property.type === 'project' ? 'مشروع عقاري للمطور' : ''}
      ${property.developer ? 'عقار من مطور عقاري' : ''}
      ${property.projectName ? 'اسم المشروع: ' + property.projectName : ''}
      ${property.units ? 'عدد الوحدات المتاحة: ' + property.units : ''}
    `.trim();

    // Generate embedding using Fireworks AI
    const config = getFireworksConfig();
    const response = await axios.post(
      config.url,
      {
        input: propertyText,
        model: config.model,
      },
      {
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    const embedding = response.data.data[0].embedding;

    // Store in memory vector store (no MongoDB save)
    const existingIndex = vectorStore.embeddings.findIndex(
      (item) => item.propertyId === propertyId.toString()
    );
    
    if (existingIndex >= 0) {
      vectorStore.embeddings[existingIndex] = {
        propertyId: propertyId.toString(),
        embedding,
        property: property.toObject(),
      };
    } else {
      vectorStore.embeddings.push({
        propertyId: propertyId.toString(),
        embedding,
        property: property.toObject(),
      });
    }

    console.log(`✅ Embedding generated and stored for property: ${property.title}`);
    return property;
  } catch (error) {
    console.error("❌ Error generating embedding:", error.message);
    throw error;
  }
}

/**
 * Generate embeddings for all properties without embeddings
 * @returns {Promise<Number>} Count of properties updated
 */
async function generateAllEmbeddings() {
  try {
    // استخراج جميع العقارات بما فيها developer projects والمشاريع
    const properties = await Property.find({});
    
    console.log(`🔄 Generating embeddings for ${properties.length} properties...`);
    
    // إحصائيات
    const projectCount = properties.filter(p => p.type === 'project').length;
    const developerCount = properties.filter(p => p.developer != null).length;
    console.log(`   📊 Including ${projectCount} projects and ${developerCount} developer properties`);

    let successCount = 0;
    for (const property of properties) {
      try {
        await generatePropertyEmbedding(property._id);
        successCount++;
      } catch (error) {
        console.error(`Failed for property ${property._id}:`, error.message);
      }
    }

    console.log(`✅ Successfully generated ${successCount} embeddings`);
    return successCount;
  } catch (error) {
    console.error("❌ Error in batch embedding generation:", error.message);
    throw error;
  }
}

/**
 * Generate embedding for a query text
 * @param {String} queryText - User query
 * @returns {Promise<Array>} Embedding vector
 */
async function generateQueryEmbedding(queryText) {
  try {
    const config = getFireworksConfig();
    const response = await axios.post(
      config.url,
      {
        input: queryText,
        model: config.model,
      },
      {
        headers: {
          "Authorization": `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
      }
    );

    return response.data.data[0].embedding;
  } catch (error) {
    console.error("❌ Error generating query embedding:", error.message);
    throw error;
  }
}

// الحالات المتاحة للعقارات (استبعاد المباعة والمؤجرة)
const AVAILABLE_STATUSES = ["available", "under-construction", "completed", "planned", undefined, null];

async function searchSimilarProperties(queryText, limit = 5) {
  try {
    // Generate query embedding
    const queryEmbedding = await generateQueryEmbedding(queryText);
    
    // Calculate similarities - فلترة العقارات غير المتاحة
    const results = vectorStore.embeddings
      .filter((item) => {
        // استبعاد العقارات المباعة أو المؤجرة
        const status = item.property?.status;
        return !status || AVAILABLE_STATUSES.includes(status);
      })
      .map((item) => {
        const similarity = cosineSimilarity(queryEmbedding, item.embedding);
        return {
          ...item.property,
          score: similarity,
        };
      });
    
    // Sort by similarity and limit
    results.sort((a, b) => b.score - a.score);
    const topResults = results.slice(0, limit);
    
    console.log(`✅ Vector search returned ${topResults.length} results (filtered available only)`);
    return topResults;
  } catch (error) {
    console.error("❌ Error in vector search:", error.message);
    throw error;
  }
}

module.exports = {
  generatePropertyEmbedding,
  generateAllEmbeddings,
  generateQueryEmbedding,
  searchSimilarProperties,
  vectorStore,
};
