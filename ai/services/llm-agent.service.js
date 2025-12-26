const {
  getGeminiClient,
  isGeminiConfigured,
  GEMINI_MODEL,
} = require("./genai-client");
const { SYSTEM_PROMPT, VOICE_SYSTEM_PROMPT } = require("../system-prompt");

const MAX_RETRIES = 5; // Increased from 2 to 5
const BASE_RETRY_DELAY = 1000; // Start with 1 second
const MAX_RETRY_DELAY = 16000; // Max 16 seconds
const MAX_HISTORY_MESSAGES = 8;

// Sleep helper with exponential backoff
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Calculate exponential backoff delay
const getRetryDelay = (attempt) => {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s
  const delay = Math.min(BASE_RETRY_DELAY * Math.pow(2, attempt - 1), MAX_RETRY_DELAY);
  // Add random jitter (0-20%) to avoid thundering herd
  const jitter = delay * 0.2 * Math.random();
  return Math.floor(delay + jitter);
};

/**
 * تحويل حالة العقار لنص عربي واضح
 */
function getAvailabilityStatus(status) {
  const statusMap = {
    available: "✅ متاح للبيع/الإيجار",
    sold: "❌ تم بيعه - غير متاح",
    rented: "❌ تم تأجيره - غير متاح",
    "under-construction": "🏗️ تحت الإنشاء - متاح للحجز",
    completed: "✅ مكتمل - متاح",
    planned: "📋 مخطط - قريباً",
  };
  return statusMap[status] || "✅ متاح";
}

/**
 * Generate AI response using OpenAI chat completions (defaults to gpt-4o-mini)
 * @param {String} userQuery - User's question
 * @param {Array} retrievedProperties - Properties from vector search
 * @returns {Promise<String>} AI-generated response in Arabic
 */
const toPlainText = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  return "";
};

const formatConversationHistory = (history = []) => {
  if (!Array.isArray(history) || history.length === 0) {
    return "";
  }

  return history
    .slice(-MAX_HISTORY_MESSAGES)
    .map((message, index) => {
      if (!message) return null;
      const role = message.role === "assistant" ? "المساعد" : "العميل";
      const content = toPlainText(message.content || message.text).trim();
      if (!content) return null;
      return `${index + 1}. ${role}: ${content}`;
    })
    .filter(Boolean)
    .join("\n");
};

/**
 * Generate AI response using Google Gemini
 * @param {String} userQuery - User's question
 * @param {Array} retrievedProperties - Properties from vector search
 * @param {Array} conversationHistory - Previous conversation turns [{ role: 'user'|'assistant', content: '...' }]
 * @param {String} memorySummary - Summary of previous conversations from memory
 * @param {String} negotiationsContext - Context about user's active negotiations
 * @returns {Promise<String>} AI-generated response in Arabic
 */
async function generateAIResponse(userQuery, retrievedProperties, conversationHistory = [], memorySummary = "", negotiationsContext = "") {
  let lastError;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n🔧 === Gemini Generation Attempt ${attempt}/${MAX_RETRIES} ===`);
      const historyContext = formatConversationHistory(conversationHistory);
      
      // Format properties data for the AI - COMPACT VERSION
      const propertiesContext = retrievedProperties
        .map((prop, index) => {
          const status = getAvailabilityStatus(prop.status);
          const price = prop.price ? prop.price.toLocaleString() : "—";
          const city = prop.location?.city || "";
          const area = prop.location?.area || "";
          const location = [city, area].filter(Boolean).join("-");
          
          return `${index + 1}. **${prop.title || "عقار"}** | ${price} ج | ${location} | ${prop.bedrooms || 0}غ ${prop.bathrooms || 0}ح | ${prop.area || "—"}م² | ${status}`;
        })
        .join("\n");

      const contextMessage =
        retrievedProperties.length > 0
          ? `العقارات المتاحة:\n${propertiesContext}\n\nرد على سؤال العميل بناءً على العقارات دي.`
          : `مفيش عقارات مطابقة. اعتذر واقترح توسيع البحث.`;

      // Get Gemini client
      console.log("🔑 Initializing Gemini client...");
      const client = getGeminiClient();
      if (!client) {
        throw new Error("Google AI not configured - missing API key");
      }
      console.log("✅ Gemini client initialized");
      
      // Combine system prompt with context and user query - COMPACT
      const conversationContext = historyContext ? `📜 سياق:\n${historyContext}\n` : "";
      const memoryContext = memorySummary ? `🧠 ذاكرة:\n${memorySummary}\n` : "";
      const negotiationsInfo = negotiationsContext ? `💼 تفاوضات:\n${negotiationsContext}\n` : "";

      const fullPrompt = `${SYSTEM_PROMPT}\n${memoryContext}${negotiationsInfo}${conversationContext}${contextMessage}\n\n❓ ${userQuery}`;
      
      console.log(`📝 Prompt prepared (${fullPrompt.length} chars, ${retrievedProperties.length} properties)`);
      console.log(`🤖 Calling model: ${GEMINI_MODEL}`);
      console.log("📤 Sending request to Gemini API...");
      
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: fullPrompt,
        temperature: 0, // Adjust for more creative responses if needed
      });
      
      console.log("📥 Received response from Gemini");
      
      const aiResponse = response.text;
      console.log(`✅ Response text extracted (${aiResponse.length} chars)`);

      if (!aiResponse || aiResponse.trim().length === 0) {
        throw new Error("Empty response from Gemini");
      }

      console.log("✅ AI response generated successfully (Gemini)\n");
      return aiResponse;
      
    } catch (error) {
      lastError = error;
      
      console.error(`\n❌ === Error in Attempt ${attempt}/${MAX_RETRIES} ===`);
      console.error(`Error Type: ${error.constructor.name}`);
      console.error(`Error Message: ${error.message}`);
      if (error.stack) {
        console.error(`Stack Trace: ${error.stack.split('\n').slice(0, 3).join('\n')}`);
      }
      
      const isRateLimitError = error.message?.includes("429") || error.message?.includes("quota");
      const isServerError = error.message?.includes("503") || error.message?.includes("500") || error.message?.includes("overloaded");
      const is404Error = error.message?.includes("404");
      const isNetworkError = error.message?.includes("ECONNREFUSED") || error.message?.includes("ETIMEDOUT");
      
      const shouldRetry = (isRateLimitError || isServerError || isNetworkError) && attempt < MAX_RETRIES;
      
      if (is404Error) {
        console.error(`🔴 Model "${GEMINI_MODEL}" not found. Check available models.`);
      } else if (isRateLimitError) {
        console.error(`⚠️  Rate limit (429) - Will retry with backoff`);
      } else if (isServerError) {
        console.error(`⚠️  Server overloaded (503) - Will retry with backoff`);
      } else if (isNetworkError) {
        console.error(`⚠️  Network error - Will retry with backoff`);
      } else {
        console.error(`⚠️  Unknown error - ${shouldRetry ? 'Will retry' : 'Will not retry'}`);
      }
      
      if (shouldRetry) {
        const delayMs = getRetryDelay(attempt);
        console.log(`⏳ Exponential backoff: Retrying in ${(delayMs / 1000).toFixed(1)}s... (attempt ${attempt}/${MAX_RETRIES})`);
        await sleep(delayMs);
      } else {
        console.log(`❌ Not retrying - attempt ${attempt}/${MAX_RETRIES} failed with non-retryable error`);
        break;
      }
    }
  }
  
  console.error("\n❌ === All Retry Attempts Failed ===");
  console.error(`Final Error: ${lastError?.message || 'Unknown error'}\n`);
  
  // Fallback response when AI is unavailable
  if (lastError?.message?.includes("503") || lastError?.message?.includes("overloaded")) {
    console.log("⚠️ Returning fallback response due to API overload");
    if (retrievedProperties && retrievedProperties.length > 0) {
      const prop = retrievedProperties[0];
      return `عذراً، النظام مشغول حالياً. لكن لقيت لحضرتك **${prop.title || 'عقار'}** في ${prop.location?.city || ''} بسعر ${prop.price?.toLocaleString() || '—'} جنيه. جرب تاني بعد شوية! 🙏`;
    }
    return "عذراً، النظام مشغول حالياً. من فضلك حاول مرة تانية بعد دقيقة. 🙏";
  }
  
  throw lastError;
}

/**
 * Generate a follow-up question based on context
 * @param {String} previousQuery - User's previous question
 * @param {String} aiResponse - Previous AI response
 * @returns {Promise<String>} Suggested follow-up question
 */
async function generateFollowUpQuestion(previousQuery, aiResponse) {
  try {
    const client = getGeminiClient();
    if (!client) {
      return null;
    }
    
    const prompt = `أنت مساعد ذكي. قم بإنشاء سؤال متابعة مفيد باللغة العربية بناءً على المحادثة السابقة.

السؤال السابق: ${previousQuery}
الإجابة السابقة: ${aiResponse}

اقترح سؤال متابعة واحد ذكي يساعد العميل في اتخاذ قرار أفضل (جملة واحدة فقط).`;
    
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });
    
    return response.text;
    
  } catch (error) {
    console.error("❌ Error generating follow-up question:", error.message);
    return null;
  }
}

/**
 * 🎤 Generate Voice-Optimized AI Response
 * Optimized for text-to-speech output - shorter, clearer, no emojis
 * @param {String} userSpeechText - Text from speech recognition
 * @param {Array} retrievedUnits - Properties from database
 * @param {String} currentStage - discovery | recommendation | negotiation | booking | contract
 * @param {Array} conversationHistory - Previous conversation turns
 * @param {String} memorySummary - Summary of previous conversations
 * @param {String} negotiationsContext - Context about user's active negotiations
 * @returns {Promise<String>} Voice-optimized AI response
 */
async function generateVoiceResponse(userSpeechText, retrievedUnits = [], currentStage = "discovery", conversationHistory = [], memorySummary = "", negotiationsContext = "") {
  let lastError;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      console.log(`\n🎤 === Voice Response Attempt ${attempt}/${MAX_RETRIES} ===`);
      console.log(`📍 Stage: ${currentStage}`);
      
      const historyContext = formatConversationHistory(conversationHistory);
      
      // Format properties for voice - VERY COMPACT, no special characters
      const unitsContext = retrievedUnits.length > 0
        ? retrievedUnits.slice(0, 2).map((prop, index) => {
            const price = prop.price ? prop.price.toLocaleString() : "غير محدد";
            const city = prop.location?.city || "";
            const area = prop.area || "غير محدد";
            return `${index + 1}. ${prop.title || "عقار"} في ${city}، ${area} متر، بسعر ${price} جنيه`;
          }).join(". ")
        : "لا توجد وحدات متاحة حالياً";

      // Get Gemini client
      const client = getGeminiClient();
      if (!client) {
        throw new Error("Google AI not configured - missing API key");
      }
      
      // Build voice-optimized prompt
      const stageContext = `المرحلة الحالية: ${currentStage}`;
      const conversationContext = historyContext ? `سياق المحادثة:\n${historyContext}\n` : "";
      const memoryContext = memorySummary ? `ذاكرة سابقة:\n${memorySummary}\n` : "";
      const negotiationsInfo = negotiationsContext ? `تفاوضات:\n${negotiationsContext}\n` : "";

      const fullPrompt = `${VOICE_SYSTEM_PROMPT}

${stageContext}
${memoryContext}${negotiationsInfo}${conversationContext}
الوحدات المتاحة: ${unitsContext}

كلام العميل: ${userSpeechText}

رد بصوت واضح ومختصر:`;
      
      console.log(`📝 Voice prompt prepared (${fullPrompt.length} chars)`);
      
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: fullPrompt,
        config: {
          temperature: 0.3, // Slightly creative but consistent
          maxOutputTokens: 300, // Keep responses short for voice
        }
      });
      
      let voiceResponse = response.text;
      
      // Clean up response for voice (remove emojis and special characters)
      voiceResponse = voiceResponse
        .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Remove emojis
        .replace(/[✅❌⚠️🏠💰📋🎉⏳🤔😊👍🤩📊📍🔍✔️✖️]/g, '') // Remove specific emojis
        .replace(/\*\*/g, '') // Remove bold markdown
        .replace(/\*/g, '') // Remove italics
        .replace(/#+\s*/g, '') // Remove headers
        .replace(/\n{3,}/g, '\n\n') // Reduce multiple newlines
        .trim();
      
      if (!voiceResponse || voiceResponse.trim().length === 0) {
        throw new Error("Empty voice response from Gemini");
      }

      console.log(`✅ Voice response generated (${voiceResponse.length} chars)\n`);
      return voiceResponse;
      
    } catch (error) {
      lastError = error;
      console.error(`❌ Voice attempt ${attempt} failed: ${error.message}`);
      
      const isRateLimitError = error.message?.includes("429");
      const isServerError = error.message?.includes("503") || error.message?.includes("500");
      
      if ((isRateLimitError || isServerError) && attempt < MAX_RETRIES) {
        const delayMs = getRetryDelay(attempt);
        console.log(`⏳ Retrying in ${(delayMs / 1000).toFixed(1)}s...`);
        await sleep(delayMs);
      } else {
        break;
      }
    }
  }
  
  // Fallback voice response
  console.error(`❌ Voice generation failed: ${lastError?.message}`);
  if (retrievedUnits && retrievedUnits.length > 0) {
    const prop = retrievedUnits[0];
    return `معلش، حصل مشكلة تقنية. لكن عندي ${prop.title || 'عقار'} في ${prop.location?.city || 'موقع مميز'} ممكن يناسبك. تحب أكمل معاك؟`;
  }
  return "معلش، حصل مشكلة تقنية بسيطة. ممكن تعيد السؤال تاني؟";
}

module.exports = {
  generateAIResponse,
  generateVoiceResponse,
  generateFollowUpQuestion,
  isGeminiConfigured,
  VOICE_SYSTEM_PROMPT,
};
