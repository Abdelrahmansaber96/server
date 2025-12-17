const Property = require("../models/propertyModel");
const {
  getGeminiClient,
  isGeminiConfigured,
  GEMINI_MODEL,
} = require("../ai/services/genai-client");

const QUESTION_FLOW = [
  {
    questionId: 1,
    question: "مرحباً 👋 ما نطاق ميزانيتك للعقار؟",
    type: "multiple_choice",
    options: [
      "أقل من 500,000",
      "500,000 - 1,000,000",
      "1,000,000 - 2,000,000",
      "2,000,000 - 5,000,000",
      "أكثر من 5,000,000",
    ],
  },
  {
    questionId: 2,
    question: "كم عدد غرف النوم التي تحتاجها؟",
    type: "multiple_choice",
    options: ["1", "2", "3", "4", "5+"],
  },
  {
    questionId: 3,
    question: "هل تبحث عن بيع أم إيجار؟",
    type: "multiple_choice",
    options: ["بيع", "إيجار"],
  },
  {
    questionId: 4,
    question: "ما نوع العقار المفضل لديك؟",
    type: "checkbox",
    options: ["شقة", "فيلا", "تاون هاوس", "دوبلكس"],
  },
  {
    questionId: 5,
    question: "هل هناك مناطق أو مدن مفضلة؟",
    type: "text",
  },
];

const questionMap = QUESTION_FLOW.reduce((acc, item) => {
  acc[item.questionId] = item;
  return acc;
}, {});

const nextQuestionById = (id) => {
  const index = QUESTION_FLOW.findIndex((q) => q.questionId === id);
  return index >= 0 && index + 1 < QUESTION_FLOW.length
    ? QUESTION_FLOW[index + 1]
    : null;
};

const parseJSON = (rawText) => {
  if (!rawText) return null;
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(rawText.slice(start, end + 1));
  } catch (error) {
    return null;
  }
};

const normalizeHistory = (history = []) => {
  if (!Array.isArray(history)) return [];
  return history
    .map((entry) => ({
      questionId: Number(entry.questionId) || null,
      question: entry.question || questionMap[entry.questionId]?.question,
      answer: entry.answer || "",
    }))
    .filter((entry) => entry.answer);
};

const deriveFilterParams = (history) => {
  const params = {};
  const mergedAnswers = history.map((item) => item.answer).join(" | ").toLowerCase();

  const priceMatch = mergedAnswers.match(/([0-9]+[\.,]?[0-9]*)\s*-\s*([0-9]+[\.,]?[0-9]*)/);
  if (priceMatch) {
    const min = Number(priceMatch[1].replace(/[,\.]/g, ""));
    const max = Number(priceMatch[2].replace(/[,\.]/g, ""));
    if (!Number.isNaN(min) && !Number.isNaN(max)) {
      params.price = { min, max };
    }
  } else if (mergedAnswers.includes("أقل من")) {
    const single = mergedAnswers.match(/أقل من\s*([0-9]+)/);
    if (single) {
      params.price = { min: 0, max: Number(single[1]) };
    }
  }

  const bedroomMatch = mergedAnswers.match(/([0-9]+)\s*(?:غرف|غرفة)/);
  if (bedroomMatch) {
    const bedrooms = Number(bedroomMatch[1]);
    if (!Number.isNaN(bedrooms)) params.bedrooms = bedrooms;
  }

  if (mergedAnswers.includes("إيجار")) {
    params.listingStatus = "rent";
  } else if (mergedAnswers.includes("بيع")) {
    params.listingStatus = "sale";
  }

  const propertyTypes = [];
  if (mergedAnswers.includes("شقة")) propertyTypes.push("apartment");
  if (mergedAnswers.includes("فيلا")) propertyTypes.push("villa");
  if (mergedAnswers.includes("تاون")) propertyTypes.push("townhouse");
  if (mergedAnswers.includes("دوبلكس")) propertyTypes.push("duplex");
  if (propertyTypes.length) params.type = propertyTypes;

  const locationMatch = mergedAnswers.match(/(?:في|بـ|داخل)\s+([\p{L}\s]+)/u);
  if (locationMatch) {
    params.location = locationMatch[1].trim();
  }

  return params;
};

exports.startInterview = async (_req, res) => {
  return res.json({ success: true, question: QUESTION_FLOW[0] });
};

exports.processAnswer = async (req, res) => {
  const { questionId, answer, conversationHistory = [] } = req.body || {};
  if (!questionId || !answer) {
    return res.status(400).json({ message: "questionId and answer are required" });
  }

  const normalizedHistory = normalizeHistory(conversationHistory);
  normalizedHistory.push({
    questionId,
    question: questionMap[questionId]?.question,
    answer,
  });

  let aiResponse = null;
  if (isGeminiConfigured()) {
    try {
      const client = getGeminiClient();
      const model = client.getGenerativeModel({ model: GEMINI_MODEL });
      const prompt = `أنت مساعد عقاري ذكي.
سجل الإجابات التالية بصيغة JSON.
السؤال الحالي (${questionId}): ${questionMap[questionId]?.question || ""}
إجابة المستخدم: ${answer}
الإجابات السابقة: ${JSON.stringify(normalizedHistory.slice(0, -1))}

أعد فقط JSON بهذا الشكل:
{
  "nextQuestion": {
    "questionId": number,
    "question": "text",
    "type": "multiple_choice|text|checkbox",
    "options": ["..."]
  },
  "isComplete": boolean,
  "filterParams": {
    "price": { "min": number, "max": number },
    "bedrooms": number,
    "type": ["apartment"],
    "listingStatus": "sale|rent",
    "location": "city"
  }
}`;
      const result = await model.generateContent(prompt);
      const parsed = parseJSON(result?.response?.text?.());
      if (parsed) {
        aiResponse = parsed;
      }
    } catch (error) {
      console.warn("⚠️ AI interview fallback due to error:", error.message);
    }
  }

  const nextQuestion =
    aiResponse?.nextQuestion || nextQuestionById(Number(questionId));
  const filterParams =
    aiResponse?.filterParams || deriveFilterParams(normalizedHistory);
  const isComplete =
    typeof aiResponse?.isComplete === "boolean"
      ? aiResponse.isComplete
      : !nextQuestion;

  return res.json({
    nextQuestion,
    isComplete,
    filterParams,
  });
};

exports.getAiRecommendations = async (req, res) => {
  try {
    const { price, bedrooms, type, listingStatus, location } = req.query;
    const query = { status: { $ne: "sold" } };

    if (price) {
      const [min, max] = price.split("-").map((value) => Number(value));
      if (!Number.isNaN(min) && !Number.isNaN(max)) {
        query.price = { $gte: min, $lte: max };
      }
    }

    if (bedrooms) {
      const parsedBedrooms = Number(bedrooms);
      if (!Number.isNaN(parsedBedrooms)) {
        query.bedrooms = { $gte: parsedBedrooms };
      }
    }

    if (type) {
      query.type = { $in: type.split(",").map((value) => value.trim()) };
    }

    if (listingStatus) {
      query.listingStatus = {
        $in: listingStatus.split(",").map((value) => value.trim()),
      };
    }

    if (location) {
      query["location.city"] = new RegExp(`^${location}$`, "i");
    }

    const properties = await Property.find(query)
      .sort({ createdAt: -1 })
      .limit(3)
      .lean();

    return res.json({
      message: "AI Recommendations",
      count: properties.length,
      properties,
    });
  } catch (error) {
    console.error("❌ Failed to fetch AI recommendations:", error.message);
    return res.status(500).json({ message: "Server error", error: error.message });
  }
};
