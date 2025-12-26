const axios = require("axios");
const Property = require("../../models/propertyModel");

// Fireworks AI configuration
const FIREWORKS_API_URL = "https://api.fireworks.ai/inference/v1/embeddings";
const FIREWORKS_MODEL = "fireworks/qwen3-embedding-8b";

// Rate limiting configuration - INCREASED DELAYS
const RATE_LIMIT_DELAY = 2000; // 2 seconds delay between requests (increased from 1s)
const MAX_RETRIES = 5; // Increased retry attempts
const INITIAL_BACKOFF = 3000; // Start with 3 seconds on retry

// Helper function for delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

    // Generate embedding using Fireworks AI with retry logic
    const config = getFireworksConfig();
    let embedding;
    let retries = 0;
    
    while (retries < MAX_RETRIES) {
      try {
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
            timeout: 10000, // 10 second timeout
          }
        );
        
        embedding = response.data.data[0].embedding;
        break; // Success, exit retry loop
      } catch (error) {
        if (error.response?.status === 429 && retries < MAX_RETRIES - 1) {
          retries++;
          // Progressive exponential backoff: 3s, 6s, 12s, 24s, 48s
          const waitTime = INITIAL_BACKOFF * Math.pow(2, retries - 1);
          console.log(`⏳ Rate limit hit, waiting ${waitTime}ms before retry ${retries}/${MAX_RETRIES}...`);
          await sleep(waitTime);
        } else {
          throw error; // Re-throw if not 429 or max retries reached
        }
      }
    }
    
    if (!embedding) {
      throw new Error("Failed to generate embedding after all retries");
    }

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
    for (let i = 0; i < properties.length; i++) {
      const property = properties[i];
      try {
        await generatePropertyEmbedding(property._id);
        successCount++;
        
        // Add delay between requests to avoid rate limiting
        if (i < properties.length - 1) {
          // Add random jitter (±20%) to avoid synchronized requests
          const jitter = Math.floor(RATE_LIMIT_DELAY * 0.2 * (Math.random() - 0.5) * 2);
          const delayWithJitter = RATE_LIMIT_DELAY + jitter;
          console.log(`⏳ Waiting ${delayWithJitter}ms before next request... (${i + 1}/${properties.length})`);
          await sleep(delayWithJitter);
        }
      } catch (error) {
        console.error(`❌ Failed for property ${property._id}:`, error.message);
        // On error, wait extra time before continuing
        if (i < properties.length - 1) {
          console.log(`⏳ Error occurred, waiting extra 3 seconds...`);
          await sleep(3000);
        }
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
  let retries = 0;
  
  while (retries < MAX_RETRIES) {
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
          timeout: 10000,
        }
      );

      return response.data.data[0].embedding;
    } catch (error) {
      if (error.response?.status === 429 && retries < MAX_RETRIES - 1) {
        retries++;
        const waitTime = INITIAL_BACKOFF * Math.pow(2, retries - 1);
        console.log(`⏳ Query embedding rate limit hit, waiting ${waitTime}ms... (retry ${retries}/${MAX_RETRIES})`);
        await sleep(waitTime);
      } else {
        console.error("❌ Error generating query embedding:", error.message);
        throw error;
      }
    }
  }
  
  throw new Error("Failed to generate query embedding after all retries");
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
