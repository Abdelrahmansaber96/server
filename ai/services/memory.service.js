const AiMemory = require("../models/aiMemoryModel");
const {
  getGeminiClient,
  isGeminiConfigured,
  GEMINI_MODEL,
} = require("./genai-client");

const MAX_PERSISTED_MESSAGES = 50;
const MAX_PROMPT_MESSAGES = 20;

const toPlainText = (value) => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  return "";
};

const sanitizeMessage = (message) => {
  if (!message) return null;
  const role = message.role === "assistant" ? "assistant" : "user";
  const content = toPlainText(message.content || message.text).trim();
  if (!content) return null;
  return {
    role,
    content,
    timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
  };
};

const sanitizeHistory = (history = []) => {
  return history
    .map((entry) => sanitizeMessage(entry))
    .filter(Boolean);
};

const dedupeHistory = (history = []) => {
  const seen = new Set();
  const filtered = [];
  history.forEach((entry) => {
    const key = `${entry.role}:${entry.content}`;
    if (seen.has(key)) return;
    seen.add(key);
    filtered.push(entry);
  });
  return filtered;
};

const trimHistory = (history = [], limit = MAX_PERSISTED_MESSAGES) => {
  if (!Array.isArray(history)) return [];
  if (history.length <= limit) return history;
  return history.slice(history.length - limit);
};

async function getOrCreateMemory(userId) {
  if (!userId) return null;
  let memory = await AiMemory.findOne({ user: userId });
  if (!memory) {
    memory = new AiMemory({ user: userId, conversationHistory: [] });
  }
  return memory;
}

function formatPreferencesSummary(preferences = {}, notes = "") {
  if (!preferences) preferences = {};
  const parts = [];

  if (preferences.budgetMin || preferences.budgetMax) {
    if (preferences.budgetMin && preferences.budgetMax) {
      parts.push(`الميزانية من ${preferences.budgetMin} حتى ${preferences.budgetMax}`);
    } else if (preferences.budgetMax) {
      parts.push(`الميزانية بحد أقصى ${preferences.budgetMax}`);
    } else if (preferences.budgetMin) {
      parts.push(`الميزانية تبدأ من ${preferences.budgetMin}`);
    }
  }

  if (preferences.locations?.length) {
    parts.push(`المناطق المفضلة: ${preferences.locations.join(", ")}`);
  }

  if (preferences.propertyTypes?.length) {
    parts.push(`أنواع العقارات المفضلة: ${preferences.propertyTypes.join(", ")}`);
  }

  if (preferences.bedrooms) {
    parts.push(`عدد غرف لا يقل عن ${preferences.bedrooms}`);
  }

  if (preferences.furnished) {
    const furnishedLabel =
      preferences.furnished === "furnished"
        ? "عقار مفروش"
        : preferences.furnished === "unfurnished"
        ? "غير مفروش"
        : "مفروش أو بدون";
    parts.push(`التأثيث: ${furnishedLabel}`);
  }

  if (preferences.purpose) {
    parts.push(`الهدف: ${preferences.purpose}`);
  }

  if (preferences.extras?.length) {
    parts.push(`تفضيلات إضافية: ${preferences.extras.join(", ")}`);
  }

  if (notes && notes.trim()) {
    parts.push(`ملاحظات إضافية: ${notes.trim()}`);
  }

  return parts.join("\n");
}

async function buildPromptContext(userId, sessionHistory = []) {
  const sanitizedSession = sanitizeHistory(sessionHistory);

  if (!userId) {
    const promptHistory = trimHistory(dedupeHistory(sanitizedSession), MAX_PROMPT_MESSAGES);
    return {
      memory: null,
      memorySummary: "",
      promptHistory,
    };
  }

  const memory = await getOrCreateMemory(userId);
  const persistedHistory = sanitizeHistory(memory.conversationHistory || []);

  const merged = dedupeHistory([...persistedHistory, ...sanitizedSession]);
  const promptHistory = trimHistory(merged, MAX_PROMPT_MESSAGES);
  const memorySummary = formatPreferencesSummary(memory.preferences, memory.notes);

  return {
    memory,
    memorySummary,
    promptHistory,
  };
}

async function recordInteraction({ userId, userMessage, aiMessage, intent }) {
  if (!userId) return null;
  const memory = await getOrCreateMemory(userId);
  const updates = [];
  const userEntry = sanitizeMessage(userMessage);
  if (userEntry) {
    updates.push(userEntry);
  }
  const aiEntry = sanitizeMessage(aiMessage);
  if (aiEntry) {
    updates.push(aiEntry);
  }

  if (updates.length) {
    const combined = [...sanitizeHistory(memory.conversationHistory || []), ...updates];
    memory.conversationHistory = trimHistory(combined, MAX_PERSISTED_MESSAGES);
  }

  if (intent) {
    memory.lastIntent = intent;
  }

  memory.updatedAt = new Date();
  await memory.save();
  return memory;
}

const parseJSON = (text) => {
  if (!text) return null;
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) return null;
  try {
    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (error) {
    return null;
  }
};

const sanitizePreferences = (raw = {}) => {
  if (!raw || typeof raw !== "object") return {};
  const preference = {};
  if (raw.budgetMin != null && !Number.isNaN(Number(raw.budgetMin))) {
    preference.budgetMin = Number(raw.budgetMin);
  }
  if (raw.budgetMax != null && !Number.isNaN(Number(raw.budgetMax))) {
    preference.budgetMax = Number(raw.budgetMax);
  }
  if (Array.isArray(raw.locations)) {
    preference.locations = [...new Set(raw.locations.map((loc) => toPlainText(loc).trim()).filter(Boolean))];
  }
  if (Array.isArray(raw.propertyTypes)) {
    preference.propertyTypes = [...new Set(raw.propertyTypes.map((type) => toPlainText(type).trim()).filter(Boolean))];
  }
  if (raw.bedrooms != null && !Number.isNaN(Number(raw.bedrooms))) {
    preference.bedrooms = Number(raw.bedrooms);
  }
  if (raw.furnished) {
    const normalized = toPlainText(raw.furnished).toLowerCase();
    if (["furnished", "unfurnished", "either"].includes(normalized)) {
      preference.furnished = normalized;
    }
  }
  if (raw.purpose) {
    preference.purpose = toPlainText(raw.purpose);
  }
  if (Array.isArray(raw.extras)) {
    preference.extras = [...new Set(raw.extras.map((extra) => toPlainText(extra).trim()).filter(Boolean))];
  }
  return preference;
};

async function refreshPreferencesFromHistory(userId) {
  if (!userId || !isGeminiConfigured()) return null;
  const memory = await getOrCreateMemory(userId);
  const history = sanitizeHistory(memory.conversationHistory || []);
  if (!history.length) return null;

  const historyText = history
    .map((entry) => `${entry.role === "assistant" ? "المساعد" : "العميل"}: ${entry.content}`)
    .join("\n");

  const prompt = `أنت محلل ذكي للمحادثات العقارية. اقرأ الحوار التالي واستخرج النية الحالية وأي تفضيلات معروفة عن المتطلبات (ميزانية، مواقع، أنواع عقارات، غرف، تأثيث، الغرض، أي ملاحظات إضافية).

أعد النتيجة في JSON مضبوط بدون أي نص إضافي بصيغة:
{
  "intent": "نص قصير لوصف نية المستخدم",
  "preferences": {
    "budgetMin": number | null,
    "budgetMax": number | null,
    "locations": ["..."],
    "propertyTypes": ["..."],
    "bedrooms": number | null,
    "furnished": "furnished | unfurnished | either",
    "purpose": "buy | rent | invest | other",
    "extras": ["..."]
  },
  "notes": "ملخص قصير للملاحظات المهمة"
}

المحادثة:
${historyText}`;

  try {
    const client = getGeminiClient();
    if (!client) return null;
    const response = await client.models.generateContent({
      model: GEMINI_MODEL,
      contents: prompt,
    });
    const parsed = parseJSON(response.text?.trim());
    if (!parsed) return null;

    memory.preferences = sanitizePreferences(parsed.preferences);
    if (parsed.intent) {
      memory.lastIntent = toPlainText(parsed.intent);
    }
    if (parsed.notes) {
      memory.notes = toPlainText(parsed.notes);
    }

    await memory.save();
    return memory;
  } catch (error) {
    console.error("❌ Error extracting AI memory:", error.message);
    return null;
  }
}

module.exports = {
  buildPromptContext,
  recordInteraction,
  refreshPreferencesFromHistory,
  formatPreferencesSummary,
  sanitizeHistory,
};
