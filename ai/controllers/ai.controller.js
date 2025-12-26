const { searchSimilarProperties, searchWithFilters } = require("../services/vector-search.service");
const { generateAIResponse, generateVoiceResponse, generateFollowUpQuestion, isGeminiConfigured } = require("../services/llm-agent.service");
const {
  buildPromptContext,
  recordInteraction,
  refreshPreferencesFromHistory,
} = require("../services/memory.service");
const { generatePropertyEmbedding, generateAllEmbeddings } = require("../services/embeddings.service");
const Property = require("../../models/propertyModel");
const NegotiationSession = require("../../models/negotiationSessionModel");
const { createNotification } = require("../../controllers/notificationController");
const DealDraft = require("../../models/dealDraftModel");
const Contract = require("../../models/contractModel");
const Deal = require("../../models/dealModel");
const {
  getSession,
  getExistingSession,
  deleteSession,
  detectAddPropertyIntent,
  isInPropertyCreationSession,
  getPlaceholderImages,
  STEPS,
} = require("../services/property-ai.service");

const LOCATION_SYNONYMS = [
  ["القاهرة", "القاهره", "cairo"],
  ["الجيزة", "الجيزه", "giza"],
  ["الاسكندرية", "الاسكندريه", "alexandria", "اسكندرية"],
  ["اسوان", "أسوان", "aswan"],
  ["الغردقة", "hurghada"],
  ["شرم الشيخ", "شرم", "sharm", "sharm el sheikh"],
  ["دمياط", "damietta"],
  ["المنصورة", "mansoura"],
  ["سوهاج", "sohag"],
  ["اسيوط", "أسيوط", "assiut"],
  ["الاقصر", "الأقصر", "luxor"],
  ["السادس من اكتوبر", "6 اكتوبر", "6 october", "october"],
  ["الشيخ زايد", "شيخ زايد", "زايد", "sheikh zayed", "zayed"],
  ["التجمع الخامس", "التجمع", "fifth settlement", "new cairo", "القاهرة الجديدة"],
  ["المعادي", "maadi"],
  ["العبور", "obour"],
  ["الرحاب", "rehab"],
  ["مصر الجديدة", "heliopolis"],
  ["المهندسين", "mohandessin"],
  ["الزمالك", "zamalek"],
  ["مدينة نصر", "nasr city"],
  ["العين السخنة", "السخنة", "ain sokhna", "sokhna"],
  ["الساحل الشمالي", "الساحل", "north coast", "sahel"],
];

const escapeRegExp = (value = "") => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const toArray = (value) => {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
};

function findLocationGroup(value = "") {
  if (!value) return null;
  const lowerValue = value.toLowerCase();
  return LOCATION_SYNONYMS.find((group) =>
    group.some((variant) => lowerValue.includes(variant.toLowerCase()))
  );
}

function expandCityValues(input) {
  const values = toArray(input);
  const expanded = new Set();
  values.forEach((value) => {
    if (!value) return;
    expanded.add(value);
    const group = findLocationGroup(value);
    if (group) {
      group.forEach((variant) => expanded.add(variant));
    }
  });
  return Array.from(expanded);
}

function detectCityFromQuery(query = "") {
  const group = findLocationGroup(query);
  return group ? Array.from(new Set(group)) : [];
}

function buildNormalizedFilters(rawFilters = {}, query = "") {
  const normalized = { ...rawFilters };
  const detectedCities = detectCityFromQuery(query);
  if (detectedCities.length || rawFilters.city) {
    const initialCities = expandCityValues(rawFilters.city);
    const combined = new Set([...initialCities, ...detectedCities]);
    if (combined.size) {
      normalized.city = Array.from(combined);
    }
  }
  return normalized;
}

/**
 * استخراج الفلاتر من نص المحادثة
 * @param {String} text - النص لاستخراج الفلاتر منه
 * @returns {Object} - الفلاتر المستخرجة
 */
function extractFiltersFromText(text = "") {
  const filters = {};
  const lowerText = text.toLowerCase();

  // استخراج نوع العقار
  const typePatterns = [
    { pattern: /شق[ةه]|apartment/i, type: "apartment" },
    { pattern: /فيلا|villa/i, type: "villa" },
    { pattern: /منزل|بيت|house/i, type: "house" },
    { pattern: /استديو|studio/i, type: "apartment" },
    { pattern: /دوبلكس|duplex/i, type: "house" },
    { pattern: /أرض|ارض|land/i, type: "project" },
    { pattern: /مكتب|تجاري|office|commercial/i, type: "project" },
  ];

  for (const { pattern, type } of typePatterns) {
    if (pattern.test(text)) {
      filters.type = type;
      break;
    }
  }

  // استخراج المدينة
  const cities = detectCityFromQuery(text);
  if (cities.length > 0) {
    filters.city = cities;
  }

  // استخراج السعر - أنماط متعددة
  // سعر محدد: "500000 جنيه" أو "500,000" أو "500 ألف"
  const pricePatterns = [
    // أرقام بالملايين: "2 مليون" أو "2.5 مليون"
    /(\d+(?:\.\d+)?)\s*(?:مليون|million)/gi,
    // أرقام بالآلاف: "500 ألف" أو "500 الف"
    /(\d+)\s*(?:ألف|الف|thousand|k)/gi,
    // أرقام عادية (من 5 أرقام فأكثر)
    /(\d{1,3}(?:,\d{3})+|\d{5,})/g,
  ];

  let extractedPrices = [];

  // ملايين
  const millionMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:مليون|million)/i);
  if (millionMatch) {
    extractedPrices.push(parseFloat(millionMatch[1]) * 1000000);
  }

  // آلاف
  const thousandMatch = text.match(/(\d+)\s*(?:ألف|الف|thousand|k)/i);
  if (thousandMatch) {
    extractedPrices.push(parseInt(thousandMatch[1]) * 1000);
  }

  // أرقام كبيرة
  const bigNumbers = text.match(/(\d{1,3}(?:,\d{3})+|\d{5,})/g);
  if (bigNumbers) {
    bigNumbers.forEach(num => {
      const cleaned = parseInt(num.replace(/,/g, ''));
      if (cleaned >= 10000) { // تجاهل الأرقام الصغيرة
        extractedPrices.push(cleaned);
      }
    });
  }

  // نطاق سعري: "من X إلى Y" أو "بين X و Y"
  const rangeMatch = text.match(/(?:من|between)\s*(\d[\d,]*)\s*(?:إلى|الى|to|و|-)\s*(\d[\d,]*)/i);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1].replace(/,/g, ''));
    const max = parseInt(rangeMatch[2].replace(/,/g, ''));
    if (min >= 10000) filters.minPrice = min;
    if (max >= 10000) filters.maxPrice = max;
  } else if (extractedPrices.length > 0) {
    // حد أقصى: "أقل من" أو "ميزانية" أو "لا يتجاوز"
    if (/أقل\s*من|لا\s*يتجاوز|اقصى|أقصى|حد|maximum|max|under|budget|ميزاني/i.test(text)) {
      filters.maxPrice = Math.max(...extractedPrices);
    }
    // حد أدنى: "أكثر من" أو "على الأقل"
    else if (/أكثر\s*من|على\s*الأقل|minimum|min|above|at\s*least/i.test(text)) {
      filters.minPrice = Math.min(...extractedPrices);
    }
    // إذا لم يحدد، نعتبره حد أقصى (الأكثر شيوعاً)
    else {
      filters.maxPrice = Math.max(...extractedPrices);
    }
  }

  // استخراج عدد الغرف
  // دعم أرقام عربية: "ثلاث غرف" أو "3 غرف"
  const arabicNumbers = {
    'واحد': 1, 'واحدة': 1, 'اثنين': 2, 'اثنتين': 2, 'ثلاث': 3, 'ثلاثة': 3,
    'أربع': 4, 'اربع': 4, 'أربعة': 4, 'اربعة': 4, 'خمس': 5, 'خمسة': 5,
    'ست': 6, 'ستة': 6, 'سبع': 7, 'سبعة': 7, 'ثمان': 8, 'ثمانية': 8,
    'تسع': 9, 'تسعة': 9, 'عشر': 10, 'عشرة': 10,
  };

  let bedroomMatch = text.match(/(\d+)\s*(?:غرف|غرفة|غرف\s*نوم|bedroom|bed|br)/i);
  if (bedroomMatch) {
    filters.bedrooms = parseInt(bedroomMatch[1]);
  } else {
    // البحث عن أرقام عربية كتابة
    const arabicBedroomMatch = text.match(/(واحد|واحدة|اثنين|اثنتين|ثلاث|ثلاثة|أربع|اربع|أربعة|اربعة|خمس|خمسة|ست|ستة|سبع|سبعة|ثمان|ثمانية|تسع|تسعة|عشر|عشرة)\s*(?:غرف|غرفة|غرف\s*نوم)/i);
    if (arabicBedroomMatch) {
      const arabicWord = arabicBedroomMatch[1].toLowerCase();
      filters.bedrooms = arabicNumbers[arabicWord];
    }
  }

  // استخراج المساحة
  // نطاق مساحة: "من 100 إلى 200 متر" أو "بين 100 و 200 متر"
  const areaRangeMatch = text.match(/(?:من|between)\s*(\d+)\s*(?:إلى|الى|to|و|-)\s*(\d+)\s*(?:متر|م|sqm|square)/i);
  if (areaRangeMatch) {
    const minArea = parseInt(areaRangeMatch[1]);
    const maxArea = parseInt(areaRangeMatch[2]);
    if (minArea >= 30) filters.minArea = minArea;
    if (maxArea >= 30) filters.maxArea = maxArea;
  } else {
    // مساحة محددة أو حد أدنى: "150 متر" أو "مساحة 150 متر"
    const areaMatch = text.match(/(\d{2,})\s*(?:متر|م|sqm|square|sq)/i);
    if (areaMatch) {
      const areaValue = parseInt(areaMatch[1]);
      if (areaValue >= 30) { // الحد الأدنى للمساحة المعقولة
        // إذا ذكر "على الأقل" أو "أكثر من" = حد أدنى فقط
        if (/(?:على\s*الأقل|أكثر\s*من|minimum|min|at\s*least|above)\s*\d+\s*متر/i.test(text)) {
          filters.minArea = areaValue;
        }
        // إذا ذكر "أقل من" أو "لا يتجاوز" = حد أقصى فقط
        else if (/(?:أقل\s*من|لا\s*يتجاوز|maximum|max|under)\s*\d+\s*متر/i.test(text)) {
          filters.maxArea = areaValue;
        }
        // قيمة محددة = نطاق ضيق (±10%)
        else {
          filters.minArea = Math.floor(areaValue * 0.9); // -10%
          filters.maxArea = Math.ceil(areaValue * 1.1);  // +10%
        }
      }
    }
  }

  return filters;
}

/**
 * استخراج الفلاتر من سياق المحادثة الكامل
 * @param {Array} history - تاريخ المحادثة
 * @param {String} currentQuery - الاستعلام الحالي
 * @param {String} memorySummary - ملخص الذاكرة
 * @returns {Object} - الفلاتر المستخرجة من كامل السياق
 */
function extractFiltersFromConversation(history = [], currentQuery = "", memorySummary = "") {
  // ✅ التحقق أولاً: هل الاستعلام الحالي هو بحث عقاري أم محادثة عامة؟
  const isCurrentQueryPropertySearch = detectPropertySearchIntent(currentQuery);

  // ✅ كلمات المقارنة التي تشير إلى استمرار بحث عقاري سابق
  const comparisonKeywords = /أرخص|ارخص|أغلى|اغلى|أكبر|اكبر|أصغر|اصغر|أفضل|افضل|الافضل|الأفضل|تاني|ثاني|غير|مختلف|أحسن|احسن|cheaper|expensive|bigger|smaller|better|another|different/i;
  const isComparison = comparisonKeywords.test(currentQuery);

  // ✅ كلمات تطلب إعادة العرض أو رؤية النتائج أو ترشيحات
  const showResultsKeywords = /ورين|وريني|عرض|اعرض|شوف|شوفني|ابحث|دور|رشح|رشحل|اختيار|اختيارات|ترشيح|نتائج|results|show|search|recommend|suggestions/i;
  const wantsToSeeResults = showResultsKeywords.test(currentQuery);

  // إذا كان الاستعلام الحالي محادثة عامة (مرحبا، ازيك، فاكرني، الخ) - لا تستخرج فلاتر
  const generalConversationPatterns = [
    /^(مرحبا|اهلا|هاي|هلو|السلام|صباح|مساء)/i,
    /^(ازيك|عامل اي|كيف حالك|كيفك)/i,
    /^(فاكر|تفتكر|تذكر|متذكر)/i,
    /^(شكرا|تسلم|ممتاز|تمام|اوك|حسنا)/i,
    /^(ازاي|كيف|ليه|ليش|وش)/i,
    /^(نعم|لا|اه|ايوه|لأ)/i,
    /^(انت|هو|هي|احنا|انتو)/i,
  ];

  const isGeneralConversation = generalConversationPatterns.some(pattern =>
    pattern.test(currentQuery.trim())
  ) && currentQuery.trim().length < 30;

  // ✅ إذا كان استعلام مقارنة أو طلب عرض نتائج، نحتاج استخراج الفلاتر من السياق
  if (isGeneralConversation && !isCurrentQueryPropertySearch && !isComparison && !wantsToSeeResults) {
    console.log(`💬 General conversation detected - skipping filter extraction`);
    return {};
  }

  // ✅ استخراج الفلاتر من الرسالة الحالية أولاً (الأولوية القصوى)
  const currentFilters = extractFiltersFromText(currentQuery);

  // إذا الرسالة الحالية فيها موقع محدد، استخدمه فقط (لا تدمج مع مواقع أخرى)
  const currentHasLocation = currentFilters.city && currentFilters.city.length > 0;
  const currentHasType = currentFilters.type != null;
  const currentHasPrice = currentFilters.minPrice != null || currentFilters.maxPrice != null;

  // البدء بالفلاتر الحالية
  let combinedFilters = { ...currentFilters };

  // ✅ للاستعلامات المقارنة أو طلب العرض، نستخرج من السياق الفلاتر الناقصة فقط
  const shouldExtractFromContext = isCurrentQueryPropertySearch || isComparison || wantsToSeeResults;

  if (shouldExtractFromContext && Array.isArray(history) && history.length > 0) {
    // ✅ البحث في تاريخ المحادثة من الأحدث للأقدم
    const recentHistory = history.slice(-8).reverse(); // آخر 8 رسائل من الأحدث

    for (const msg of recentHistory) {
      const content = msg?.content || msg?.text || "";
      if (content && (msg?.role === "user" || msg?.sender === "user")) {
        // تحقق أن الرسالة تحتوي على معلومات عقارية
        if (detectPropertySearchIntent(content)) {
          const msgFilters = extractFiltersFromText(content);

          // ✅ فقط أضف الفلاتر الناقصة (لا تستبدل الموجودة)
          // الموقع: فقط إذا الرسالة الحالية ليس فيها موقع
          if (!currentHasLocation && msgFilters.city && !combinedFilters.city) {
            combinedFilters.city = msgFilters.city;
            console.log(`📍 Using location from history: ${JSON.stringify(msgFilters.city)}`);
          }

          // نوع العقار: فقط إذا الرسالة الحالية ليس فيها نوع
          if (!currentHasType && msgFilters.type && !combinedFilters.type) {
            combinedFilters.type = msgFilters.type;
            console.log(`🏠 Using type from history: ${msgFilters.type}`);
          }

          // السعر: فقط إذا الرسالة الحالية ليس فيها سعر
          if (!currentHasPrice) {
            if (msgFilters.maxPrice && !combinedFilters.maxPrice) {
              combinedFilters.maxPrice = msgFilters.maxPrice;
              console.log(`💰 Using maxPrice from history: ${msgFilters.maxPrice}`);
            }
            if (msgFilters.minPrice && !combinedFilters.minPrice) {
              combinedFilters.minPrice = msgFilters.minPrice;
              console.log(`💰 Using minPrice from history: ${msgFilters.minPrice}`);
            }
          }

          // الغرف والمساحة
          if (msgFilters.bedrooms && !combinedFilters.bedrooms) {
            combinedFilters.bedrooms = msgFilters.bedrooms;
          }
          if (msgFilters.minArea && !combinedFilters.minArea) {
            combinedFilters.minArea = msgFilters.minArea;
          }
          if (msgFilters.maxArea && !combinedFilters.maxArea) {
            combinedFilters.maxArea = msgFilters.maxArea;
          }
        }
      }
    }
  }

  // ✅ استخراج من ملخص الذاكرة (أقل أولوية - فقط للفلاتر الناقصة تماماً)
  if (memorySummary && shouldExtractFromContext) {
    const memoryFilters = extractFiltersFromText(memorySummary);
    if (!combinedFilters.city && memoryFilters.city) {
      combinedFilters.city = memoryFilters.city;
    }
    if (!combinedFilters.type && memoryFilters.type) {
      combinedFilters.type = memoryFilters.type;
    }
  }

  // 4. معالجة خاصة للاستعلامات المقارنة (فقط إذا هناك فلاتر سابقة)
  if (Object.keys(combinedFilters).length > 0) {
    // "أرخص" أو "أقل سعر" - تقليل الحد الأقصى
    if (/أرخص|ارخص|أقل\s*سعر|اقل\s*سعر|cheaper|lower\s*price/i.test(currentQuery)) {
      if (combinedFilters.maxPrice) {
        combinedFilters.maxPrice = Math.floor(combinedFilters.maxPrice * 0.8); // تقليل 20%
      }
    }

    // "أغلى" أو "أفضل" - زيادة الحد الأدنى
    if (/أغلى|اغلى|أفضل|افضل|more\s*expensive|higher|better/i.test(currentQuery)) {
      if (combinedFilters.maxPrice && !combinedFilters.minPrice) {
        combinedFilters.minPrice = combinedFilters.maxPrice;
        delete combinedFilters.maxPrice;
      } else if (combinedFilters.minPrice) {
        combinedFilters.minPrice = Math.floor(combinedFilters.minPrice * 1.2); // زيادة 20%
      }
    }

    // "أكبر" - زيادة المساحة أو الغرف
    if (/أكبر|اكبر|bigger|larger|more\s*rooms/i.test(currentQuery)) {
      if (combinedFilters.bedrooms) {
        combinedFilters.bedrooms = combinedFilters.bedrooms + 1;
      }
      if (combinedFilters.minArea) {
        combinedFilters.minArea = Math.floor(combinedFilters.minArea * 1.2);
      }
    }

    // "أصغر" - تقليل المساحة أو الغرف
    if (/أصغر|اصغر|smaller|fewer\s*rooms/i.test(currentQuery)) {
      if (combinedFilters.bedrooms && combinedFilters.bedrooms > 1) {
        combinedFilters.bedrooms = combinedFilters.bedrooms - 1;
      }
    }
  }

  console.log(`📊 Extracted conversation filters:`, JSON.stringify(combinedFilters));
  return combinedFilters;
}

/**
 * بناء نص بحث موسع من سياق المحادثة
 * @param {String} currentQuery - الاستعلام الحالي  
 * @param {Object} filters - الفلاتر المستخرجة
 * @returns {String} - نص البحث المُوسع
 */
function buildEnhancedSearchQuery(currentQuery, filters = {}) {
  const parts = [currentQuery];

  // إضافة المدينة للبحث إذا لم تكن موجودة في الاستعلام
  if (filters.city) {
    const cities = Array.isArray(filters.city) ? filters.city : [filters.city];
    const queryCities = detectCityFromQuery(currentQuery);
    cities.forEach(city => {
      if (!queryCities.some(qc => qc.toLowerCase() === city.toLowerCase())) {
        parts.push(city);
      }
    });
  }

  // إضافة نوع العقار
  if (filters.type && !currentQuery.includes(filters.type)) {
    const typeArabic = {
      apartment: "شقة",
      villa: "فيلا",
      house: "منزل",
      project: "مشروع"
    };
    if (typeArabic[filters.type]) {
      parts.push(typeArabic[filters.type]);
    }
  }

  return parts.join(" ");
}

function buildMongoFilterFromNormalizedFilters(filters = {}) {
  const mongoFilter = {};
  if (filters.minPrice || filters.maxPrice) {
    mongoFilter.price = {};
    if (filters.minPrice) mongoFilter.price.$gte = Number(filters.minPrice);
    if (filters.maxPrice) mongoFilter.price.$lte = Number(filters.maxPrice);
  }
  if (filters.type) {
    mongoFilter.type = filters.type;
  }
  if (filters.bedrooms) {
    mongoFilter.bedrooms = { $gte: Number(filters.bedrooms) };
  }
  const cityValues = toArray(filters.city).map(
    (city) => new RegExp(`^${escapeRegExp(city)}$`, "i")
  );
  if (cityValues.length) {
    mongoFilter["location.city"] = cityValues.length === 1 ? cityValues[0] : { $in: cityValues };
  }
  const areaValues = toArray(filters.area).map(
    (area) => new RegExp(`^${escapeRegExp(area)}$`, "i")
  );
  if (areaValues.length) {
    mongoFilter["location.area"] = areaValues.length === 1 ? areaValues[0] : { $in: areaValues };
  }
  return mongoFilter;
}

const PROPERTY_TYPE_MAP = {
  apartment: "apartment",
  villa: "villa",
  duplex: "house",
  studio: "apartment",
  land: "project",
  commercial: "project",
};

const AREA_RANGE_MAP = {
  "<100": { max: 100 },
  "100-150": { min: 100, max: 150 },
  "150-200": { min: 150, max: 200 },
  ">200": { min: 200 },
};

// Keywords that indicate property search intent
const SEARCH_INTENT_KEYWORDS = [
  // Arabic
  "شقة", "فيلا", "منزل", "عقار", "بيت", "استديو", "دوبلكس", "أرض",
  "ابحث", "اريد", "عايز", "محتاج", "اشتري", "استأجر", "اجار",
  "للبيع", "للإيجار", "للايجار", "بكام", "سعر", "تمن",
  "القاهرة", "الجيزة", "الاسكندرية", "اسوان", "الغردقة", "شرم",
  "غرف", "غرفة", "حمام", "مساحة", "متر",
  "مشروع", "كمبوند", "compound",
  // ✅ كلمات الترشيح والاقتراح
  "رشح", "رشحلى", "رشحلي", "ترشيح", "اختيارات", "اقتراحات", "اقتراح", "نتائج", "اختيار",
  "ورين", "وريني", "عرض", "اعرض", "شوف", "شوفني", "دور", "دورلي",
  // ✅ مواقع إضافية
  "زايد", "الشيخ زايد", "التجمع", "المعادي", "مدينة نصر", "الزمالك", "المهندسين",
  "العبور", "الرحاب", "العين السخنة", "السخنة", "الساحل", "الساحل الشمالي",
  // English
  "apartment", "villa", "house", "property", "studio", "duplex", "land",
  "search", "find", "looking for", "want", "need", "buy", "rent",
  "for sale", "for rent", "price", "cost",
  "cairo", "giza", "alexandria", "aswan", "hurghada",
  "bedroom", "bathroom", "area", "sqm",
  "project", "compound", "recommend", "suggestions", "show", "results",
  "zayed", "sheikh zayed", "maadi", "nasr city", "zamalek", "mohandessin",
  "new cairo", "fifth settlement", "sokhna", "north coast", "sahel"
];

// General conversation keywords (NOT property search)
const GENERAL_KEYWORDS = [
  "مرحبا", "مرحباً", "السلام", "اهلا", "أهلا", "هاي", "هلو",
  "كيف", "ايه", "إيه", "شو", "وش",
  "شكرا", "شكراً", "تسلم", "ممتاز", "رائع", "جميل",
  "hello", "hi", "hey", "greetings", "thanks", "thank you",
  "how are you", "what's up", "good", "great", "nice"
];

// Keywords that indicate negotiation status inquiry
const NEGOTIATION_STATUS_KEYWORDS = [
  "تفاوض", "التفاوض", "حالة التفاوض", "رد البائع", "البائع", "وافق", "الموافقة",
  "العرض", "عرضي", "طلبي", "حالة الطلب", "رد", "الرد", "يرد", "متى",
  "negotiation", "status", "seller", "response", "approved", "offer",
  // ✅ أسئلة المتابعة عن التفاوضات
  "قيمة العرض", "كام العرض", "كم العرض", "مبلغ العرض", "السعر المعروض",
  "تفاصيل العرض", "إيه العرض", "ايه العرض", "العرض اللي قدمناه", "العرض اللى قدمناه",
  "قدمنا كام", "عرضنا كام", "السعر اللي عرضته", "السعر اللى عرضته",
  "المفاوضات", "مفاوضاتي", "العروض بتاعتي", "عروضي", "العروض اللي قدمتها",
  "اخبار التفاوض", "أخبار التفاوض", "اي اخبار", "أي أخبار", "فين التفاوض",
  "شقة اسوان", "عقار اسوان", "اسوان" // كلمات مرتبطة بالعقارات في السياق
];

/**
 * Check if user is asking about negotiation status
 */
function detectNegotiationStatusIntent(query = "") {
  const lowerQuery = query.toLowerCase();
  return NEGOTIATION_STATUS_KEYWORDS.some(keyword =>
    lowerQuery.includes(keyword.toLowerCase())
  );
}

/**
 * ✅ كشف سؤال متابعة عن تفاصيل العرض/التفاوض
 * مثل: "كام قيمة العرض؟" أو "إيه العرض اللي قدمناه؟"
 */
function detectOfferDetailsInquiry(query = "") {
  const lowerQuery = query.toLowerCase();
  const offerDetailsKeywords = [
    "كام قيمة", "قيمة العرض", "كم العرض", "مبلغ العرض",
    "ايه العرض", "إيه العرض", "العرض اللي قدمناه", "العرض اللى قدمناه",
    "قدمنا كام", "عرضنا كام", "السعر اللي عرضته", "السعر اللى عرضته",
    "تفاصيل العرض", "شروط العرض", "العرض بتاعي", "عرضي كان",
    "فلوس العرض", "الفلوس اللي عرضناها"
  ];
  return offerDetailsKeywords.some(keyword =>
    lowerQuery.includes(keyword.toLowerCase())
  );
}

/**
 * Check if user is asking about contracts, deals, reservations status
 */
function detectTransactionStatusIntent(query = "") {
  const lowerQuery = query.toLowerCase();
  const transactionKeywords = [
    "عقد", "العقد", "عقدي", "عقود",
    "حجز", "الحجز", "حجزي", "حجوزاتي",
    "صفقة", "الصفقة", "صفقتي", "صفقاتي",
    "عربون", "العربون",
    "توقيع", "وقعت", "موقع",
    "مسودة", "المسودة",
    "contract", "deal", "reservation",
    "أنشأت", "انشاء", "إنشاء",
    "حالة العقد", "حالة الحجز",
  ];
  return transactionKeywords.some(keyword =>
    lowerQuery.includes(keyword.toLowerCase())
  );
}

/**
 * ✅ كشف نية الحجز / دفع العربون / الإلغاء / المتابعة
 * @param {String} query - استعلام المستخدم
 * @returns {Object|null} - نوع الإجراء المطلوب أو null
 */
function detectReservationIntent(query = "") {
  const lowerQuery = query.toLowerCase().trim();

  // ❌ استبعاد الأسئلة عن الحالة (هذه للـ detectTransactionStatusIntent)
  const isStatusQuestion = /(?:إيه|ايه|ما|شو)\s*(?:حالة|وضع)|حالة\s*(?:الحجز|العقد|الصفقة)|حجوزاتي|عقودي|صفقاتي/i.test(lowerQuery);
  if (isStatusQuestion) {
    return null;
  }

  // ✅ كلمات طلب الحجز ودفع العربون
  const reservationKeywords = [
    // حجز مباشر
    "احجز", "أحجز", "حجز", "احجزه", "احجزها", "احجز ده", "احجز دي", "احجز الشقة", "احجز الفيلا", "احجز العقار",
    "عايز احجز", "عاوز احجز", "أريد حجز", "اريد احجز", "نحجز", "خلينا نحجز",
    "تمام احجز", "تمام خلاص احجز", "يلا نحجز", "موافق احجز", "اوكي احجز",
    // دفع العربون
    "ادفع العربون", "أدفع العربون", "ادفع عربون", "أدفع عربون", "العربون",
    "ادفع المقدم", "أدفع المقدم", "المقدم", "دفع المقدم",
    "اكمل الحجز", "أكمل الحجز", "كمل الحجز", "خلص الحجز",
    // بالإنجليزي
    "reserve", "book", "book it", "pay deposit", "pay reservation", "complete booking", "make reservation",
  ];

  // ✅ كلمات الإلغاء
  const cancelKeywords = [
    // إلغاء مباشر
    "الغي", "ألغي", "الغيه", "الغيها", "الغي الحجز", "ألغي الحجز",
    "الغي المسودة", "ألغي المسودة", "الغي العقد", "ألغي العقد",
    "الغي الصفقة", "ألغي الصفقة", "الغي التفاوض", "ألغي التفاوض",
    "مش عايز", "مش عاوز", "مش هكمل", "مش هاكمل",
    "وقف", "أوقف", "وقف التفاوض", "أوقف التفاوض", "وقف الحجز",
    "تراجع", "تراجعت", "اتراجع", "أتراجع",
    "غيرت رأيي", "غيرت رايي", "بدلت رأيي",
    "ما بدي", "مابدي",
    // بالإنجليزي
    "cancel", "stop", "don't want", "dont want", "cancel booking", "cancel reservation", "cancel deal",
  ];

  // ✅ كلمات الاستكمال والمتابعة
  const continueKeywords = [
    // استكمال
    "اكمل", "أكمل", "كمل", "يلا نكمل", "خلينا نكمل",
    "أكمل الصفقة", "اكمل الصفقة", "أكمل العقد", "اكمل العقد",
    "وقع", "أوقع", "وقع العقد", "أوقع العقد",
    "امضي", "أمضي", "امضي العقد",
    "موافق", "تمام", "خلاص", "ماشي", "تم", "اوكي", "ok", "okay",
    "موافق نكمل", "تمام نكمل", "يلا نكمل",
    // بالإنجليزي
    "continue", "proceed", "go ahead", "sign", "sign contract", "complete", "finalize",
  ];

  // ✅ كلمات طلب إنشاء مسودة عقد
  const draftRequestKeywords = [
    "اعمل عقد", "أعمل عقد", "اعملي عقد", "أعملي عقد",
    "انشئ عقد", "أنشئ عقد", "إنشاء عقد",
    "اعمل مسودة", "أعمل مسودة", "انشئ مسودة",
    "جهز العقد", "جهزلي عقد", "حضر العقد",
    "create contract", "make contract", "draft contract", "generate contract",
  ];

  // التحقق من نوع النية
  for (const keyword of reservationKeywords) {
    if (lowerQuery.includes(keyword.toLowerCase())) {
      return { action: "request_reservation", keyword };
    }
  }

  for (const keyword of cancelKeywords) {
    if (lowerQuery.includes(keyword.toLowerCase())) {
      return { action: "cancel_reservation_or_deal", keyword };
    }
  }

  for (const keyword of draftRequestKeywords) {
    if (lowerQuery.includes(keyword.toLowerCase())) {
      return { action: "request_draft_contract", keyword };
    }
  }

  // التحقق من كلمات الاستكمال (أقل أولوية لأنها عامة)
  for (const keyword of continueKeywords) {
    if (lowerQuery.includes(keyword.toLowerCase())) {
      // ✅ تحقق إضافي: هل السياق يدل على استكمال صفقة؟
      const dealContext = /صفقة|عقد|حجز|عربون|تفاوض|deal|contract|reservation/i.test(lowerQuery);
      if (dealContext || lowerQuery.length < 15) {
        return { action: "continue_process", keyword };
      }
    }
  }

  return null;
}

/**
 * Get user's active negotiations with their status
 */
async function getUserNegotiations(userId) {
  if (!userId) return [];

  try {
    const sessions = await NegotiationSession.find({ buyer: userId })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate("property", "title price location")
      .lean();

    return sessions.map(session => ({
      id: session._id,
      propertyTitle: session.property?.title || session.propertySnapshot?.title || "عقار",
      propertyPrice: session.property?.price || session.propertySnapshot?.price,
      status: session.status,
      statusArabic: getStatusArabic(session.status),
      buyerOffer: session.buyerOffer,
      sellerTerms: session.sellerTerms,
      decisionNotes: session.decisionNotes,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }));
  } catch (error) {
    console.error("Failed to fetch user negotiations:", error.message);
    return [];
  }
}

/**
 * ✅ كشف نية التفاوض على عقار (بدون سعر محدد بالضرورة)
 * @param {String} query - استعلام المستخدم
 * @returns {Object|null} - معلومات نية التفاوض أو null
 */
function detectNegotiationRequestIntent(query = "") {
  const lowerQuery = query.toLowerCase();

  // ❌ استبعاد الجمل التي تحتوي على "قدم عرض" أو "أقدم عرض" - هذه يجب أن تلتقطها detectPriceOfferIntent
  const isExplicitOffer = /(?:أ|ا)?قدم\s+عرض|عرض.*(?:على|علي)|أعرض|اعرض/i.test(lowerQuery);
  if (isExplicitOffer) {
    return null;
  }

  // ❌ استبعاد جمل الإيجار - يجب أن تلتقطها detectRentalOfferIntent
  const isRentalIntent = /تفاوض.*(?:إيجار|ايجار)|(?:إيجار|ايجار).*تفاوض|rent/i.test(lowerQuery);
  if (isRentalIntent) {
    return null;
  }

  // كلمات تدل على طلب التفاوض
  const negotiationKeywords = /عايز\s*(?:أ|ا)?تفاوض|عاوز\s*(?:أ|ا)?تفاوض|أريد\s*(?:أ|ا)?تفاوض|اريد\s*(?:أ|ا)?تفاوض|ابدأ\s*تفاوض|أبدأ\s*تفاوض|تفاوض\s*(?:على|علي)|اتفاوض\s*(?:على|علي)|أتفاوض\s*(?:على|علي)|negotiate|start.*negotiation/i;

  if (!negotiationKeywords.test(lowerQuery)) {
    return null;
  }

  // محاولة استخراج اسم العقار
  const propertyPatterns = [
    // "عايز اتفاوض على جاردن سيتي ب 3 مليون كاش" - مع سعر ونوع دفع
    /(?:عايز|عاوز|أريد|اريد)?\s*(?:أ|ا)?(?:تفاوض|اتفاوض|أتفاوض)\s*(?:على|علي)\s+(.+?)(?:\s+(?:ب|بسعر|بـ)\s*[\d,.]+|\s+(?:كاش|تقسيط|نقد)\s*$|$)/i,
  ];

  let propertyName = null;
  for (const pattern of propertyPatterns) {
    const match = query.match(pattern);
    if (match && match[1]) {
      propertyName = match[1].trim();
      // إزالة كلمات زائدة في النهاية (لكن احتفظ بأرقام المناطق مثل 6 أكتوبر)
      propertyName = propertyName.replace(/\s+(?:بسعر|بـ|السعر|نقدي|كاش|تقسيط)\s*[\d,.]*.*$/i, '').trim();
      // إزالة السعر في النهاية فقط إذا كان مليون أو جنيه
      propertyName = propertyName.replace(/\s+[\d,.]+\s*(?:مليون|جنيه).*$/i, '').trim();
      if (propertyName.length > 2) break;
    }
  }

  // استخراج نوع الدفع إن وجد
  const isCash = /كاش|نقد|cash/i.test(lowerQuery);
  const isInstallment = /تقسيط|قسط|installment/i.test(lowerQuery);

  // استخراج السعر إن وجد
  let offeredPrice = null;
  const pricePatterns = [
    /(\d+(?:\.\d+)?)\s*(?:مليون|million)/i,
    /([\d,]+)\s*(?:جنيه|egp|pound)/i,
    /(?:^|\s)(\d{6,})(?:\s|$)/,
  ];

  for (const pattern of pricePatterns) {
    const match = query.match(pattern);
    if (match) {
      let price = match[1].replace(/,/g, '');
      price = parseFloat(price);
      if (pattern.source.includes('مليون|million')) {
        price = price * 1000000;
      }
      if (price >= 10000) {
        offeredPrice = price;
        break;
      }
    }
  }

  return {
    action: 'startNegotiation',
    propertyName,
    offeredPrice,
    offerType: isCash ? 'cash' : (isInstallment ? 'installments' : null),
    hasPrice: !!offeredPrice,
    hasPaymentType: isCash || isInstallment,
  };
}

/**
 * ✅ كشف نية تقديم عرض سعر على عقار
 * @param {String} query - استعلام المستخدم
 * @param {Array} conversationHistory - تاريخ المحادثة للبحث عن السعر
 * @returns {Object|null} - معلومات العرض المطلوب أو null
 */
function detectPriceOfferIntent(query = "", conversationHistory = []) {
  const lowerQuery = query.toLowerCase();

  // ❌ استبعاد الأسئلة عن العروض السابقة (ماضي، استفهام)
  const isPastOrQuestion = /قدمنا|قدمت.*قبل|ولا\s*لسة|هل.*قدم|تم.*تقديم|أرسلت.*قبل/i.test(lowerQuery);
  if (isPastOrQuestion) {
    return null;
  }

  // كلمات تدل على تقديم عرض سعر أو تأكيد العرض (مضارع/أمر فقط)
  // ✅ إضافة كلمات التأكيد: "قدمه"، "ابعته"، "نفذ العرض"، "موافق"، "تمام"
  const offerKeywords = /أعرض|اعرض|عرض.*على|عرضي|أقدم|اقدم|قدم.*عرض|قدمه|قدمها|ابعت|ابعته|نفذ.*العرض|موافق.*العرض|تمام.*قدم|اوكي.*قدم|negotiate|offer/i;

  // ✅ كلمات التأكيد القصيرة (تحتاج سياق سعر من المحادثة)
  const confirmKeywords = /^(قدمه|قدمها|ابعته|نفذه|موافق|تمام|اوكي|ok|yes|نعم|اه|ايوه)[\s.,!؟]*$/i;
  const isConfirmation = confirmKeywords.test(query.trim());

  // ❌ لا تكتشف عرض إذا لم تكن الرسالة الحالية تدل على نية عرض (إلا إذا كانت كلمة تأكيد)
  if (!offerKeywords.test(lowerQuery) && !isConfirmation) {
    return null;
  }

  // استخراج السعر المعروض (بالأرقام - مليون، ألف، جنيه)
  const pricePatterns = [
    // 3 مليون، ٣ مليون
    /(\d+(?:\.\d+)?)\s*(?:مليون|million)/i,
    // 3,000,000 جنيه
    /([\d,]+)\s*(?:جنيه|egp|pound)/i,
    // 3000000 (رقم كبير مباشر)
    /(?:^|\s)(\d{6,})(?:\s|$)/,
  ];

  let offeredPrice = null;

  for (const pattern of pricePatterns) {
    const match = query.match(pattern);
    if (match) {
      let price = match[1].replace(/,/g, '');
      price = parseFloat(price);

      // إذا كان بالمليون، اضربه في مليون
      if (pattern.source.includes('مليون|million')) {
        price = price * 1000000;
      }

      offeredPrice = price;
      break;
    }
  }

  // إذا مفيش سعر في الرسالة الحالية ولكن توجد كلمة عرض قوية أو تأكيد، ابحث في آخر 5 رسائل
  if ((!offeredPrice || offeredPrice < 10000)) {
    if (conversationHistory && conversationHistory.length > 0) {
      // ابحث في آخر 5 رسائل عن سعر
      for (let i = conversationHistory.length - 1; i >= Math.max(0, conversationHistory.length - 5); i--) {
        const message = conversationHistory[i];
        const messageText = message?.content || message?.text || "";

        for (const pattern of pricePatterns) {
          const match = messageText.match(pattern);
          if (match) {
            let price = match[1].replace(/,/g, '');
            price = parseFloat(price);

            if (pattern.source.includes('مليون|million')) {
              price = price * 1000000;
            }

            if (price >= 10000) {
              offeredPrice = price;
              console.log(`📍 Found price ${offeredPrice.toLocaleString()} from conversation history`);
              break;
            }
          }
        }

        if (offeredPrice && offeredPrice >= 10000) break;
      }
    }
  }

  // لسه مفيش سعر؟ يبقى مش offer كامل
  if (!offeredPrice || offeredPrice < 10000) {
    return null;
  }

  // استخراج نوع الدفع (كاش أو تقسيط) - من الرسالة الحالية أو السياق
  let isCash = /كاش|نقد|cash/i.test(lowerQuery);
  let isInstallment = /تقسيط|قسط|installment/i.test(lowerQuery);

  // ✅ إذا لم نجد نوع دفع في الرسالة الحالية، ابحث في آخر 3 رسائل
  if (!isCash && !isInstallment && conversationHistory && conversationHistory.length > 0) {
    for (let i = conversationHistory.length - 1; i >= Math.max(0, conversationHistory.length - 3); i--) {
      const message = conversationHistory[i];
      const messageText = message?.content || message?.text || "";
      if (/كاش|نقد|cash/i.test(messageText)) {
        isCash = true;
        console.log(`📍 Found payment type 'cash' from conversation history`);
        break;
      }
      if (/تقسيط|قسط|installment/i.test(messageText)) {
        isInstallment = true;
        console.log(`📍 Found payment type 'installments' from conversation history`);
        break;
      }
    }
  }

  const result = {
    action: 'submitOffer',
    offeredPrice,
    offerType: isCash ? 'cash' : (isInstallment ? 'installments' : 'cash'), // default to cash
  };

  // استخراج نسبة المقدم إن وجدت
  const downMatch = query.match(/(?:مقدم|المقدم)\s*(\d+)\s*%?|(\d+)\s*%\s*(?:مقدم|المقدم)/i);
  if (downMatch && isInstallment) {
    result.downPaymentPercent = parseInt(downMatch[1] || downMatch[2]);
  }

  // استخراج سنوات التقسيط إن وجدت
  const yearsMatch = query.match(/(\d+)\s*(?:سن[وة]ات?|سنين)/i);
  if (yearsMatch && isInstallment) {
    result.installmentYears = parseInt(yearsMatch[1]);
  }

  return result;
}

/**
 * ✅ كشف نية تقديم عرض إيجار
 * @param {String} query - استعلام المستخدم
 * @param {Array} conversationHistory - تاريخ المحادثة
 * @returns {Object|null} - معلومات عرض الإيجار أو null
 */
function detectRentalOfferIntent(query = "", conversationHistory = []) {
  const lowerQuery = query.toLowerCase();

  // كلمات تدل على طلب عرض إيجار (مع السماح بكلمات بينية مثل "على")
  const rentalKeywords = /عرض.*(?:على|علي)?\s*(?:إيجار|ايجار)|(?:إيجار|ايجار).*عرض|أقدم.*(?:على|علي)?\s*(?:إيجار|ايجار)|اقدم.*(?:على|علي)?\s*(?:إيجار|ايجار)|ابعت.*(?:إيجار|ايجار)|تفاوض.*(?:على|علي)?\s*(?:إيجار|ايجار)|اتفاوض.*(?:على|علي)?\s*(?:إيجار|ايجار)|أتفاوض.*(?:على|علي)?\s*(?:إيجار|ايجار)|rent.*offer|rental.*offer|negotiate.*rent/i;

  // أيضاً: كشف "شهريًا" أو "في الشهر" مع "سنة/سنتين" كإشارة إيجار
  const monthlyWithDuration = /(?:شهر|شهريا|شهرياً|الشهر|في\s*الشهر).*(?:سن[ةه]|سنتين|سنوات)/i;
  const durationWithMonthly = /(?:سن[ةه]|سنتين|سنوات).*(?:شهر|شهريا|شهرياً|الشهر|في\s*الشهر)/i;

  if (!rentalKeywords.test(lowerQuery) && !monthlyWithDuration.test(lowerQuery) && !durationWithMonthly.test(lowerQuery)) {
    return null;
  }

  console.log("🏠 Rental offer intent detected");

  // استخراج السعر الشهري المعروض
  const pricePatterns = [
    // "10 ألف في الشهر" أو "10 الاف شهريا"
    /(\d+(?:\.\d+)?)\s*(?:ألف|الف|الاف|k)/i,
    /(\d+(?:,\d+)?)\s*(?:جنيه|egp)?\s*(?:في|فى|\/)\s*(?:الشهر|شهر|شهريا|شهرياً)/i,
    /(\d+(?:,\d+)?)\s*(?:جنيه|egp)?\s*(?:شهري|شهرياً|شهريا)/i,
    /([\d,]+)\s*(?:جنيه|egp)/i,
  ];

  let monthlyRent = null;

  for (const pattern of pricePatterns) {
    const match = query.match(pattern);
    if (match) {
      let price = match[1].replace(/,/g, '');
      price = parseFloat(price);

      // إذا كان "ألف" أو "الاف"، اضرب في 1000
      if (pattern.source.includes('ألف|الف|الاف')) {
        price = price * 1000;
      }

      if (price >= 1000) {
        monthlyRent = price;
        console.log(`📍 Found monthly rent: ${monthlyRent.toLocaleString()} EGP`);
        break;
      }
    }
  }

  // إذا مفيش سعر في الرسالة الحالية، ابحث في السياق
  if (!monthlyRent && conversationHistory && conversationHistory.length > 0) {
    for (let i = conversationHistory.length - 1; i >= Math.max(0, conversationHistory.length - 3); i--) {
      const message = conversationHistory[i];
      const messageText = message?.content || message?.text || "";

      // البحث عن سعر إيجار في السياق
      const contextMatch = messageText.match(/(\d+(?:,\d+)?)\s*(?:جنيه)?\s*شهر/i);
      if (contextMatch) {
        let price = contextMatch[1].replace(/,/g, '');
        price = parseFloat(price);
        if (price >= 1000) {
          monthlyRent = price;
          console.log(`📍 Found monthly rent from context: ${monthlyRent.toLocaleString()} EGP`);
          break;
        }
      }
    }
  }

  // استخراج مدة الإيجار
  const durationPatterns = [
    /(\d+)\s*(?:سنة|سن[وة]|year)/i,
    /(?:لمدة|مدة)\s*(\d+)/i,
  ];

  let rentalDuration = null;
  for (const pattern of durationPatterns) {
    const match = query.match(pattern);
    if (match) {
      rentalDuration = parseInt(match[1]);
      break;
    }
  }

  return {
    action: 'submitRentalOffer',
    monthlyRent,
    rentalDuration,
    offerType: 'rental',
  };
}

/**
 * ✅ كشف نية تعديل عرض التفاوض
 * @param {String} query - استعلام المستخدم
 * @returns {Object|null} - معلومات التعديل المطلوب أو null
 */
function detectOfferModificationIntent(query = "") {
  const lowerQuery = query.toLowerCase();

  // كلمات تدل على طلب التغيير
  const modifyKeywords = /غير|غيّر|بدّل|حوّل|عدّل|عاوز.*بدل|عايز.*بدل|change|modify|switch|update/i;

  // كشف التغيير من كاش إلى تقسيط
  const cashToInstallment = /كاش.*(?:الى|إلى|ل|بدل|لـ).*(?:تقسيط|قسط)|(?:بدل|غير|حول).*(?:كاش|نقد).*(?:تقسيط|قسط)|(?:مش|لا).*كاش.*(?:تقسيط|قسط)|(?:عايز|عاوز|محتاج).*تقسيط.*بدل.*كاش/i;

  // كشف التغيير من تقسيط إلى كاش
  const installmentToCash = /تقسيط.*(?:الى|إلى|ل|بدل|لـ).*(?:كاش|نقد)|(?:بدل|غير|حول).*(?:تقسيط|قسط).*(?:كاش|نقد)|(?:مش|لا).*تقسيط.*(?:كاش|نقد)|(?:عايز|عاوز|محتاج).*(?:كاش|نقد).*بدل.*تقسيط/i;

  // كشف تغيير نسبة المقدم
  const downPaymentChange = /(?:غير|عدل|بدل).*(?:مقدم|المقدم)|مقدم.*(?:\d+).*%|(?:\d+).*%.*مقدم/i;

  // كشف تغيير سنوات التقسيط
  const installmentYearsChange = /(?:غير|عدل|بدل).*(?:سن[وة]ات|مد[ةه])|(?:على|لمدة).*(\d+).*سن[وة]|(\d+).*سن[وة].*تقسيط/i;

  // ✅ كشف تعديل السعر المعروض
  const priceChangeKeywords = /(?:غير|عدل|بدل|حدث).*(?:السعر|العرض|المبلغ)|(?:السعر|العرض|المبلغ).*(?:الى|إلى|ل|يكون)|(?:عايز|عاوز|اريد|أريد).*(?:أعرض|اعرض|عرض).*(?:جديد|تاني)/i;

  if (priceChangeKeywords.test(query)) {
    const result = { action: 'changePrice' };

    // استخراج السعر الجديد
    const pricePatterns = [
      /(\d+(?:\.\d+)?)\s*(?:مليون|million)/i,
      /([\d,]+)\s*(?:جنيه|egp|pound)/i,
      /(?:^|\s)(\d{6,})(?:\s|$)/,
    ];

    for (const pattern of pricePatterns) {
      const match = query.match(pattern);
      if (match) {
        let price = match[1].replace(/,/g, '');
        price = parseFloat(price);
        if (pattern.source.includes('مليون|million')) {
          price = price * 1000000;
        }
        if (price >= 10000) {
          result.newPrice = price;
          break;
        }
      }
    }

    // استخراج نوع الدفع إن تغير
    const isCash = /كاش|نقد|cash/i.test(lowerQuery);
    const isInstallment = /تقسيط|قسط|installment/i.test(lowerQuery);
    if (isCash) result.offerType = 'cash';
    if (isInstallment) result.offerType = 'installments';

    return result;
  }

  // ✅ تحقق من التغيير لتقسيط أولاً (له أولوية)
  if (cashToInstallment.test(query)) {
    const result = { action: 'changeToInstallments' };

    // استخراج نسبة المقدم إن وجدت
    const downMatch = query.match(/(?:مقدم|المقدم)\s*(\d+)\s*%?|(\d+)\s*%\s*(?:مقدم|المقدم)/i);
    if (downMatch) {
      result.downPaymentPercent = parseInt(downMatch[1] || downMatch[2]);
    }

    // استخراج سنوات التقسيط إن وجدت
    const yearsMatch = query.match(/(\d+)\s*(?:سن[وة]ات?|سنين)/i);
    if (yearsMatch) {
      result.installmentYears = parseInt(yearsMatch[1]);
    }

    return result;
  }

  if (installmentToCash.test(query)) {
    return { action: 'changeToCash' };
  }

  // ✅ كلمات صريحة للتغيير لتقسيط (لها أولوية على تعديل التفاصيل)
  const explicitInstallmentRequest = /(?:بدل|غير|حول).*(?:ل|إلى|الى)\s*تقسيط/i;
  if (explicitInstallmentRequest.test(query)) {
    const result = { action: 'changeToInstallments' };

    const downMatch = query.match(/(?:مقدم|المقدم)\s*(\d+)\s*%?|(\d+)\s*%\s*(?:مقدم|المقدم)/i);
    if (downMatch) {
      result.downPaymentPercent = parseInt(downMatch[1] || downMatch[2]);
    }

    const yearsMatch = query.match(/(\d+)\s*(?:سن[وة]ات?|سنين)/i);
    if (yearsMatch) {
      result.installmentYears = parseInt(yearsMatch[1]);
    }

    return result;
  }

  // تغيير تفاصيل التقسيط فقط
  if (downPaymentChange.test(query) || installmentYearsChange.test(query)) {
    const result = { action: 'modifyInstallmentTerms' };

    const downMatch = query.match(/(?:مقدم|المقدم)\s*(\d+)\s*%?|(\d+)\s*%\s*(?:مقدم|المقدم)/i);
    if (downMatch) {
      result.downPaymentPercent = parseInt(downMatch[1] || downMatch[2]);
    }

    const yearsMatch = query.match(/(\d+)\s*(?:سن[وة]ات?|سنين)/i);
    if (yearsMatch) {
      result.installmentYears = parseInt(yearsMatch[1]);
    }

    return result;
  }

  return null;
}

/**
 * ✅ تحديث عرض التفاوض فعلياً في قاعدة البيانات
 * @param {String} userId - معرف المستخدم
 * @param {Object} modification - التعديل المطلوب
 * @param {String} propertyTitle - اسم العقار (اختياري لتحديد أي جلسة)
 * @returns {Object} - نتيجة التحديث
 */
async function updateNegotiationOffer(userId, modification, propertyTitle = null) {
  if (!userId || !modification) {
    return { success: false, message: "بيانات ناقصة" };
  }

  try {
    // البحث عن جلسة التفاوض النشطة للمستخدم
    const query = {
      buyer: userId,
      status: { $in: ['pending', 'approved', 'draft_requested'] }
    };

    // إذا حدد اسم العقار، نبحث به
    let session;
    if (propertyTitle) {
      session = await NegotiationSession.findOne(query)
        .populate("property", "title")
        .sort({ updatedAt: -1 });

      // فلترة بالاسم
      if (session && !session.property?.title?.includes(propertyTitle) &&
        !session.propertySnapshot?.title?.includes(propertyTitle)) {
        // ابحث عن جلسة أخرى تطابق الاسم
        const allSessions = await NegotiationSession.find(query)
          .populate("property", "title")
          .sort({ updatedAt: -1 });

        session = allSessions.find(s =>
          s.property?.title?.includes(propertyTitle) ||
          s.propertySnapshot?.title?.includes(propertyTitle)
        ) || session; // fallback to first session
      }
    } else {
      // إذا لم يحدد، نأخذ آخر جلسة نشطة
      session = await NegotiationSession.findOne(query)
        .populate("property", "title price")
        .sort({ updatedAt: -1 });
    }

    if (!session) {
      return {
        success: false,
        message: "لم أجد جلسة تفاوض نشطة. هل تريد بدء تفاوض جديد على عقار معين؟"
      };
    }

    const propertyName = session.property?.title || session.propertySnapshot?.title || "العقار";
    const oldOffer = session.buyerOffer || {};

    // تطبيق التعديل
    let newOffer = { ...oldOffer };
    let changeDescription = "";

    switch (modification.action) {
      case 'changeToCash':
        newOffer.offerType = 'cash';
        newOffer.cashOffer = true;
        delete newOffer.downPaymentPercent;
        delete newOffer.installmentYears;
        changeDescription = "تم تغيير العرض من تقسيط إلى كاش 💵";
        break;

      case 'changeToInstallments':
        newOffer.offerType = 'installments';
        newOffer.cashOffer = false;
        newOffer.downPaymentPercent = modification.downPaymentPercent || oldOffer.downPaymentPercent || 10;
        newOffer.installmentYears = modification.installmentYears || oldOffer.installmentYears || 3;
        changeDescription = `تم تغيير العرض إلى تقسيط: مقدم ${newOffer.downPaymentPercent}% على ${newOffer.installmentYears} سنوات 📊`;
        break;

      case 'modifyInstallmentTerms':
        if (modification.downPaymentPercent != null) {
          newOffer.downPaymentPercent = modification.downPaymentPercent;
        }
        if (modification.installmentYears != null) {
          newOffer.installmentYears = modification.installmentYears;
        }
        changeDescription = `تم تعديل شروط التقسيط: مقدم ${newOffer.downPaymentPercent || '—'}% على ${newOffer.installmentYears || '—'} سنوات`;
        break;

      case 'changePrice':
        if (!modification.newPrice) {
          return { success: false, message: "لم أتمكن من تحديد السعر الجديد. ممكن توضح السعر بالأرقام؟" };
        }

        // تحديث السعر المعروض
        const oldPrice = newOffer.cashOfferPrice || newOffer.offeredPrice || 0;
        newOffer.cashOfferPrice = modification.newPrice;
        newOffer.offeredPrice = modification.newPrice;

        // تحديث نوع الدفع إن تغير
        if (modification.offerType) {
          newOffer.offerType = modification.offerType;
          newOffer.cashOffer = modification.offerType === 'cash';
        }

        changeDescription = `تم تعديل السعر من ${oldPrice.toLocaleString()} إلى ${modification.newPrice.toLocaleString()} جنيه 💰`;
        if (modification.offerType) {
          changeDescription += ` (${modification.offerType === 'cash' ? 'كاش' : 'تقسيط'})`;
        }
        break;

      default:
        return { success: false, message: "نوع التعديل غير معروف" };
    }

    // حفظ التعديل في قاعدة البيانات
    console.log(`📝 Old offer:`, JSON.stringify(oldOffer));
    console.log(`📝 New offer:`, JSON.stringify(newOffer));

    session.buyerOffer = newOffer;
    session.updatedAt = new Date();
    session.markModified('buyerOffer'); // ✅ تأكد من أن Mongoose يعرف أن buyerOffer تغير
    await session.save();

    console.log(`✅ Negotiation offer updated for session ${session._id}:`, JSON.stringify(newOffer));

    return {
      success: true,
      message: changeDescription,
      propertyTitle: propertyName,
      newOffer,
      sessionId: session._id,
      sessionStatus: session.status,
      statusArabic: getStatusArabic(session.status)
    };

  } catch (error) {
    console.error("❌ Failed to update negotiation offer:", error);
    return {
      success: false,
      message: "حدث خطأ أثناء تحديث العرض. يرجى المحاولة مرة أخرى."
    };
  }
}

/**
 * ✅ إنشاء جلسة تفاوض جديدة من خلال الـ AI
 * @param {String} userId - معرف المستخدم
 * @param {String} propertyId - معرف العقار
 * @param {Object} offerDetails - تفاصيل العرض
 * @returns {Object} - نتيجة إنشاء الجلسة
 */
async function createNegotiationFromAI(userId, propertyId, offerDetails) {
  if (!userId || !propertyId || !offerDetails) {
    return { success: false, message: "بيانات ناقصة" };
  }

  try {
    // جلب بيانات العقار
    const property = await Property.findById(propertyId);
    if (!property) {
      return { success: false, message: "العقار غير موجود" };
    }

    // التحقق من أن العقار متاح
    const unavailableStatuses = ["sold", "rented"];
    if (property.status && unavailableStatuses.includes(property.status)) {
      const statusMessage = property.status === "sold" ? "تم بيع هذا العقار بالفعل" : "تم تأجير هذا العقار بالفعل";
      return { success: false, message: `عذراً، ${statusMessage}. يرجى البحث عن عقار آخر متاح.` };
    }

    // بناء تفاصيل العرض
    const buyerOffer = {
      offerType: offerDetails.offerType || 'cash',
      cashOffer: offerDetails.offerType === 'cash',
      cashOfferPrice: offerDetails.offeredPrice, // السعر المعروض من المشتري
      downPaymentPercent: offerDetails.downPaymentPercent || 10,
      installmentYears: offerDetails.installmentYears || 3,
      notes: offerDetails.notes || "",
    };

    // ✅ إذا كان العرض تقسيط، نحسب المقدم بناءً على السعر المعروض من المشتري
    if (offerDetails.offerType === 'installments' && offerDetails.offeredPrice) {
      buyerOffer.cashOfferPrice = null; // التقسيط ليس له سعر كاش
      // السعر الإجمالي هو ما عرضه المشتري
    }

    // بناء شروط البائع
    const sellerTerms = {
      downPaymentPercent: property.paymentPlan?.minDownPaymentPercent || 10,
      installmentYears: property.paymentPlan?.maxInstallmentYears || 3,
      cashOffer: property.paymentPlan?.paymentType === "cash",
      notes: property.paymentPlan?.notes || "",
      cashOfferPrice: property.price || 0,
    };

    // التحقق من وجود أي جلسة سابقة (نشطة أو غير نشطة)
    const allSessions = await NegotiationSession.find({
      property: property._id,
      buyer: userId,
    }).sort({ createdAt: -1 });

    if (allSessions && allSessions.length > 0) {
      const latestSession = allSessions[0];

      // حالات الجلسات النشطة
      const activeStatuses = ["pending", "approved", "draft_requested", "draft_generated", "draft_sent"];

      if (activeStatuses.includes(latestSession.status)) {
        // جلسة نشطة - تحديث العرض
        latestSession.buyerOffer = buyerOffer;
        latestSession.updatedAt = new Date();
        await latestSession.save();

        const statusArabic = getStatusArabic(latestSession.status);

        return {
          success: true,
          message: `حضرتك بالفعل قدمت عرض على هذا العقار قبل كده!\n📊 حالة العرض: ${statusArabic}\n✅ تم تحديث العرض بالمبلغ الجديد`,
          sessionId: latestSession._id,
          propertyTitle: property.title,
          offeredPrice: offerDetails.offeredPrice,
          propertyPrice: property.price,
          previousStatus: latestSession.status,
          statusArabic: statusArabic,
          duplicate: true,
          isActive: true,
        };
      } else if (latestSession.status === "declined") {
        // جلسة مرفوضة - السماح بتقديم عرض جديد
        return {
          success: true,
          message: `⚠️ حضرتك كنت قدمت عرض على هذا العقار قبل كده لكن البائع رفضه.\n\n💡 تقدر تقدم عرض جديد بسعر أحسن؟`,
          sessionId: latestSession._id,
          propertyTitle: property.title,
          offeredPrice: latestSession.buyerOffer?.cashOfferPrice,
          propertyPrice: property.price,
          previousStatus: "declined",
          statusArabic: "تم رفضه سابقاً ❌",
          needsNewOffer: true,
          duplicate: true,
          isActive: false,
        };
      } else if (latestSession.status === "confirmed") {
        // جلسة مؤكدة - لا يمكن التفاوض مرة أخرى
        return {
          success: false,
          message: `✅ حضرتك بالفعل حجزت هذا العقار وتم تأكيد الصفقة!\n\n🎉 الصفقة في مرحلة التنفيذ.\n\nهل تحتاج مساعدة في عقار آخر؟`,
          sessionId: latestSession._id,
          propertyTitle: property.title,
          previousStatus: "confirmed",
          statusArabic: "تم التأكيد والحجز 🎉",
          duplicate: true,
          isActive: false,
        };
      }
    }

    // إنشاء جلسة تفاوض جديدة
    const session = await NegotiationSession.create({
      property: property._id,
      propertySnapshot: {
        title: property.title,
        price: property.price,
        location: property.location,
        listingStatus: property.listingStatus,
      },
      buyer: userId,
      seller: property.seller || property.developer,
      buyerOffer,
      sellerTerms,
      intentType: offerDetails.offerType || 'cash',
    });

    console.log(`✅ Negotiation session created via AI: ${session._id} for ${property.title}`);

    // ✅ إرسال إشعار للبائع مع تفاصيل العرض
    try {
      const sellerId = property.seller || property.developer;
      const sellerRole = property.developer ? "real_estate_developer" : "seller";

      // بناء رسالة الإشعار مع السعر المعروض
      let offerDetails_text = "";
      if (offerDetails.offerType === "cash" && offerDetails.offeredPrice) {
        offerDetails_text = ` بسعر ${offerDetails.offeredPrice.toLocaleString()} جنيه كاش`;
      } else if (offerDetails.offerType === "installments") {
        offerDetails_text = ` بنظام تقسيط: مقدم ${offerDetails.downPaymentPercent || 10}% على ${offerDetails.installmentYears || 3} سنوات`;
      } else if (offerDetails.offerType === "rent" && offerDetails.rentBudget) {
        offerDetails_text = ` للإيجار بـ ${offerDetails.rentBudget.toLocaleString()} جنيه شهرياً`;
      }

      await createNotification({
        type: "info",
        title: "عرض تفاوض جديد من المساعد الذكي",
        message: `مشتري قدم عرض تفاوض على ${property.developer ? "مشروعك" : "عقارك"}: ${property.title}${offerDetails_text}`,
        recipient: sellerId,
        recipientRole: sellerRole,
        referenceId: session._id,
        referenceType: "negotiation",
      });

      console.log(`✅ Notification sent to seller for negotiation ${session._id}`);
    } catch (notifError) {
      console.error("⚠️ Failed to send notification to seller:", notifError.message);
      // لا نفشل العملية بسبب الإشعار
    }

    return {
      success: true,
      message: "تم تقديم العرض بنجاح! ⏳ في انتظار رد البائع...",
      sessionId: session._id,
      propertyTitle: property.title,
      offeredPrice: offerDetails.offeredPrice,
      propertyPrice: property.price,
      status: "pending",
      statusArabic: getStatusArabic("pending"),
      duplicate: false,
    };

  } catch (error) {
    console.error("❌ Failed to create negotiation session:", error);
    return {
      success: false,
      message: "حدث خطأ أثناء تقديم العرض. يرجى المحاولة مرة أخرى.",
    };
  }
}

/**
 * ✅ إنشاء مسودة عقد من خلال الـ AI
 * @param {String} userId - معرف المستخدم
 * @param {String} negotiationId - معرف جلسة التفاوض
 * @returns {Object} - نتيجة إنشاء المسودة
 */
async function createDraftFromAI(userId, negotiationId) {
  if (!userId || !negotiationId) {
    return { success: false, message: "بيانات ناقصة" };
  }

  try {
    // جلب جلسة التفاوض
    const negotiation = await NegotiationSession.findOne({
      _id: negotiationId,
      buyer: userId,
    }).populate("property");

    if (!negotiation) {
      return { success: false, message: "لم يتم العثور على جلسة التفاوض" };
    }

    // التحقق من أن البائع وافق
    if (negotiation.status !== "approved") {
      const statusMessage = {
        pending: "البائع لم يرد بعد على عرضك. انتظر ردّه أولاً.",
        declined: "البائع رفض العرض. حاول تقديم عرض جديد.",
        confirmed: "الصفقة مؤكدة بالفعل! يمكنك متابعة حالة العقد.",
      };
      return {
        success: false,
        message: statusMessage[negotiation.status] || "لا يمكن إنشاء عقد في هذه الحالة.",
        currentStatus: negotiation.status,
      };
    }

    // التحقق من عدم وجود مسودة سابقة
    const existingDraft = await DealDraft.findOne({ negotiation: negotiationId });
    if (existingDraft) {
      return {
        success: true,
        message: "يوجد مسودة عقد بالفعل لهذا التفاوض.",
        draft: existingDraft,
        duplicate: true,
      };
    }

    const property = negotiation.property;

    // حساب جدول الدفع
    const offerType = negotiation?.buyerOffer?.offerType || "installments";
    let schedule = {};
    let agreedPrice = property.price;

    if (offerType === "cash") {
      agreedPrice = negotiation?.buyerOffer?.cashOfferPrice || property.price;
      schedule = {
        downPaymentPercent: 100,
        downPaymentAmount: agreedPrice,
        remainingAmount: 0,
        installmentYears: 0,
        monthlyInstallment: 0,
        paymentType: "cash",
      };
    } else if (offerType === "rent") {
      const monthlyRent = negotiation?.buyerOffer?.rentBudget || property.price;
      const months = negotiation?.buyerOffer?.rentDurationMonths || 12;
      schedule = {
        downPaymentPercent: 0,
        downPaymentAmount: monthlyRent,
        remainingAmount: monthlyRent * months,
        installmentYears: months / 12,
        monthlyInstallment: monthlyRent,
        paymentType: "rent",
      };
    } else {
      const downPercent = negotiation?.buyerOffer?.downPaymentPercent || 10;
      const years = negotiation?.buyerOffer?.installmentYears || 3;
      const downPaymentAmount = Math.round(agreedPrice * (downPercent / 100));
      const remainingAmount = agreedPrice - downPaymentAmount;
      const months = years * 12 || 1;
      schedule = {
        downPaymentPercent: downPercent,
        downPaymentAmount,
        remainingAmount,
        installmentYears: years,
        monthlyInstallment: Math.round(remainingAmount / months),
        paymentType: "installments",
      };
    }

    // إنشاء المسودة
    const draft = await DealDraft.create({
      buyer: userId,
      seller: negotiation.seller,
      property: property._id,
      negotiation: negotiation._id,
      summary: {
        propertyTitle: property.title,
        propertyLocation: `${property.location?.city || ""} ${property.location?.area || ""}`.trim(),
        meetingDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        notes: "تم إنشاء العقد بواسطة المساعد الذكي.",
      },
      price: agreedPrice,
      paymentSchedule: schedule,
    });

    // تحديث حالة التفاوض
    negotiation.status = "draft_requested";
    await negotiation.save();

    console.log(`✅ Draft created via AI: ${draft._id} for negotiation ${negotiationId}`);

    return {
      success: true,
      message: "تم إنشاء مسودة العقد بنجاح! 📄",
      draft,
      propertyTitle: property.title,
      agreedPrice,
      schedule,
    };

  } catch (error) {
    console.error("❌ Failed to create draft from AI:", error);
    return {
      success: false,
      message: "حدث خطأ أثناء إنشاء مسودة العقد.",
    };
  }
}

/**
 * ✅ تأكيد الحجز ودفع العربون من خلال الـ AI
 * @param {String} userId - معرف المستخدم
 * @param {String} draftId - معرف المسودة (أو negotiationId إذا لم توجد مسودة)
 * @param {String} paymentMethod - طريقة الدفع
 * @returns {Object} - نتيجة الحجز
 */
async function confirmReservationFromAI(userId, draftId, paymentMethod = "bank_transfer") {
  if (!userId) {
    return { success: false, message: "يجب تسجيل الدخول أولاً" };
  }

  try {
    let draft = null;

    // إذا تم تمرير draftId
    if (draftId) {
      draft = await DealDraft.findOne({ _id: draftId, buyer: userId })
        .populate("property")
        .populate("seller", "name email phone")
        .populate("buyer", "name email phone");
    }

    // إذا لم نجد المسودة، نبحث عن أحدث مسودة للمستخدم
    if (!draft) {
      draft = await DealDraft.findOne({ buyer: userId, status: "draft" })
        .sort({ createdAt: -1 })
        .populate("property")
        .populate("seller", "name email phone")
        .populate("buyer", "name email phone");
    }

    if (!draft) {
      return {
        success: false,
        message: "لا توجد مسودة عقد جاهزة للحجز. تأكد من موافقة البائع على عرضك أولاً.",
        action: "no_draft_found",
      };
    }

    // إذا كانت محجوزة بالفعل
    if (draft.status === "reserved") {
      return {
        success: true,
        message: `✅ تم الحجز بالفعل على **${draft.property?.title || 'العقار'}**!\n\n` +
          `📅 تاريخ الحجز: ${new Date(draft.reservedAt).toLocaleDateString('ar-EG')}\n` +
          `💰 قيمة العربون: ${draft.reservationPayment?.amount?.toLocaleString() || '—'} جنيه`,
        draft,
        duplicate: true,
      };
    }

    // حساب قيمة العربون
    const paymentSchedule = draft.paymentSchedule || {};
    const downPaymentAmount = paymentSchedule.downPaymentAmount || Math.round((draft.price || 0) * 0.1);

    // إنشاء سجل الدفع
    const paymentRecord = {
      amount: downPaymentAmount,
      method: paymentMethod,
      currency: "EGP",
      reference: `RSV-AI-${Date.now()}`,
      status: "paid",
      paidAt: new Date(),
    };

    // تحديث المسودة
    draft.status = "reserved";
    draft.reservationPayment = paymentRecord;
    draft.reservedAt = paymentRecord.paidAt;

    // إنشاء أو تحديث الصفقة
    let deal = await Deal.findOne({ negotiation: draft.negotiation });
    if (!deal) {
      deal = await Deal.create({
        property: draft.property._id,
        buyer: draft.buyer._id || draft.buyer,
        seller: draft.seller._id || draft.seller,
        negotiation: draft.negotiation,
        offerPrice: draft.price,
        finalPrice: draft.price,
        status: "pending",
        depositPayment: paymentRecord,
      });
    } else {
      deal.depositPayment = paymentRecord;
      deal.status = "pending";
      await deal.save();
    }

    draft.linkedDeal = deal._id;
    await draft.save();

    // تحديث حالة التفاوض
    if (draft.negotiation) {
      await NegotiationSession.findByIdAndUpdate(draft.negotiation, { status: "confirmed" });
    }

    console.log(`✅ Reservation confirmed via AI: ${draft._id}`);

    return {
      success: true,
      message: `🎉 **مبروك! تم الحجز بنجاح!**\n\n` +
        `🏠 العقار: **${draft.property?.title || 'العقار'}**\n` +
        `💰 قيمة العربون: **${downPaymentAmount.toLocaleString()} جنيه**\n` +
        `📅 تاريخ الحجز: **${new Date().toLocaleDateString('ar-EG')}**\n\n` +
        `⏳ الخطوة التالية: التواصل مع البائع لتوقيع العقد النهائي.`,
      draft,
      deal,
      propertyTitle: draft.property?.title,
      downPaymentAmount,
    };

  } catch (error) {
    console.error("❌ Failed to confirm reservation from AI:", error);
    return {
      success: false,
      message: "حدث خطأ أثناء تأكيد الحجز. يرجى المحاولة مرة أخرى.",
    };
  }
}

/**
 * ✅ إلغاء الحجز أو التفاوض من خلال الـ AI
 * @param {String} userId - معرف المستخدم
 * @param {String} targetType - نوع الإلغاء: "negotiation" أو "draft" أو "all"
 * @param {String} targetId - معرف التفاوض أو المسودة (اختياري)
 * @returns {Object} - نتيجة الإلغاء
 */
async function cancelFromAI(userId, targetType = "all", targetId = null) {
  if (!userId) {
    return { success: false, message: "يجب تسجيل الدخول أولاً" };
  }

  try {
    const cancelled = [];
    const warnings = [];

    // إلغاء التفاوضات
    if (targetType === "negotiation" || targetType === "all") {
      const query = { buyer: userId, status: { $in: ["pending", "approved"] } };
      if (targetId && targetType === "negotiation") {
        query._id = targetId;
      }

      const negotiations = await NegotiationSession.find(query).populate("property", "title");

      for (const neg of negotiations) {
        if (neg.status === "approved") {
          // تحذير: البائع وافق
          warnings.push(`⚠️ البائع وافق على عرضك على "${neg.property?.title || 'العقار'}". هل أنت متأكد من الإلغاء؟`);
        }

        neg.status = "declined";
        neg.decisionNotes = "تم إلغاؤه من قبل المشتري عبر المساعد الذكي";
        await neg.save();

        cancelled.push({
          type: "negotiation",
          title: neg.property?.title || "عقار",
          id: neg._id,
        });
      }
    }

    // إلغاء المسودات
    if (targetType === "draft" || targetType === "all") {
      const query = { buyer: userId, status: "draft" };
      if (targetId && targetType === "draft") {
        query._id = targetId;
      }

      const drafts = await DealDraft.find(query).populate("property", "title");

      for (const draft of drafts) {
        draft.status = "cancelled";
        await draft.save();

        cancelled.push({
          type: "draft",
          title: draft.property?.title || draft.summary?.propertyTitle || "عقار",
          id: draft._id,
        });
      }
    }

    if (cancelled.length === 0) {
      return {
        success: true,
        message: "لا توجد تفاوضات أو مسودات نشطة للإلغاء.",
        cancelled: [],
      };
    }

    const cancelledText = cancelled.map(c => `- ${c.title} (${c.type === 'negotiation' ? 'تفاوض' : 'مسودة'})`).join('\n');

    return {
      success: true,
      message: `✅ تم الإلغاء بنجاح!\n\n${cancelledText}` +
        (warnings.length > 0 ? `\n\n${warnings.join('\n')}` : ''),
      cancelled,
      warnings,
    };

  } catch (error) {
    console.error("❌ Failed to cancel from AI:", error);
    return {
      success: false,
      message: "حدث خطأ أثناء الإلغاء. يرجى المحاولة مرة أخرى.",
    };
  }
}

/**
 * Translate status to Arabic
 */
function getStatusArabic(status) {
  const statusMap = {
    pending: "في انتظار رد البائع ⏳",
    approved: "تمت الموافقة ✅",
    declined: "تم الرفض ❌",
    draft_requested: "تم طلب العقد 📄",
    draft_generated: "تم إنشاء العقد 📋",
    draft_sent: "تم إرسال العقد 📨",
    confirmed: "تم التأكيد والحجز 🎉",
  };
  return statusMap[status] || status;
}

/**
 * Format negotiations for AI context
 */
function formatNegotiationsContext(negotiations = []) {
  if (!negotiations.length) return "";

  const lines = ["📋 **جلسات التفاوض النشطة للمستخدم:**"];

  negotiations.forEach((neg, i) => {
    lines.push(`\n${i + 1}. العقار: ${neg.propertyTitle}`);
    lines.push(`   السعر: ${neg.propertyPrice?.toLocaleString() || 'غير محدد'} جنيه`);
    lines.push(`   الحالة: ${neg.statusArabic}`);

    if (neg.status === 'approved') {
      lines.push(`   ✅ البائع وافق على العرض! يمكن للمشتري طلب العقد الآن.`);
    } else if (neg.status === 'declined') {
      lines.push(`   ❌ البائع رفض العرض. السبب: ${neg.decisionNotes || 'غير محدد'}`);
    }

    if (neg.buyerOffer) {
      if (neg.buyerOffer.offerType === 'cash') {
        lines.push(`   عرض المشتري: كاش`);
      } else if (neg.buyerOffer.downPaymentPercent != null) {
        lines.push(`   عرض المشتري: مقدم ${neg.buyerOffer.downPaymentPercent}% وتقسيط ${neg.buyerOffer.installmentYears || '—'} سنوات`);
      }
    }
  });

  return lines.join('\n');
}

/**
 * Get user's deal drafts (contract drafts)
 */
async function getUserDealDrafts(userId) {
  if (!userId) return [];

  try {
    const drafts = await DealDraft.find({ buyer: userId })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate("property", "title price location")
      .lean();

    return drafts.map(draft => ({
      id: draft._id,
      propertyTitle: draft.property?.title || draft.summary?.propertyTitle || "عقار",
      propertyPrice: draft.price || draft.property?.price,
      status: draft.status,
      statusArabic: getDraftStatusArabic(draft.status),
      paymentSchedule: draft.paymentSchedule,
      reservationPayment: draft.reservationPayment,
      reservedAt: draft.reservedAt,
      createdAt: draft.createdAt,
    }));
  } catch (error) {
    console.error("Failed to fetch user deal drafts:", error.message);
    return [];
  }
}

/**
 * Get user's active contracts
 */
async function getUserContracts(userId) {
  if (!userId) return [];

  try {
    const contracts = await Contract.find({ buyer: userId })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate("property", "title price location")
      .lean();

    return contracts.map(contract => ({
      id: contract._id,
      contractNumber: contract.contractNumber,
      propertyTitle: contract.property?.title || "عقار",
      totalPrice: contract.totalPrice,
      status: contract.status,
      statusArabic: getContractStatusArabic(contract.status),
      signed: contract.signed,
      paymentPlan: contract.paymentPlan,
      createdAt: contract.createdAt,
    }));
  } catch (error) {
    console.error("Failed to fetch user contracts:", error.message);
    return [];
  }
}

/**
 * Get user's deals
 */
async function getUserDeals(userId) {
  if (!userId) return [];

  try {
    const deals = await Deal.find({ buyer: userId })
      .sort({ updatedAt: -1 })
      .limit(10)
      .populate("property", "title price location")
      .lean();

    return deals.map(deal => ({
      id: deal._id,
      propertyTitle: deal.property?.title || "عقار",
      offerPrice: deal.offerPrice,
      finalPrice: deal.finalPrice,
      status: deal.status,
      statusArabic: getDealStatusArabic(deal.status),
      createdAt: deal.createdAt,
    }));
  } catch (error) {
    console.error("Failed to fetch user deals:", error.message);
    return [];
  }
}

/**
 * Translate draft status to Arabic
 */
function getDraftStatusArabic(status) {
  const statusMap = {
    draft: "مسودة عقد 📄",
    reserved: "تم الحجز والعربون ✅",
    cancelled: "ملغي ❌",
  };
  return statusMap[status] || status;
}

/**
 * Translate contract status to Arabic
 */
function getContractStatusArabic(status) {
  const statusMap = {
    draft: "عقد مبدئي 📄",
    active: "عقد ساري ✅",
    completed: "عقد مكتمل 🎉",
    cancelled: "عقد ملغي ❌",
  };
  return statusMap[status] || status;
}

/**
 * Translate deal status to Arabic
 */
function getDealStatusArabic(status) {
  const statusMap = {
    pending: "في انتظار قبول البائع ⏳",
    accepted: "تم قبول الصفقة ✅",
    rejected: "تم رفض الصفقة ❌",
    cancelled: "صفقة ملغية ❌",
    closed: "صفقة مكتملة 🎉",
  };
  return statusMap[status] || status;
}

/**
 * Format all user's transaction context for AI
 */
function formatTransactionsContext(negotiations = [], drafts = [], contracts = [], deals = []) {
  const lines = [];

  // Add negotiations
  if (negotiations.length > 0) {
    lines.push("📋 **جلسات التفاوض:**");
    negotiations.forEach((neg, i) => {
      lines.push(`${i + 1}. العقار: ${neg.propertyTitle}`);
      lines.push(`   السعر: ${neg.propertyPrice?.toLocaleString() || 'غير محدد'} جنيه`);
      lines.push(`   الحالة: ${neg.statusArabic}`);

      // ✅ عرض تفاصيل كل حالة بوضوح
      if (neg.status === 'approved') {
        lines.push(`   ✅ البائع وافق! يمكن طلب العقد.`);
      } else if (neg.status === 'declined') {
        lines.push(`   ❌ البائع رفض العرض!`);
        if (neg.decisionNotes) {
          lines.push(`   سبب الرفض: ${neg.decisionNotes}`);
        }
      } else if (neg.status === 'pending') {
        lines.push(`   ⏳ في انتظار رد البائع...`);
      } else if (neg.status === 'confirmed') {
        lines.push(`   🎉 تم تأكيد الصفقة!`);
      }

      if (neg.buyerOffer) {
        // ✅ عرض السعر المعروض بوضوح (يمكن أن يكون في offeredPrice أو cashOfferPrice)
        const offeredPrice = neg.buyerOffer.offeredPrice || neg.buyerOffer.cashOfferPrice;
        if (offeredPrice) {
          lines.push(`   💰 السعر المعروض: ${offeredPrice.toLocaleString()} جنيه`);
        }
        if (neg.buyerOffer.offerType === 'cash') {
          lines.push(`   نوع الدفع: كاش 💵`);
        } else if (neg.buyerOffer.offerType === 'installments' || neg.buyerOffer.downPaymentPercent != null) {
          lines.push(`   نوع الدفع: تقسيط - مقدم ${neg.buyerOffer.downPaymentPercent || 0}% على ${neg.buyerOffer.installmentYears || '—'} سنوات 📊`);
        }
      }
      lines.push("");
    });
  }

  // Add deal drafts
  if (drafts.length > 0) {
    lines.push("\n📑 **مسودات العقود:**");
    drafts.forEach((draft, i) => {
      lines.push(`${i + 1}. العقار: ${draft.propertyTitle}`);
      lines.push(`   السعر: ${draft.propertyPrice?.toLocaleString() || 'غير محدد'} جنيه`);
      lines.push(`   الحالة: ${draft.statusArabic}`);

      if (draft.paymentSchedule) {
        const ps = draft.paymentSchedule;
        if (ps.paymentType === 'cash') {
          lines.push(`   نوع الدفع: كاش`);
        } else {
          lines.push(`   المقدم: ${ps.downPaymentPercent || 0}% (${ps.downPaymentAmount?.toLocaleString() || 0} جنيه)`);
          lines.push(`   التقسيط: ${ps.installmentYears || 0} سنوات - القسط الشهري: ${ps.monthlyInstallment?.toLocaleString() || 0} جنيه`);
        }
      }

      if (draft.status === 'reserved') {
        lines.push(`   ✅ تم دفع العربون: ${draft.reservationPayment?.amount?.toLocaleString() || 0} جنيه`);
        if (draft.reservedAt) {
          lines.push(`   تاريخ الحجز: ${new Date(draft.reservedAt).toLocaleDateString('ar-EG')}`);
        }
      }
      lines.push("");
    });
  }

  // Add deals
  if (deals.length > 0) {
    lines.push("\n🤝 **الصفقات:**");
    deals.forEach((deal, i) => {
      lines.push(`${i + 1}. العقار: ${deal.propertyTitle}`);
      lines.push(`   السعر النهائي: ${deal.finalPrice?.toLocaleString() || deal.offerPrice?.toLocaleString() || 'غير محدد'} جنيه`);
      lines.push(`   الحالة: ${deal.statusArabic}`);
      lines.push("");
    });
  }

  // Add contracts
  if (contracts.length > 0) {
    lines.push("\n📜 **العقود:**");
    contracts.forEach((contract, i) => {
      lines.push(`${i + 1}. العقار: ${contract.propertyTitle}`);
      lines.push(`   رقم العقد: ${contract.contractNumber || contract.id}`);
      lines.push(`   القيمة الإجمالية: ${contract.totalPrice?.toLocaleString() || 'غير محدد'} جنيه`);
      lines.push(`   الحالة: ${contract.statusArabic}`);
      lines.push(`   توقيع المشتري: ${contract.signed?.buyer ? '✅' : '❌'} | توقيع البائع: ${contract.signed?.seller ? '✅' : '❌'}`);
      lines.push("");
    });
  }

  if (lines.length === 0) {
    return "";
  }

  return lines.join('\n');
}

/**
 * معالج خاص لطلبات التوصيات من الأونبوردينج - يستخرج الفلاتر مباشرة ويبحث بدقة
 */
async function handleOnboardingRecommendations(req, res, query, userId) {
  try {
    console.log('📋 Processing onboarding recommendations with filters extraction');

    // استخراج الفلاتر من prompt الأونبوردينج
    const recommendationFilters = {};

    // استخراج الميزانية
    const budgetMatch = query.match(/الحد الأدنى:\s*([\d,]+)\s*جنيه/);
    const maxBudgetMatch = query.match(/الحد الأقصى:\s*([\d,]+)\s*جنيه/);
    if (budgetMatch) {
      recommendationFilters.minPrice = parseInt(budgetMatch[1].replace(/,/g, ''));
    }
    if (maxBudgetMatch) {
      recommendationFilters.maxPrice = parseInt(maxBudgetMatch[1].replace(/,/g, ''));
    }

    // استخراج نوع العقار
    const typeMatch = query.match(/نوع العقار المفضل:\s*([^-\n]+)/);
    if (typeMatch) {
      const types = typeMatch[1].trim().split(/،|,/).map(t => t.trim()).filter(Boolean);
      if (types.length > 0 && types[0] !== 'غير محدد') {
        // تحويل الأنواع العربية إلى الإنجليزية
        const typeMap = {
          'شقة': 'apartment',
          'فيلا': 'villa',
          'منزل': 'house',
          'بيت': 'house',
          'استوديو': 'apartment',
          'دوبلكس': 'house',
          'مكتب': 'project',
          'محل': 'project',
        };
        const mappedTypes = types.map(t => typeMap[t] || t).filter(Boolean);
        if (mappedTypes.length > 0) {
          recommendationFilters.type = mappedTypes[0]; // Use first type for simplicity
        }
      }
    }

    // استخراج الموقع المفضل
    const locationMatch = query.match(/الموقع المفضل داخل مصر:\s*([^-\n]+)/);
    if (locationMatch) {
      const location = locationMatch[1].trim();
      if (location && location !== 'غير محدد') {
        // توسيع القيم لتشمل المرادفات
        recommendationFilters.city = expandCityValues([location]);
      }
    }

    // استخراج عدد غرف النوم
    const bedroomsMatch = query.match(/عدد غرف النوم:\s*(\d+)/);
    if (bedroomsMatch) {
      recommendationFilters.bedrooms = parseInt(bedroomsMatch[1]);
    }

    // استخراج طريقة الدفع
    const paymentMatch = query.match(/طريقة الدفع المفضلة:\s*([^-\n]+)/);
    if (paymentMatch) {
      const payment = paymentMatch[1].trim();
      if (payment.includes('كاش') || payment.includes('نقدي')) {
        recommendationFilters.paymentMethod = 'cash';
      } else if (payment.includes('تقسيط')) {
        recommendationFilters.paymentMethod = 'installments';
      }
    }

    // استخراج حالة المشروع
    const stageMatch = query.match(/حالة المشروع المفضلة:\s*([^-\n]+)/);
    if (stageMatch) {
      const stage = stageMatch[1].trim();
      if (stage.includes('جاهز')) {
        recommendationFilters.status = 'available';
      } else if (stage.includes('تحت الإنشاء')) {
        recommendationFilters.status = 'under_construction';
      }
    }

    console.log('🔍 Extracted onboarding filters:', JSON.stringify(recommendationFilters, null, 2));

    // بناء query لقاعدة البيانات
    const mongoQuery = {};

    // فلتر السعر
    if (recommendationFilters.minPrice || recommendationFilters.maxPrice) {
      mongoQuery.price = {};
      if (recommendationFilters.minPrice) {
        mongoQuery.price.$gte = recommendationFilters.minPrice;
      }
      if (recommendationFilters.maxPrice) {
        mongoQuery.price.$lte = recommendationFilters.maxPrice;
      }
    }

    // فلتر النوع
    if (recommendationFilters.type) {
      mongoQuery.type = recommendationFilters.type;
    }

    // فلتر الموقع
    if (recommendationFilters.city && recommendationFilters.city.length > 0) {
      mongoQuery['location.city'] = {
        $in: recommendationFilters.city.map(c => new RegExp(c, 'i'))
      };
    }

    // فلتر غرف النوم
    if (recommendationFilters.bedrooms) {
      mongoQuery.bedrooms = { $gte: recommendationFilters.bedrooms };
    }

    // فلتر حالة المشروع
    if (recommendationFilters.status) {
      mongoQuery.status = recommendationFilters.status;
    }

    // فلتر طريقة الدفع
    if (recommendationFilters.paymentMethod === 'cash') {
      // نعطي أولوية للعقارات التي لا تتطلب تقسيط
      mongoQuery.$or = [
        { 'paymentOptions.cash': true },
        { 'paymentOptions': { $exists: false } }
      ];
    } else if (recommendationFilters.paymentMethod === 'installments') {
      mongoQuery['paymentOptions.installments'] = true;
    }

    console.log('🔍 MongoDB query:', JSON.stringify(mongoQuery, null, 2));

    // البحث في قاعدة البيانات
    let properties = await Property.find(mongoQuery)
      .select('-embedding')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    console.log(`✅ Found ${properties.length} matching properties`);

    // إذا لم نجد نتائج، نوسع البحث (نزيل فلتر واحد في كل مرة)
    if (properties.length === 0 && Object.keys(mongoQuery).length > 0) {
      console.log('🔄 No results found, trying relaxed search...');

      // حذف فلاتر غير حرجة بالترتيب
      if (mongoQuery.bedrooms) delete mongoQuery.bedrooms;
      if (mongoQuery.status) delete mongoQuery.status;
      if (mongoQuery.$or) delete mongoQuery.$or;

      properties = await Property.find(mongoQuery)
        .select('-embedding')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      console.log(`✅ Relaxed search found ${properties.length} properties`);
    }

    // إذا لا توجد نتائج حتى بعد التوسع، أرجع رسالة
    if (properties.length === 0) {
      return res.json({
        success: true,
        answer: 'عذراً، لم أجد عقارات مطابقة تماماً للمواصفات المطلوبة حالياً. 😔\n\n' +
          'يمكنك تعديل معايير البحث أو استكشاف العقارات المتاحة على الموقع.',
        results: [],
        meta: {
          searchType: 'onboarding-recommendations',
          resultsCount: 0,
          appliedFilters: recommendationFilters,
        }
      });
    }

    // بناء رد مناسب
    const answer = `🎉 وجدت ${properties.length} ${properties.length === 1 ? 'عقار مناسب' : 'عقارات مناسبة'} للمواصفات المطلوبة!\n\n` +
      `✨ تم اختيار هذه العقارات بناءً على:\n` +
      (recommendationFilters.minPrice || recommendationFilters.maxPrice ?
        `💰 الميزانية: ${recommendationFilters.minPrice?.toLocaleString() || '—'} - ${recommendationFilters.maxPrice?.toLocaleString() || '—'} جنيه\n` : '') +
      (recommendationFilters.type ? `🏠 النوع: ${recommendationFilters.type}\n` : '') +
      (recommendationFilters.city ? `📍 الموقع: ${recommendationFilters.city[0]}\n` : '') +
      (recommendationFilters.bedrooms ? `🛏️ الغرف: ${recommendationFilters.bedrooms}+\n` : '') +
      '\nاستمتع باستعراض الخيارات المتاحة! 😊';

    return res.json({
      success: true,
      answer,
      results: properties,
      meta: {
        searchType: 'onboarding-recommendations',
        resultsCount: properties.length,
        appliedFilters: recommendationFilters,
      }
    });

  } catch (error) {
    console.error('❌ Error in handleOnboardingRecommendations:', error);
    return res.status(500).json({
      success: false,
      message: 'حدث خطأ أثناء معالجة طلب التوصيات',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}

/**
 * Detect if user query is asking for property search or general conversation
 * @param {String} query - User's query
 * @returns {Boolean} true if user wants property search
 */
function detectPropertySearchIntent(query = "") {
  const lowerQuery = query.toLowerCase().trim();

  // Very short queries are likely greetings
  if (lowerQuery.length < 3) return false;

  // Check for general conversation keywords
  const hasGeneralKeyword = GENERAL_KEYWORDS.some(keyword =>
    lowerQuery.includes(keyword.toLowerCase())
  );

  // If it's a pure greeting/general query without search keywords, don't search
  if (hasGeneralKeyword && lowerQuery.length < 20) {
    const hasSearchKeyword = SEARCH_INTENT_KEYWORDS.some(keyword =>
      lowerQuery.includes(keyword.toLowerCase())
    );
    if (!hasSearchKeyword) return false;
  }

  // Check for search intent keywords
  const hasSearchIntent = SEARCH_INTENT_KEYWORDS.some(keyword =>
    lowerQuery.includes(keyword.toLowerCase())
  );

  return hasSearchIntent;
}

/**
 * Check if query has enough details to perform a meaningful property search
 * @param {String} query - User's query
 * @param {Object} memorySummary - User's stored preferences
 * @returns {Boolean} true if we have enough info to search
 */
function hasEnoughDetailsToSearch(query = "", memorySummary = "") {
  const lowerQuery = query.toLowerCase();
  const combined = (lowerQuery + " " + (memorySummary || "")).toLowerCase();

  // ✅ نوع العقار كافي للبحث
  const hasPropertyType = /شق[ةه]|فيلا|منزل|بيت|استديو|دوبلكس|أرض|ارض|مكتب|تجاري|عقار|apartment|villa|house|studio|duplex|land|office|property/i.test(combined);

  // Budget indicators
  const hasBudget = /(\d{3,}|مليون|الف|ألف|جنيه|ميزانية|budget|price)/i.test(combined);

  // Location indicators
  const locationKeywords = [
    "القاهرة", "الجيزة", "التجمع", "المعادي", "مدينة نصر", "الزمالك",
    "اكتوبر", "أكتوبر", "الشيخ زايد", "العبور", "الرحاب", "مصر الجديدة",
    "اسوان", "أسوان", "الاسكندرية", "الغردقة", "شرم", "الاقصر",
    "cairo", "giza", "maadi", "zamalek", "october", "new cairo", "aswan", "alexandria"
  ];
  const hasLocation = locationKeywords.some(loc => combined.includes(loc.toLowerCase()));

  // ✅ إذا كان هناك نوع عقار OR موقع OR ميزانية، ابحث
  return hasPropertyType || hasBudget || hasLocation;
}

function normalizeTypes(typeList = []) {
  return typeList
    .map((type) => PROPERTY_TYPE_MAP[type] || null)
    .filter(Boolean);
}

function parseAreaRange(rangeKey) {
  return AREA_RANGE_MAP[rangeKey] || {};
}


function buildPreferenceNarrative(preferences = {}) {
  const parts = [];
  if (preferences.location) {
    parts.push(`عقار في ${preferences.location}`);
  }
  if (preferences.propertyType?.length) {
    parts.push(`من نوع ${preferences.propertyType.join(" أو ")}`);
  }
  if (preferences.bedrooms != null) {
    parts.push(`بعدد غرف لا يقل عن ${preferences.bedrooms}`);
  }
  if (preferences.areaRange) {
    const areaMap = {
      "<100": "مساحة أقل من 100 متر",
      "100-150": "مساحة بين 100 و150 متر",
      "150-200": "مساحة بين 150 و200 متر",
      ">200": "مساحة أكبر من 200 متر",
    };
    parts.push(areaMap[preferences.areaRange]);
  }
  if (preferences.features?.length) {
    parts.push(`يحتوي على مزايا مثل ${preferences.features.join(", ")}`);
  }
  if (preferences.purpose) {
    const purposeMap = {
      residential: "مناسب للسكن",
      investment: "مناسب للاستثمار",
      rent: "مناسب للإيجار",
      quick_resale: "مناسب لإعادة البيع السريع",
    };
    if (purposeMap[preferences.purpose]) {
      parts.push(purposeMap[preferences.purpose]);
    }
  }
  if (preferences.budgetEnabled) {
    if (preferences.budgetMin && preferences.budgetMax) {
      parts.push(`ميزانية بين ${preferences.budgetMin} و ${preferences.budgetMax} جنيه`);
    } else if (preferences.budgetMax) {
      parts.push(`بميزانية لا تتجاوز ${preferences.budgetMax} جنيه`);
    }
  }
  return parts.filter(Boolean).join(" - ") || "عقار مناسب";
}

// Check if OpenAI is configured
const isOpenAIConfigured = () => {
  return process.env.OPENAI_API_KEY &&
    process.env.OPENAI_API_KEY !== 'your-openai-api-key-here' &&
    process.env.OPENAI_API_KEY.startsWith('sk-');
};

// Check if any AI provider is configured
const isAIConfigured = () => {
  return isGeminiConfigured() || isOpenAIConfigured();
};

/**
 * Main AI Query Controller
 * POST /api/ai/query
 * Body: { query: "ابحث عن شقة في دبي مارينا" }
 */
exports.aiQuery = async (req, res) => {
  try {
    const { query, filters, history, source, currentProperties } = req.body;
    const userId = (req.user?.id || req.user?._id || '').toString() || null;
    console.log(`👤 User ID from request: ${userId || 'NOT AUTHENTICATED'}`);
    const { memorySummary, promptHistory } = await buildPromptContext(userId, history);

    // ✅ إضافة العقارات الحالية للسياق (العقارات اللي ظهرت للعميل قبل كده)
    let currentPropertiesContext = "";
    if (currentProperties && currentProperties.length > 0) {
      currentPropertiesContext = "\n📋 **عقارات ظاهرة حالياً للعميل (متاحة ومتحقق منها):**\n" +
        currentProperties.map((p, i) =>
          `${i + 1}. ${p.title || 'عقار'} - ${p.price?.toLocaleString() || '—'} جنيه - ${p.location?.city || ''} - ID: ${p._id}`
        ).join("\n") + "\n**هذه العقارات متاحة فعلاً - لا تحتاج تأكيد توفر!**\n";
      console.log(`📋 Current properties in context: ${currentProperties.length}`);
    }

    // ✅ معالجة خاصة لطلبات التوصيات من الأونبوردينج
    const isOnboardingRecommendations = source === 'onboarding-recommendations' ||
      (query && /لدي عميل يريد ترشيحات عقارية/i.test(query));

    if (isOnboardingRecommendations) {
      console.log('🎯 Onboarding recommendations request detected');
      return await handleOnboardingRecommendations(req, res, query, userId);
    }

    // ✅ معالجة إضافة عقار للبائعين
    const userRole = req.user?.role;
    const isSeller = userRole === 'seller';
    const isAddPropertyIntent = detectAddPropertyIntent(query);
    const inPropertySession = userId && isInPropertyCreationSession(userId);

    console.log(`👤 User role: ${userRole || 'guest'}, isSeller: ${isSeller}, addPropertyIntent: ${isAddPropertyIntent}, inSession: ${inPropertySession}`);

    // إذا كان البائع في جلسة إضافة عقار أو طلب إضافة عقار جديد
    if (isSeller && (isAddPropertyIntent || inPropertySession)) {
      console.log('🏠 Processing seller property creation flow...');

      try {
        const session = getSession(userId);

        // إذا كان طلب بدء جديد (وليس في جلسة نشطة)
        if (isAddPropertyIntent && !inPropertySession) {
          console.log('🆕 Starting new property creation session');
          session.step = STEPS.START;
          const result = session.processResponse(query);
          const nextQuestion = session.getNextQuestion();

          return res.json({
            success: true,
            answer: nextQuestion,
            results: [],
            meta: {
              searchType: 'seller-add-property',
              action: 'property_creation_started',
              step: session.step,
              isPropertyCreation: true,
            },
          });
        }

        // إذا كان في جلسة نشطة، نعالج الرد
        if (inPropertySession) {
          console.log(`📝 Processing step: ${session.step}`);
          const result = session.processResponse(query);

          // إذا فشل التحقق من الصحة
          if (!result.success) {
            return res.json({
              success: true,
              answer: result.message,
              results: [],
              meta: {
                searchType: 'seller-add-property',
                action: 'validation_error',
                step: session.step,
                isPropertyCreation: true,
              },
            });
          }

          // إذا اكتمل جمع البيانات وتم التأكيد
          if (result.isComplete) {
            console.log('✅ Property data complete, creating property...');

            try {
              const mongoose = require('mongoose');

              // إنشاء العقار
              const propertyData = session.getPropertyData();

              // تحويل userId إلى ObjectId
              const sellerObjectId = new mongoose.Types.ObjectId(userId);
              propertyData.seller = sellerObjectId;
              propertyData.addedBy = sellerObjectId;
              propertyData.termsAccepted = true;

              // Ensure at least 5 placeholder images for seller flow
              if (!propertyData.images || propertyData.images.length < 5) {
                propertyData.images = getPlaceholderImages(propertyData.type);
              }

              console.log(`📝 Creating property for seller: ${userId} (ObjectId: ${sellerObjectId})`);
              console.log(`📝 Property data:`, JSON.stringify({
                title: propertyData.title,
                type: propertyData.type,
                location: propertyData.location,
                price: propertyData.price,
                seller: propertyData.seller?.toString(),
              }));

              // إضافة coordinates افتراضية
              if (!propertyData.location.coordinates) {
                propertyData.location.coordinates = {
                  type: 'Point',
                  coordinates: [31.2357, 30.0444], // القاهرة كإحداثيات افتراضية
                };
              }

              const newProperty = new Property(propertyData);

              // Validate before saving
              const validationError = newProperty.validateSync();
              if (validationError) {
                console.error('❌ Validation error:', validationError);
                console.error('❌ Validation details:', JSON.stringify(validationError.errors));
                throw new Error(`Validation failed: ${Object.keys(validationError.errors).join(', ')}`);
              }

              await newProperty.save();

              console.log(`✅ Property created: ${newProperty._id} - ${newProperty.title} - Seller: ${newProperty.seller}`);

              // إرسال إشعار للأدمن
              try {
                const User = require("../../models/userModel");
                const admins = await User.find({ role: "admin" }).select("_id");
                for (const admin of admins) {
                  await createNotification({
                    type: "info",
                    title: "عقار جديد من المساعد الذكي",
                    message: `تمت إضافة عقار جديد بواسطة المساعد الذكي: ${newProperty.title}`,
                    recipient: admin._id,
                    recipientRole: "admin",
                    referenceId: newProperty._id,
                    referenceType: "property",
                  });
                }
              } catch (notifError) {
                console.error("⚠️ Failed to send notification:", notifError.message);
              }

              // حذف الجلسة بعد الإنشاء
              deleteSession(userId);

              const successMessage = `🎉 **تم إضافة العقار بنجاح!**\n\n` +
                `🏠 **${newProperty.title}**\n` +
                `📍 ${newProperty.location.city} - ${newProperty.location.area}\n` +
                `💰 ${Number(newProperty.price).toLocaleString()} جنيه\n\n` +
                `✅ العقار ظاهر دلوقتي في صفحة **"عقاراتي"** في البروفايل.\n\n` +
                `⚠️ **ملحوظة مهمة:** تم إضافة صور افتراضية للعقار. من فضلك روح لصفحة البروفايل وغير الصور بصور حقيقية للعقار.\n\n` +
                `هل تحتاج مساعدة في حاجة تانية؟ 😊`;

              return res.json({
                success: true,
                answer: successMessage,
                results: [newProperty],
                meta: {
                  searchType: 'seller-add-property',
                  action: 'property_created',
                  propertyId: newProperty._id,
                  isPropertyCreation: true,
                },
              });

            } catch (createError) {
              console.error('❌ Failed to create property:', createError);
              console.error('❌ Error stack:', createError.stack);
              if (createError.errors) {
                console.error('❌ Mongoose validation errors:', JSON.stringify(createError.errors, null, 2));
              }
              deleteSession(userId);

              return res.json({
                success: true,
                answer: `⚠️ حدث خطأ أثناء إضافة العقار: ${createError.message}\n\nمن فض لك حاول تاني أو أضف العقار من صفحة البروفايل.`,
                results: [],
                meta: {
                  searchType: 'seller-add-property',
                  action: 'creation_error',
                  error: createError.message,
                  isPropertyCreation: true,
                },
              });
            }
          }

          // إذا كان هناك رسالة مخصصة (مثل إعادة الإدخال)
          if (result.message) {
            return res.json({
              success: true,
              answer: result.message,
              results: [],
              meta: {
                searchType: 'seller-add-property',
                action: 'step_message',
                step: session.step,
                isPropertyCreation: true,
              },
            });
          }

          // الانتقال للسؤال التالي
          const nextQuestion = session.getNextQuestion();

          return res.json({
            success: true,
            answer: nextQuestion,
            results: [],
            meta: {
              searchType: 'seller-add-property',
              action: 'next_step',
              step: session.step,
              isPropertyCreation: true,
            },
          });
        }

      } catch (sessionError) {
        console.error('❌ Session error:', sessionError);
        if (userId) deleteSession(userId);
      }
    }

    // ✅ Handle seller shortcuts
    const lowerQuery = query.toLowerCase();
    const sellerPropertiesIntent = isSeller && (lowerQuery.includes('عقاراتي') || (lowerQuery.includes('اعرض') && lowerQuery.includes('عقار')) || lowerQuery.includes('my properties'));
    const sellerDealsIntent = isSeller && (lowerQuery.includes('العروض') || lowerQuery.includes('عروض') || lowerQuery.includes('deals') || lowerQuery.includes('offers'));

    // ✅ Handle "عقاراتي" request for sellers (text chat)
    if (sellerPropertiesIntent) {
      console.log('📋 Seller requesting their properties (text chat)');
      
      try {
        const properties = await Property.find({ seller: userId })
          .sort({ createdAt: -1 })
          .limit(20);
        
        if (properties.length === 0) {
          return res.json({
            success: true,
            answer: '📭 **ليس لديك أي عقارات حتى الآن.**\n\n' +
              '💡 يمكنك إضافة عقار جديد بقول "أضف عقار" أو من صفحة البروفايل. 😊',
            results: [],
            meta: {
              searchType: 'seller-properties',
              action: 'no_properties',
            },
          });
        }
        
        const propertyList = properties.map((p, i) => {
          const status = p.listingStatus === 'available' ? '✅ متاح' : 
                        p.listingStatus === 'sold' ? '❌ تم البيع' : 
                        p.listingStatus === 'rented' ? '🏠 تم التأجير' : '⏸️ غير متاح';
          return `${i + 1}. **${p.title}**\n` +
                 `   📍 ${p.location?.city || ''} - ${p.location?.area || ''}\n` +
                 `   💰 ${p.price?.toLocaleString() || ''} جنيه\n` +
                 `   📏 ${p.area || ''} م²\n` +
                 `   ${status}`;
        }).join('\n\n');
        
        const answer = `🏠 **عقاراتك (${properties.length} عقار):**\n\n${propertyList}\n\n` +
          `💡 لتعديل أو حذف عقار، توجه لصفحة **"عقاراتي"** في البروفايل.`;
        
        return res.json({
          success: true,
          answer,
          results: properties,
          meta: {
            searchType: 'seller-properties',
            action: 'properties_listed',
            count: properties.length,
          },
        });
      } catch (error) {
        console.error('❌ Error fetching seller properties:', error);
        return res.json({
          success: true,
          answer: '⚠️ حدث خطأ في جلب عقاراتك. من فضلك حاول مرة أخرى.',
          results: [],
          meta: {
            searchType: 'seller-properties',
            action: 'error',
          },
        });
      }
    }

    // ✅ Handle "العروض الواردة" request for sellers (text chat)
    if (sellerDealsIntent) {
      console.log('💰 Seller requesting their deals/offers (text chat)');
      
      try {
        // أولاً: جلب عقارات البائع
        const properties = await Property.find({ seller: userId }).select('_id title');
        const propertyIds = properties.map(p => p._id);
        
        if (propertyIds.length === 0) {
          return res.json({
            success: true,
            answer: '📭 **ليس لديك أي عقارات بعد.**\n\n' +
              '💡 أضف عقار أولاً عشان تستقبل عروض عليه! 😊',
            results: [],
            meta: {
              searchType: 'seller-deals',
              action: 'no_properties',
            },
          });
        }
        
        // ثانياً: جلب المفاوضات (العروض) على عقارات البائع من NegotiationSession
        const negotiations = await NegotiationSession.find({ 
          property: { $in: propertyIds }
        })
          .populate('property', 'title location.city price')
          .populate('buyer', 'username email phone')
          .sort({ createdAt: -1 })
          .limit(20);
        
        // ثالثاً: جلب الـ deals أيضاً
        const deals = await Deal.find({ property: { $in: propertyIds } })
          .populate('property', 'title location.city price')
          .populate('buyer', 'username email phone')
          .sort({ createdAt: -1 })
          .limit(20);
        
        // دمج النتائج
        const allOffers = [];
        
        // إضافة المفاوضات
        negotiations.forEach(n => {
          allOffers.push({
            type: 'negotiation',
            id: n._id,
            propertyTitle: n.property?.title || n.propertySnapshot?.title || 'عقار',
            propertyCity: n.property?.location?.city || n.propertySnapshot?.location?.city || '',
            propertyPrice: n.property?.price || n.propertySnapshot?.price || 0,
            clientName: n.buyer?.username || 'مشتري',
            clientEmail: n.buyer?.email || '',
            clientPhone: n.buyer?.phone || '',
            offerPrice: n.buyerOffer?.cashOfferPrice || n.buyerOffer?.offeredPrice || 0,
            offerType: n.intentType || n.buyerOffer?.offerType || 'cash',
            status: n.status,
            createdAt: n.createdAt,
          });
        });
        
        // إضافة الـ deals
        deals.forEach(d => {
          // تجنب التكرار إذا كان الـ deal مرتبط بـ negotiation موجود
          if (!allOffers.find(o => o.id.toString() === d.negotiation?.toString())) {
            allOffers.push({
              type: 'deal',
              id: d._id,
              propertyTitle: d.property?.title || 'عقار',
              propertyCity: d.property?.location?.city || '',
              propertyPrice: d.property?.price || 0,
              clientName: d.buyer?.username || 'مشتري',
              clientEmail: d.buyer?.email || '',
              clientPhone: d.buyer?.phone || '',
              offerPrice: d.offerPrice || d.finalPrice || 0,
              offerType: 'deal',
              status: d.status,
              createdAt: d.createdAt,
            });
          }
        });
        
        if (allOffers.length === 0) {
          return res.json({
            success: true,
            answer: '📭 **ليس لديك أي عروض حتى الآن.**\n\n' +
              `✅ لديك ${properties.length} عقار منشور. انتظر حتى يقدم المشترين عروضهم! 🏠`,
            results: [],
            meta: {
              searchType: 'seller-deals',
              action: 'no_deals',
              propertiesCount: properties.length,
            },
          });
        }
        
        // ترتيب حسب التاريخ
        allOffers.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        
        const getStatusArabic = (status) => {
          const statusMap = {
            'pending': '⏳ في الانتظار',
            'approved': '✅ موافق عليه',
            'declined': '❌ مرفوض',
            'accepted': '✅ مقبول',
            'rejected': '❌ مرفوض',
            'completed': '🎉 مكتمل',
            'cancelled': '🚫 ملغي',
            'draft_requested': '📝 طلب عقد',
            'draft_generated': '📄 تم إنشاء العقد',
            'draft_sent': '📤 تم إرسال العقد',
            'confirmed': '✅ تم التأكيد',
            'closed': '🔒 مغلق',
          };
          return statusMap[status] || `📋 ${status}`;
        };
        
        const getOfferTypeArabic = (type) => {
          const typeMap = {
            'cash': '💵 كاش',
            'installments': '📅 تقسيط',
            'rent': '🏠 إيجار',
            'deal': '🤝 صفقة',
            'negotiation': '💬 تفاوض',
          };
          return typeMap[type] || type;
        };
        
        const offersList = allOffers.map((o, i) => {
          const date = o.createdAt ? new Date(o.createdAt).toLocaleDateString('ar-EG') : '';
          
          return `${i + 1}. **${o.propertyTitle}** (${o.propertyCity || 'غير محدد'})\n` +
                 `   👤 المشتري: ${o.clientName}\n` +
                 `   💰 العرض: ${o.offerPrice?.toLocaleString() || 'غير محدد'} جنيه ${getOfferTypeArabic(o.offerType)}\n` +
                 `   💵 السعر الأصلي: ${o.propertyPrice?.toLocaleString() || '—'} جنيه\n` +
                 `   📅 التاريخ: ${date}\n` +
                 `   ${getStatusArabic(o.status)}`;
        }).join('\n\n');
        
        const answer = `💼 **العروض الواردة على عقاراتك (${allOffers.length} عرض):**\n\n${offersList}\n\n` +
          `💡 للرد على العروض، توجه لصفحة **"العروض"** أو **"المفاوضات"** في البروفايل.`;
        
        return res.json({
          success: true,
          answer,
          results: allOffers,
          meta: {
            searchType: 'seller-deals',
            action: 'deals_listed',
            count: allOffers.length,
            negotiationsCount: negotiations.length,
            dealsCount: deals.length,
          },
        });
      } catch (error) {
        console.error('❌ Error fetching seller deals:', error);
        return res.json({
          success: true,
          answer: '⚠️ حدث خطأ في جلب العروض. من فضلك حاول مرة أخرى.',
          results: [],
          meta: {
            searchType: 'seller-deals',
            action: 'error',
          },
        });
      }
    }

    // ✅ استخراج الفلاتر من كامل سياق المحادثة
    const conversationFilters = extractFiltersFromConversation(promptHistory, query, memorySummary);

    // دمج الفلاتر المرسلة مع المستخرجة (المرسلة لها الأولوية)
    const mergedFilters = { ...conversationFilters, ...buildNormalizedFilters(filters || {}, query) };
    const hasFilters = mergedFilters && Object.keys(mergedFilters).length > 0;

    // ✅ بناء نص بحث موسع يشمل سياق المحادثة
    const enhancedQuery = buildEnhancedSearchQuery(query, mergedFilters);

    // Validate input
    if (!query || typeof query !== "string" || query.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Query is required and must be a non-empty string",
      });
    }

    console.log(`🔍 AI Query received: "${query}"`);
    console.log(`🔍 Enhanced query: "${enhancedQuery}"`);
    console.log(`📊 Merged filters:`, JSON.stringify(mergedFilters));
    console.log(`📊 Vector store size: ${require('../services/embeddings.service').vectorStore.embeddings.length}`);

    // Check if AI is configured (Gemini or OpenAI)
    let useAI = isAIConfigured();

    if (!useAI) {
      console.log("⚠️  Running without AI (No API key configured)");
    } else if (isGeminiConfigured()) {
      console.log("✅ Using Google Gemini AI");
    } else {
      console.log("✅ Using OpenAI");
    }

    // Check for negotiation status inquiry
    const isAskingAboutNegotiation = sellerDealsIntent ? false : detectNegotiationStatusIntent(query);
    const isAskingAboutTransactions = detectTransactionStatusIntent(query);
    const isAskingOfferDetails = detectOfferDetailsInquiry(query);
    let negotiationsContext = "";
    let retrievedProperties = [];

    // ✅ كشف طلب تعديل عرض التفاوض
    const offerModification = detectOfferModificationIntent(query);

    // ✅ كشف عرض سعر جديد على عقار (مع البحث في سياق المحادثة)
    const priceOffer = detectPriceOfferIntent(query, promptHistory);

    // ✅ كشف عرض إيجار
    const rentalOffer = detectRentalOfferIntent(query, promptHistory);

    // ✅ كشف نية التفاوض (بدون سعر بالضرورة)
    const negotiationRequest = detectNegotiationRequestIntent(query);

    console.log(`🔍 Negotiation inquiry detected: ${isAskingAboutNegotiation ? 'YES' : 'NO'}, userId: ${userId || 'none'}`);
    console.log(`🔍 Transaction inquiry detected: ${isAskingAboutTransactions ? 'YES' : 'NO'}`);
    console.log(`🔍 Offer details inquiry detected: ${isAskingOfferDetails ? 'YES' : 'NO'}`);
    console.log(`🔄 Offer modification detected: ${offerModification ? JSON.stringify(offerModification) : 'NO'}`);
    console.log(`💰 Price offer detected: ${priceOffer ? JSON.stringify(priceOffer) : 'NO'}`);
    console.log(`🏠 Rental offer detected: ${rentalOffer ? JSON.stringify(rentalOffer) : 'NO'}`);
    console.log(`🤝 Negotiation request detected: ${negotiationRequest ? JSON.stringify(negotiationRequest) : 'NO'}`);

    // ✅ كشف نية الحجز / الإلغاء / المتابعة
    const reservationIntent = detectReservationIntent(query);
    console.log(`🎫 Reservation intent detected: ${reservationIntent ? JSON.stringify(reservationIntent) : 'NO'}`);

    // ✅ معالجة نوايا الحجز / الإلغاء / المتابعة (أولوية قصوى)
    if (reservationIntent && userId) {
      console.log(`🎯 Processing reservation intent: ${reservationIntent.action}`);

      // جلب التفاوضات والمسودات النشطة
      const negotiations = await getUserNegotiations(userId);
      const drafts = await getUserDealDrafts(userId);

      // البحث عن جلسة موافق عليها أو مسودة نشطة
      const approvedNegotiation = negotiations.find(n => n.status === 'approved');
      const pendingNegotiation = negotiations.find(n => n.status === 'pending');
      const activeDraft = drafts.find(d => d.status === 'draft');
      const reservedDraft = drafts.find(d => d.status === 'reserved');

      // =============================
      // 1. طلب الحجز / دفع العربون
      // =============================
      if (reservationIntent.action === "request_reservation") {
        // حالة 1: يوجد حجز سابق
        if (reservedDraft) {
          return res.json({
            success: true,
            answer: `✅ **حضرتك حجزت بالفعل!**\n\n` +
              `🏠 العقار: **${reservedDraft.propertyTitle || 'العقار'}**\n` +
              `💰 قيمة العربون: **${reservedDraft.reservationPayment?.amount?.toLocaleString() || '—'} جنيه**\n` +
              `📅 تاريخ الحجز: **${reservedDraft.reservedAt ? new Date(reservedDraft.reservedAt).toLocaleDateString('ar-EG') : '—'}**\n\n` +
              `⏳ الصفقة في مرحلة التنفيذ. هل تحتاج مساعدة في شيء تاني؟ 😊`,
            results: [],
            meta: {
              searchType: "reservation-already-exists",
              action: "already_reserved",
              draftId: reservedDraft.id,
            },
          });
        }

        // حالة 2: يوجد مسودة جاهزة للحجز
        if (activeDraft) {
          const reservationResult = await confirmReservationFromAI(userId, activeDraft.id);

          return res.json({
            success: true,
            answer: reservationResult.message,
            results: [],
            meta: {
              searchType: "reservation-confirmed",
              action: reservationResult.success ? "reservation_completed" : "reservation_failed",
              draftId: activeDraft.id,
            },
          });
        }

        // حالة 3: البائع وافق على العرض - يمكن إنشاء مسودة ثم الحجز
        if (approvedNegotiation) {
          // إنشاء مسودة أولاً
          const draftResult = await createDraftFromAI(userId, approvedNegotiation.id);

          if (draftResult.success && draftResult.draft) {
            // ثم تأكيد الحجز
            const reservationResult = await confirmReservationFromAI(userId, draftResult.draft._id);

            return res.json({
              success: true,
              answer: `🎉 **مبروك!** البائع وافق على عرضك!\n\n${reservationResult.message}`,
              results: [],
              meta: {
                searchType: "negotiation-to-reservation",
                action: reservationResult.success ? "reservation_completed" : "draft_created",
                negotiationId: approvedNegotiation.id,
                draftId: draftResult.draft._id,
              },
            });
          } else {
            return res.json({
              success: true,
              answer: `✅ البائع وافق على عرضك على **${approvedNegotiation.propertyTitle}**!\n\n` +
                `${draftResult.message}\n\n` +
                `💡 للحجز: توجه لصفحة "العقود" في حسابك واضغط "تأكيد الحجز".`,
              results: [],
              meta: {
                searchType: "approved-negotiation",
                action: "need_manual_draft",
                negotiationId: approvedNegotiation.id,
              },
            });
          }
        }

        // حالة 4: يوجد تفاوض في انتظار الرد
        if (pendingNegotiation) {
          return res.json({
            success: true,
            answer: `⏳ **عرضك على "${pendingNegotiation.propertyTitle}" لسه في انتظار رد البائع.**\n\n` +
              `💰 السعر المعروض: **${pendingNegotiation.buyerOffer?.cashOfferPrice?.toLocaleString() || pendingNegotiation.buyerOffer?.offeredPrice?.toLocaleString() || '—'} جنيه**\n\n` +
              `📌 لما البائع يوافق، هتقدر تحجز مباشرة!\n\n` +
              `هل تحتاج مساعدة في شيء تاني؟ 😊`,
            results: [],
            meta: {
              searchType: "pending-negotiation",
              action: "waiting_seller_response",
              negotiationId: pendingNegotiation.id,
            },
          });
        }

        // حالة 5: لا يوجد تفاوض أو مسودة
        return res.json({
          success: true,
          answer: `🤔 **مش لاقي عرض موافق عليه عندك حالياً.**\n\n` +
            `عشان تحجز عقار، لازم الأول:\n` +
            `1️⃣ تبحث عن العقار المناسب\n` +
            `2️⃣ تقدم عرض سعر للبائع\n` +
            `3️⃣ تنتظر موافقة البائع\n` +
            `4️⃣ بعد الموافقة، تقدر تحجز وتدفع العربون\n\n` +
            `💡 قولي "ابحثلي عن شقة في [المنطقة]" وأنا هساعدك تلاقي العقار المناسب! 🏠`,
          results: [],
          meta: {
            searchType: "no-active-process",
            action: "need_to_start_search",
          },
        });
      }

      // =============================
      // 2. طلب الإلغاء
      // =============================
      if (reservationIntent.action === "cancel_reservation_or_deal") {
        // التحقق من وجود شيء للإلغاء
        const hasActiveDraft = !!activeDraft;
        const hasActiveNegotiation = !!(approvedNegotiation || pendingNegotiation);
        const hasReservedDraft = !!reservedDraft;

        if (hasReservedDraft) {
          // تحذير: الحجز تم بالفعل
          return res.json({
            success: true,
            answer: `⚠️ **انتبه!** حضرتك دفعت عربون بالفعل على **${reservedDraft.propertyTitle}**.\n\n` +
              `❌ **إلغاء الحجز بعد دفع العربون ممكن يخليك تخسر العربون!**\n\n` +
              `💡 لو متأكد من الإلغاء، تواصل مع البائع مباشرة أو راجع شروط الإلغاء في العقد.\n\n` +
              `هل تحتاج مساعدة في شيء تاني؟ 🤔`,
            results: [],
            meta: {
              searchType: "cancel-reserved-warning",
              action: "cannot_auto_cancel_reserved",
              draftId: reservedDraft.id,
            },
          });
        }

        if (hasActiveDraft || hasActiveNegotiation) {
          const cancelResult = await cancelFromAI(userId, "all");

          return res.json({
            success: true,
            answer: cancelResult.message + `\n\nهل تحتاج مساعدة في شيء تاني؟ 😊`,
            results: [],
            meta: {
              searchType: "cancellation",
              action: cancelResult.success ? "cancelled" : "cancel_failed",
              cancelled: cancelResult.cancelled,
            },
          });
        }

        return res.json({
          success: true,
          answer: `🤔 مش لاقي عندك تفاوضات أو مسودات نشطة للإلغاء.\n\n` +
            `هل تحتاج مساعدة في شيء تاني؟ 😊`,
          results: [],
          meta: {
            searchType: "nothing-to-cancel",
            action: "no_active_items",
          },
        });
      }

      // =============================
      // 3. طلب إنشاء مسودة عقد
      // =============================
      if (reservationIntent.action === "request_draft_contract") {
        if (activeDraft) {
          return res.json({
            success: true,
            answer: `📄 **عندك مسودة عقد جاهزة بالفعل!**\n\n` +
              `🏠 العقار: **${activeDraft.propertyTitle}**\n` +
              `💰 السعر: **${activeDraft.propertyPrice?.toLocaleString() || '—'} جنيه**\n\n` +
              `💡 قول "احجز" عشان تدفع العربون وتأكد الحجز! 🎉`,
            results: [],
            meta: {
              searchType: "draft-exists",
              action: "draft_already_exists",
              draftId: activeDraft.id,
            },
          });
        }

        if (approvedNegotiation) {
          const draftResult = await createDraftFromAI(userId, approvedNegotiation.id);

          return res.json({
            success: true,
            answer: draftResult.success
              ? `✅ ${draftResult.message}\n\n` +
              `🏠 العقار: **${draftResult.propertyTitle}**\n` +
              `💰 السعر المتفق عليه: **${draftResult.agreedPrice?.toLocaleString() || '—'} جنيه**\n\n` +
              `💡 الخطوة التالية: قول "احجز" عشان تدفع العربون وتأكد الحجز! 🎉`
              : `⚠️ ${draftResult.message}`,
            results: [],
            meta: {
              searchType: "draft-creation",
              action: draftResult.success ? "draft_created" : "draft_failed",
              negotiationId: approvedNegotiation.id,
            },
          });
        }

        if (pendingNegotiation) {
          return res.json({
            success: true,
            answer: `⏳ **لازم البائع يوافق على عرضك الأول!**\n\n` +
              `📌 عرضك على **${pendingNegotiation.propertyTitle}** لسه في انتظار رد البائع.\n\n` +
              `لما يوافق، هتقدر تنشئ العقد وتحجز! 😊`,
            results: [],
            meta: {
              searchType: "draft-needs-approval",
              action: "waiting_approval",
              negotiationId: pendingNegotiation.id,
            },
          });
        }

        return res.json({
          success: true,
          answer: `🤔 **مش لاقي عرض موافق عليه عندك.**\n\n` +
            `عشان تنشئ عقد، لازم الأول تقدم عرض على عقار والبائع يوافق.\n\n` +
            `💡 قولي "ابحثلي عن [نوع العقار] في [المنطقة]" وأنا هساعدك! 🏠`,
          results: [],
          meta: {
            searchType: "no-approved-negotiation",
            action: "need_negotiation_first",
          },
        });
      }

      // =============================
      // 4. طلب الاستكمال / المتابعة
      // =============================
      if (reservationIntent.action === "continue_process") {
        // نحدد أنسب خطوة للمستخدم
        if (reservedDraft) {
          return res.json({
            success: true,
            answer: `✅ **صفقتك في مرحلة التنفيذ!**\n\n` +
              `🏠 العقار: **${reservedDraft.propertyTitle}**\n` +
              `📅 تاريخ الحجز: **${reservedDraft.reservedAt ? new Date(reservedDraft.reservedAt).toLocaleDateString('ar-EG') : '—'}**\n\n` +
              `⏳ الخطوة التالية: التواصل مع البائع لتوقيع العقد النهائي.\n\n` +
              `هل تحتاج مساعدة في شيء تاني؟ 😊`,
            results: [],
            meta: {
              searchType: "continue-reserved",
              action: "in_execution",
              draftId: reservedDraft.id,
            },
          });
        }

        if (activeDraft) {
          return res.json({
            success: true,
            answer: `📄 **عندك مسودة عقد جاهزة!**\n\n` +
              `🏠 العقار: **${activeDraft.propertyTitle}**\n` +
              `💰 السعر: **${activeDraft.propertyPrice?.toLocaleString() || '—'} جنيه**\n\n` +
              `💡 قول **"احجز"** عشان تدفع العربون وتأكد الحجز! 🎉`,
            results: [],
            meta: {
              searchType: "continue-draft",
              action: "ready_to_reserve",
              draftId: activeDraft.id,
            },
          });
        }

        if (approvedNegotiation) {
          return res.json({
            success: true,
            answer: `✅ **البائع وافق على عرضك!**\n\n` +
              `🏠 العقار: **${approvedNegotiation.propertyTitle}**\n` +
              `💰 السعر: **${approvedNegotiation.propertyPrice?.toLocaleString() || '—'} جنيه**\n\n` +
              `💡 قول **"اعمل عقد"** عشان ننشئ مسودة العقد، أو **"احجز"** مباشرة! 🎉`,
            results: [],
            meta: {
              searchType: "continue-approved",
              action: "ready_to_create_draft",
              negotiationId: approvedNegotiation.id,
            },
          });
        }

        if (pendingNegotiation) {
          return res.json({
            success: true,
            answer: `⏳ **عرضك في انتظار رد البائع!**\n\n` +
              `🏠 العقار: **${pendingNegotiation.propertyTitle}**\n` +
              `💰 السعر المعروض: **${pendingNegotiation.buyerOffer?.cashOfferPrice?.toLocaleString() || '—'} جنيه**\n\n` +
              `📌 هنبلغك فور ما البائع يرد!\n\n` +
              `هل تحتاج مساعدة في شيء تاني؟ 😊`,
            results: [],
            meta: {
              searchType: "continue-pending",
              action: "waiting_response",
              negotiationId: pendingNegotiation.id,
            },
          });
        }

        return res.json({
          success: true,
          answer: `🤔 **مش لاقي عندك صفقات نشطة للمتابعة.**\n\n` +
            `💡 تحب نبدأ ندور على عقار مناسب؟ قولي:\n` +
            `"ابحثلي عن شقة في القاهرة" أو "عايز فيلا في الشيخ زايد" 🏠`,
          results: [],
          meta: {
            searchType: "nothing-to-continue",
            action: "start_fresh",
          },
        });
      }
    }

    // ✅ معالجة طلب التفاوض على عقار (مع إنشاء جلسة فعلية) - لكن ليس إذا كان عرض إيجار
    if (negotiationRequest && userId && !priceOffer && !rentalOffer) {
      console.log("🤝 Processing negotiation request...");

      // البحث عن العقار المطلوب
      let targetProperty = null;

      if (negotiationRequest.propertyName) {
        console.log(`🔍 Searching for property: "${negotiationRequest.propertyName}"`);

        // البحث بالاسم
        targetProperty = await Property.findOne({
          $or: [
            { title: new RegExp(negotiationRequest.propertyName.replace(/\s+/g, '.*'), 'i') },
            { 'location.city': new RegExp(negotiationRequest.propertyName, 'i') },
            { 'location.area': new RegExp(negotiationRequest.propertyName, 'i') },
            { projectName: new RegExp(negotiationRequest.propertyName, 'i') },
          ]
        }).lean();

        console.log(`🔍 Property search result: ${targetProperty ? 'FOUND - ' + targetProperty.title : 'NOT FOUND'}`);
      }

      // fallback: use single retrieved property from this turn
      if (!targetProperty && retrievedProperties && retrievedProperties.length === 1) {
        targetProperty = retrievedProperties[0];
        console.log(`✅ Using single retrieved property for negotiation: ${targetProperty.title}`);
      }

      if (!targetProperty) {
        return res.json({
          success: true,
          answer: `عذراً، مش قادر أحدد العقار اللي حضرتك عايز تتفاوض عليه بالظبط. 🤔\n\n` +
            `ممكن توضح اسم العقار أو تبحث عنه الأول وتقولي اسمه؟ 🔍`,
          results: [],
          meta: {
            searchType: "negotiation-property-not-found",
            resultsCount: 0,
            hasFilters: false,
            action: "need_property_clarification",
          },
        });
      }

      // ✅ التحقق: هل ده مشروع مطور عقاري؟
      const isDeveloperProperty = !!(targetProperty.developer || targetProperty.projectName);

      if (isDeveloperProperty) {
        return res.json({
          success: true,
          answer: `🏢 **${targetProperty.title || targetProperty.projectName}** ده مشروع تابع لمطور عقاري.\n\n` +
            `💰 السعر: **${targetProperty.price?.toLocaleString() || '—'} جنيه**\n\n` +
            `⚠️ **مشاريع المطورين العقاريين أسعارها ثابتة ومفيش تفاوض!**\n\n` +
            `✅ لو حضرتك عايز تشتري، ممكن تحجز الوحدة مباشرة.\n\n` +
            `هل تحب أساعدك في الحجز أو أعرض عليك عقارات تانية من بائعين عاديين تقدر تتفاوض عليها؟ 🏠`,
          results: [targetProperty],
          meta: {
            searchType: "developer-property",
            resultsCount: 1,
            hasFilters: false,
            action: "no_negotiation_developer",
            isDeveloperProperty: true,
          },
        });
      }

      // ✅ لو عندنا سعر ونوع دفع، ننشئ التفاوض مباشرة
      if (negotiationRequest.hasPrice && negotiationRequest.offerType) {
        const offerDetails = {
          offeredPrice: negotiationRequest.offeredPrice,
          offerType: negotiationRequest.offerType,
        };

        const offerResult = await createNegotiationFromAI(userId, targetProperty._id, offerDetails);

        if (offerResult.success) {
          return res.json({
            success: true,
            answer: `تمام يا فندم! 🤩 تم تقديم عرض **${negotiationRequest.offeredPrice.toLocaleString()} جنيه ${negotiationRequest.offerType === 'cash' ? 'كاش' : 'تقسيط'}** على **${targetProperty.title}**.\n\n` +
              `✅ تم إرسال العرض للبائع! ⏳ هننتظر رده وهبلغ حضرتك فوراً.\n\n` +
              `هل تحتاج مساعدة في أي شيء آخر؟ 😊`,
            results: [targetProperty],
            meta: {
              searchType: "negotiation-created",
              resultsCount: 1,
              hasFilters: false,
              action: "offer_submitted",
              offerDetails: offerResult,
            },
          });
        }
      }

      // ✅ لو مفيش سعر أو نوع دفع، نسأل المستخدم
      let missingInfo = [];
      if (!negotiationRequest.offerType) missingInfo.push("نوع الدفع (كاش/تقسيط/إيجار)");
      if (!negotiationRequest.hasPrice) missingInfo.push("السعر المقترح");

      return res.json({
        success: true,
        answer: `تمام يا فندم! 👍 عشان أبدأ التفاوض على **${targetProperty.title}** (السعر المعلن: ${targetProperty.price?.toLocaleString() || '—'} جنيه)، محتاج أعرف:\n\n` +
          `❓ ${missingInfo.join('\n❓ ')}\n\n` +
          `لما تقولي التفاصيل دي، هقدم العرض للبائع مباشرة! 🤝`,
        results: [targetProperty],
        meta: {
          searchType: "negotiation-needs-details",
          resultsCount: 1,
          hasFilters: false,
          action: "need_offer_details",
          propertyId: targetProperty._id,
          propertyTitle: targetProperty.title,
          propertyPrice: targetProperty.price,
        },
      });
    };

    // ✅ معالجة سؤال متابعة عن تفاصيل العرض
    if (isAskingOfferDetails && userId) {
      console.log("📋 Processing offer details inquiry...");

      // جلب التفاوضات الحالية للمستخدم
      const negotiations = await getUserNegotiations(userId);

      if (negotiations.length > 0) {
        // بناء رد تفصيلي بكل العروض
        let detailsResponse = "📋 **تفاصيل عروضك الحالية:**\n\n";

        negotiations.forEach((neg, i) => {
          // ✅ السعر المعروض يمكن أن يكون في offeredPrice أو cashOfferPrice
          const offeredPrice = neg.buyerOffer?.offeredPrice || neg.buyerOffer?.cashOfferPrice;

          detailsResponse += `**${i + 1}. ${neg.propertyTitle}**\n`;
          detailsResponse += `   💰 السعر المعروض: ${offeredPrice?.toLocaleString() || '—'} جنيه\n`;
          detailsResponse += `   🏷️ سعر العقار الأصلي: ${neg.propertyPrice?.toLocaleString() || '—'} جنيه\n`;

          if (neg.buyerOffer?.offerType === 'cash') {
            detailsResponse += `   💵 نوع الدفع: كاش\n`;
          } else if (neg.buyerOffer?.offerType === 'installments') {
            detailsResponse += `   📊 نوع الدفع: تقسيط - مقدم ${neg.buyerOffer?.downPaymentPercent || 0}% على ${neg.buyerOffer?.installmentYears || '—'} سنوات\n`;
          }

          detailsResponse += `   📌 الحالة: ${neg.statusArabic}\n\n`;
        });

        detailsResponse += "هل تحتاج مساعدة في أي شيء تاني؟ 😊";

        return res.json({
          success: true,
          answer: detailsResponse,
          results: [],
          meta: {
            searchType: "offer-details-inquiry",
            resultsCount: 0,
            hasFilters: false,
            action: "show_offer_details",
            negotiationsCount: negotiations.length,
          },
        });
      } else {
        return res.json({
          success: true,
          answer: "مش لاقي عندك عروض تفاوض حالية. 🤔\n\nلو عايز تتفاوض على عقار، ابحث عنه الأول وقولي 'عايز أتفاوض عليه'! 🏠",
          results: [],
          meta: {
            searchType: "offer-details-inquiry",
            resultsCount: 0,
            hasFilters: false,
            action: "no_offers_found",
          },
        });
      }
    };

    // ✅ تقديم عرض سعر على عقار (نتجاهل لو عندنا عرض إيجار منفصل لتجنب الازدواج)
    if (priceOffer && !rentalOffer) {
      console.log(`✅ Entering price offer block: userId=${userId || 'NULL'}, rentalOffer=${rentalOffer ? 'YES' : 'NO'}`);

      if (!userId) {
        console.log("❌ Price offer detected but no userId - user not logged in");
        return res.json({
          success: false,
          answer: "عشان تقدم عرض على العقار، لازم تسجل الدخول الأول! 🔐\n\nسجل دخول وارجع تاني. 😊",
          results: [],
          meta: {
            searchType: "offer-requires-login",
            action: "login_required",
          },
        });
      }

      console.log("💵 Processing price offer request...");

      // البحث عن العقار المذكور في السياق أو في آخر نتائج البحث
      let targetProperty = null;

      // محاولة استخراج اسم/وصف العقار من النص
      const propertyNamePatterns = [
        // "أعرض 2 مليون على شقة فاخرة في التجمع الخامس"
        /(?:على|علي)\s+((?:ال)?(?:شق[ةه]|فيلا|منزل|عقار|بيت|دوبلكس|استوديو|محل|دوبليكس)\s+[^\n،؟!]+)/i,
        // "أتفاوض على الفيلا المستقلة في زايد"
        /(?:أتفاوض|اتفاوض|تفاوض)\s+(?:على|علي)\s+((?:ال)?(?:شق[ةه]|فيلا|منزل|عقار|بيت|دوبلكس|دوبليكس)\s+[^\n،؟!]+)/i,
        // "للفيلا المستقلة" أو "للشقة الفاخرة" - يلتقط "فيلا المستقلة" أو "الفيلا المستقلة"
        /(?:ل|لل)((?:ال)?(?:شق[ةه]|فيلا|منزل|عقار|بيت|دوبلكس|استوديو|محل|دوبليكس)\s+[^\n،؟!]+)/i,
        // "شقة فاخرة في التجمع الخامس" أو "الدوبليكس في 6 أكتوبر" - استخراج كامل مع الموقع (كنسخة احتياطية)
        /((?:ال)?(?:شق[ةه]|فيلا|منزل|عقار|بيت|دوبلكس|استوديو|محل|دوبليكس)\s+[^\n،؟!]+(?:في|فى)\s+[^\n،؟!]+)/i,
        // "الدوبليكس في 6 أكتوبر" أو "الدوبليكس بزايد"
        /((?:ال)?دوبليكس\s+(?:في|فى|ب)\s+[^\n،؟!]+)/i,
        // "شقة في ..." أو "فيلا في ..."
        /((?:شق[ةه]|فيلا|دوبليكس)\s+(?:في|فى|ب)\s+[^\n،؟!]+)/i,
      ];

      let propertyDescription = null;
      for (const pattern of propertyNamePatterns) {
        const match = query.match(pattern);
        if (match && match[1]) {
          propertyDescription = match[1].trim();
          // إزالة كلمات زائدة في النهاية
          propertyDescription = propertyDescription.replace(/\s*(?:بسعر|ب|السعر|بـ|الى|إلى).*$/i, '').trim();
          console.log(`📍 Extracted property description: "${propertyDescription}"`);
          break;
        }
      }

      // ✅ إذا لم نجد وصف عقار في الرسالة الحالية، ابحث في سياق المحادثة
      if (!propertyDescription && promptHistory && promptHistory.length > 0) {
        console.log(`🔍 No property in current message, searching conversation history...`);

        // البحث في رسائل الـ AI عن أسماء عقارات مذكورة
        for (let i = promptHistory.length - 1; i >= Math.max(0, promptHistory.length - 6); i--) {
          const message = promptHistory[i];
          const messageText = message?.content || message?.text || "";
          const isAssistant = message?.role === "assistant" || message?.sender === "assistant";

          // نبحث في رسائل الـ AI عن عناوين عقارات
          if (isAssistant) {
            // البحث عن أنماط مثل "شقة فاخرة في التجمع الخامس" أو "**شقة...**"
            const titlePatterns = [
              /\*\*([^*]+(?:شق[ةه]|فيلا|دوبلكس|منزل|عقار)[^*]+)\*\*/i,
              /\*\*([^*]+(?:في|فى)\s+[^*]+)\*\*/i,
              /((?:شق[ةه]|فيلا|دوبلكس|منزل)\s+[^\n،.؟!]+(?:في|فى)\s+[^\n،.؟!]+)/i,
            ];

            for (const pattern of titlePatterns) {
              const match = messageText.match(pattern);
              if (match && match[1]) {
                const extracted = match[1].trim().replace(/\s*(?:بسعر|السعر|💰|🏠|📍).*$/i, '').trim();
                if (extracted.length > 5 && extracted.length < 100) {
                  propertyDescription = extracted;
                  console.log(`📍 Found property from AI response: "${propertyDescription}"`);
                  break;
                }
              }
            }
            if (propertyDescription) break;
          }

          // نبحث أيضاً في رسائل المستخدم
          if (!isAssistant) {
            for (const pattern of propertyNamePatterns) {
              const match = messageText.match(pattern);
              if (match && match[1]) {
                propertyDescription = match[1].trim().replace(/\s*(?:بسعر|ب|السعر|بـ).*$/i, '').trim();
                console.log(`📍 Found property from user message: "${propertyDescription}"`);
                break;
              }
            }
            if (propertyDescription) break;
          }
        }
      }

      // استخراج الموقع من الوصف أو الـ query
      const locationMatch = query.match(/(?:في|فى)\s+([^\n،.؟!]+)/i);
      const locationName = locationMatch ? locationMatch[1].trim() : null;

      // البحث عن العقار المطابق
      if (propertyDescription || locationName) {
        let searchTerms = propertyDescription || locationName;

        // إزالة "ال" التعريف لتحسين مطابقة البحث
        // مثال: "فيلا المستقلة" → "فيلا مستقلة"
        searchTerms = searchTerms.replace(/\s+ال([^\s]+)/g, ' $1');

        console.log(`🔍 Searching for property with terms: "${searchTerms}"`);

        // البحث بالعنوان أولاً (أكثر دقة)
        targetProperty = await Property.findOne({
          title: new RegExp(searchTerms.replace(/\s+/g, '.*'), 'i'),
          seller: { $exists: true, $ne: null } // نفضل عقارات البائعين العاديين
        }).lean();

        // لو ملقيناش، نبحث بالموقع
        if (!targetProperty && locationName) {
          targetProperty = await Property.findOne({
            $or: [
              { title: new RegExp(locationName, 'i') },
              { 'location.city': new RegExp(locationName, 'i') },
              { 'location.area': new RegExp(locationName, 'i') },
            ],
            seller: { $exists: true, $ne: null } // نفضل عقارات البائعين العاديين
          }).lean();
        }

        // لو لسه ملقيناش، نبحث بدون قيد البائع
        if (!targetProperty) {
          targetProperty = await Property.findOne({
            $or: [
              { title: new RegExp(searchTerms.replace(/\s+/g, '.*'), 'i') },
              { 'location.city': new RegExp(locationName || searchTerms, 'i') },
              { 'location.area': new RegExp(locationName || searchTerms, 'i') },
            ]
          }).lean();
        }

        console.log(`🔍 Property search result: ${targetProperty ? 'FOUND - ' + targetProperty.title : 'NOT FOUND'}`);
      }

      // ⚠️ إذا لم نجد عقار محدد في الرسالة، لا نستخدم السياق القديم!
      // السبب: السياق قد يحتوي على معلومات عقار سابق (مثل اسوان)
      // المستخدم ربما يريد التفاوض على عقار جديد تماماً
      if (!targetProperty && propertyDescription) {
        console.log(`❌ Could not find property matching: "${propertyDescription}"`);

        return res.json({
          success: true,
          answer: `عذراً، مش قادر ألاقي العقار "${propertyDescription}" 🤔\n\n` +
            `ممكن تبحث عن العقار الأول وتختاره من النتائج، بعدين تقول "أعرض [السعر] على [اسم العقار]"؟ 🔍`,
          results: [],
          meta: {
            searchType: "offer-property-not-found-specific",
            resultsCount: 0,
            hasFilters: false,
            action: "need_property_clarification",
          },
        });
      }

      // ✅ فقط إذا لم يُحدد المستخدم عقار معين، نبحث بالفلاتر الحالية (من الرسالة الحالية فقط)
      const currentFilters = extractFiltersFromText(query);

      if (!targetProperty && Object.keys(currentFilters).length > 0) {
        console.log(`🔍 Searching with CURRENT message filters only (not history):`, JSON.stringify(currentFilters));

        // بناء query من الفلاتر الحالية فقط - نفضل عقارات البائعين
        const contextQuery = {
          seller: { $exists: true, $ne: null }
        };

        if (currentFilters.city && currentFilters.city.length > 0) {
          contextQuery['location.city'] = {
            $in: currentFilters.city.map(c => new RegExp(c, 'i'))
          };
        }
        if (currentFilters.type) {
          contextQuery.type = currentFilters.type;
        }

        // البحث عن أول عقار مطابق من بائع عادي
        targetProperty = await Property.findOne(contextQuery)
          .sort({ updatedAt: -1 })
          .lean();

        console.log(`🔍 Property search by CURRENT filters (seller): ${targetProperty ? 'FOUND - ' + targetProperty.title : 'NOT FOUND'}`);

        // لو ملقيناش من بائع، نبحث من أي حد
        if (!targetProperty && Object.keys(contextQuery).length > 1) {
          delete contextQuery.seller;
          targetProperty = await Property.findOne(contextQuery)
            .sort({ updatedAt: -1 })
            .lean();

          console.log(`🔍 Property search by context filters (any): ${targetProperty ? 'FOUND - ' + targetProperty.title : 'NOT FOUND'}`);
        }
      }

      // ⚠️ لا نبحث عشوائياً - لازم نلاقي العقار المحدد
      if (!targetProperty) {
        // لو لم نجد شيء، جرب آخر عقار تم إرجاعه في هذه الجولة
        if (retrievedProperties && retrievedProperties.length === 1) {
          targetProperty = retrievedProperties[0];
          console.log(`✅ Using single retrieved property for price offer: ${targetProperty.title}`);
        }
      }

      // ✅ Fallback: استخدام الفلاتر من سياق المحادثة للبحث
      if (!targetProperty && conversationFilters && Object.keys(conversationFilters).length > 0) {
        console.log(`🔍 Trying to find property using conversation filters:`, JSON.stringify(conversationFilters));

        const contextQuery = {};

        if (conversationFilters.city && conversationFilters.city.length > 0) {
          contextQuery['location.city'] = {
            $in: conversationFilters.city.map(c => new RegExp(c, 'i'))
          };
        }
        if (conversationFilters.type) {
          contextQuery.type = conversationFilters.type;
        }
        if (conversationFilters.maxPrice) {
          contextQuery.price = { $lte: conversationFilters.maxPrice * 1.2 }; // نطاق 20% زيادة
        }

        if (Object.keys(contextQuery).length > 0) {
          // نفضل عقارات البائعين العاديين
          targetProperty = await Property.findOne({
            ...contextQuery,
            seller: { $exists: true, $ne: null }
          })
            .sort({ updatedAt: -1 })
            .lean();

          if (!targetProperty) {
            // جرب بدون قيد البائع
            targetProperty = await Property.findOne(contextQuery)
              .sort({ updatedAt: -1 })
              .lean();
          }

          console.log(`🔍 Property search by conversation filters: ${targetProperty ? 'FOUND - ' + targetProperty.title : 'NOT FOUND'}`);
        }
      }

      if (!targetProperty) {
        console.log(`❌ Could not find the specific property mentioned`);

        return res.json({
          success: true,
          answer: "عذراً، مش قادر أحدد العقار اللي حضرتك عايز تعرض عليه بالظبط. 🤔\n\n" +
            "ممكن توضح اسم العقار أو تبحث عنه الأول وتختاره من النتائج؟ 🔍",
          results: [],
          meta: {
            searchType: "offer-property-not-found",
            resultsCount: 0,
            hasFilters: false,
            action: "need_property_clarification",
          },
        });
      }

      if (targetProperty) {
        // ✅ التحقق: هل ده مشروع مطور عقاري؟
        const isDeveloperProperty = !!(targetProperty.developer || targetProperty.projectName);

        if (isDeveloperProperty) {
          // 🏢 مشروع مطور - لا يوجد تفاوض، شراء مباشر
          console.log(`🏢 Developer property detected: ${targetProperty.title} - No negotiation allowed`);

          const developerMessage = `🏢 **${targetProperty.title || targetProperty.projectName}** ده مشروع تابع لمطور عقاري.\n\n` +
            `💰 السعر: **${targetProperty.price?.toLocaleString() || '—'} جنيه**\n\n` +
            `⚠️ **مشاريع المطورين العقاريين أسعارها ثابتة ومفيش تفاوض!**\n\n` +
            `✅ لو حضرتك عايز تشتري، ممكن تحجز الوحدة مباشرة أو تتواصل مع المطور.\n\n` +
            `هل تحب أساعدك في الحجز أو أعرض عليك عقارات تانية من بائعين عاديين تقدر تتفاوض عليها؟ 🏠`;

          return res.json({
            success: true,
            answer: developerMessage,
            results: [targetProperty],
            meta: {
              searchType: "developer-property",
              resultsCount: 1,
              hasFilters: false,
              action: "no_negotiation_developer",
              isDeveloperProperty: true,
            },
          });
        }

        // 👤 عقار بائع عادي - يمكن التفاوض
        const offerResult = await createNegotiationFromAI(userId, targetProperty._id, priceOffer);

        if (offerResult.success) {
          let successMessage = "";

          // حالة: عرض جديد تماماً
          if (!offerResult.duplicate) {
            successMessage = `تمام يا فندم! 🤩 حضرتك بتعرض **${priceOffer.offeredPrice.toLocaleString()} جنيه ${priceOffer.offerType === 'cash' ? 'كاش' : 'تقسيط'}** على **${targetProperty.title || 'العقار'}** اللي سعره **${offerResult.propertyPrice?.toLocaleString() || '—'} جنيه**.\n\n` +
              `✅ تم تقديم العرض للبائع بنجاح! ⏳ هننتظر رده وهبلغ حضرتك فوراً أول ما يوصل رد.\n\n` +
              `هل تحتاج مساعدة في أي شيء آخر؟ 😊`;
          }
          // حالة: تحديث عرض نشط موجود
          else if (offerResult.isActive) {
            successMessage = `📢 **انتبه!** حضرتك كنت قدمت عرض على هذا العقار قبل كده!\n\n` +
              `📊 **حالة العرض السابق:** ${offerResult.statusArabic}\n\n` +
              `✅ تم تحديث العرض بالمبلغ الجديد: **${priceOffer.offeredPrice.toLocaleString()} جنيه ${priceOffer.offerType === 'cash' ? 'كاش' : 'تقسيط'}**\n\n` +
              `⏳ هننتظر رد البائع وهبلغ حضرتك فوراً.\n\n` +
              `تقدر تتابع حالة العرض من صفحة **"عروضي"** 📋`;
          }
          // حالة: عرض سابق مرفوض - تحذير المستخدم
          else if (offerResult.needsNewOffer) {
            successMessage = `⚠️ **تنبيه مهم!**\n\n` +
              `حضرتك كنت قدمت عرض على **${targetProperty.title}** قبل كده لكن البائع **رفضه** ❌\n\n` +
              `💰 **العرض السابق:** ${offerResult.offeredPrice?.toLocaleString() || '—'} جنيه\n` +
              `💰 **سعر العقار:** ${offerResult.propertyPrice?.toLocaleString() || '—'} جنيه\n\n` +
              `💡 **نصيحة:** ممكن تقدم عرض جديد بسعر أقرب لسعر البائع عشان يوافق!\n\n` +
              `هل تحب تقدم عرض جديد؟ لو آه، قولي السعر الجديد وأنا هقدمه للبائع. 😊`;
          }

          return res.json({
            success: true,
            answer: successMessage,
            results: [targetProperty],
            meta: {
              searchType: offerResult.duplicate ? "negotiation-existing" : "negotiation-created",
              resultsCount: 1,
              hasFilters: false,
              action: offerResult.needsNewOffer ? "offer_needs_update" : "offer_submitted",
              offerDetails: offerResult,
            },
          });
        } else {
          // حالة فشل (مثل: عقار محجوز بالفعل)
          return res.json({
            success: true,
            answer: `⚠️ ${offerResult.message}`,
            results: [targetProperty],
            meta: {
              searchType: "negotiation-failed",
              resultsCount: 1,
              hasFilters: false,
              action: "offer_failed",
              failureReason: offerResult.previousStatus,
            },
          });
        }
      }
    } else if (priceOffer && rentalOffer) {
      console.log(`⚠️ Price offer block SKIPPED: priceOffer detected BUT rentalOffer also detected - conflict!`);
    } else if (priceOffer) {
      console.log(`⚠️ Price offer block SKIPPED: priceOffer detected BUT condition not met`);
    }

    // ✅ تقديم عرض إيجار
    if (rentalOffer && userId) {
      console.log("🏠 Processing rental offer request...");

      // البحث عن العقار المذكور في السياق
      let targetProperty = null;

      // استخراج اسم العقار من النص
      const propertyNamePatterns = [
        /(?:على|علي|للبائع|لبائع|ل)\s*(?:شق[ةه]|فيلا|منزل|عقار|في)?\s*(?:في|فى)?\s*([^\n،؟!]+)/i,
      ];

      let propertyDescription = null;
      for (const pattern of propertyNamePatterns) {
        const match = query.match(pattern);
        if (match && match[1]) {
          propertyDescription = match[1].trim();
          break;
        }
      }

      // البحث في السياق عن العقار الأخير المذكور (نوسع إلى 6 رسائل وندور على جملة كاملة)
      if (!propertyDescription && promptHistory && promptHistory.length > 0) {
        for (let i = promptHistory.length - 1; i >= Math.max(0, promptHistory.length - 6); i--) {
          const message = promptHistory[i];
          const messageText = message?.content || message?.text || "";

          // التقاط جملة من نوع "شقة للإيجار في المعادي" أو "فيلا ... في زايد"
          const fullPropMatch = messageText.match(/((?:ال)?(?:شق[ةه]|فيلا|منزل|عقار|بيت|دوبلكس|استوديو|محل|دوبليكس)[^\n،.؟!]*?(?:في|فى)\s+[^\n،.؟!]+)/i);
          if (fullPropMatch && fullPropMatch[1]) {
            propertyDescription = fullPropMatch[1].trim();
            propertyDescription = propertyDescription.replace(/\s*(?:بسعر|ب|السعر|بـ|الى|إلى).*$/i, '').trim();
            console.log(`📍 Found property phrase from context: "${propertyDescription}"`);
            break;
          }

          // لو مفيش، حاول استنتاج المدينة من السياق
          const cities = detectCityFromQuery(messageText);
          if (cities && cities.length > 0) {
            propertyDescription = cities[0];
            console.log(`📍 Found property city from context: "${propertyDescription}"`);
            break;
          }

          // البحث عن اسم مدينة أو منطقة بشكل بسيط
          const locationMatch = messageText.match(/(?:في|فى)\s+([^\n،.؟!]+)/i);
          if (locationMatch) {
            propertyDescription = locationMatch[1].trim();
            console.log(`📍 Found property location from context: "${propertyDescription}"`);
            break;
          }
        }
      }

      // لو لسه مفيش وصف، نحاول استنتاج المدينة من الاستعلام الحالي
      if (!propertyDescription) {
        const cities = detectCityFromQuery(query);
        if (cities && cities.length > 0) {
          propertyDescription = cities[0];
          console.log(`📍 Found property city from current query: "${propertyDescription}"`);
        }
      }

      // تجميع مدن محتملة من السياق + الاستعلام لاستخدامها كخطة احتياطية
      const candidateCities = new Set();
      detectCityFromQuery(query).forEach(c => candidateCities.add(c));
      if (promptHistory && promptHistory.length > 0) {
        for (let i = promptHistory.length - 1; i >= Math.max(0, promptHistory.length - 6); i--) {
          const messageText = promptHistory[i]?.content || promptHistory[i]?.text || "";
          detectCityFromQuery(messageText).forEach(c => candidateCities.add(c));
        }
      }

      // تنظيف الأوصاف العامة غير المفيدة (مثل "العثور على العقار المثالي") لصالح البحث بالمدينة
      const noisyLocationPattern = /(العثور|مثالي|المناسب|أفضل|الافضل)/i;
      const hasKnownPropertyKeyword = propertyDescription && /(شقة|شق[ةه]|فيلا|دوبلكس|محل|زايد|المعادي|maadi|القاهرة|cairo|october|الشيخ|نصر|6\s*أكتوبر)/i.test(propertyDescription);
      if (propertyDescription && noisyLocationPattern.test(propertyDescription) && !hasKnownPropertyKeyword) {
        console.log(`⚠️ Ignoring noisy property description from context: "${propertyDescription}"`);
        propertyDescription = null;
      }

      // البحث عن العقار
      if (propertyDescription) {
        // إزالة "ال" لتحسين المطابقة
        let searchTerms = propertyDescription.replace(/\s+ال([^\s]+)/g, ' $1');

        // تصحيح أخطاء إملائية شائعة
        searchTerms = searchTerms.replace(/المعادة|المعادى|معادة/gi, 'المعادي');
        searchTerms = searchTerms.replace(/القاهرة|القاهره/gi, 'القاهرة');
        searchTerms = searchTerms.replace(/الاسكندرية|اسكندرية/gi, 'الإسكندرية');

        const titleRegex = new RegExp(searchTerms.replace(/\s+/g, '.*'), 'i');
        const cityRegex = new RegExp(searchTerms, 'i');

        console.log(`🔍 Searching for rental property: "${searchTerms}"`);

        targetProperty = await Property.findOne({
          $or: [
            { 'location.city': cityRegex },
            { 'location.area': cityRegex },
            { title: titleRegex },
          ],
          saleType: 'rent', // يجب أن يكون للإيجار
        }).lean();

        console.log(`🔍 Property search result: ${targetProperty ? 'FOUND - ' + targetProperty.title : 'NOT FOUND'}`);
      }

      // خطة باستخدام فلاتر المحادثة (مدن) لو لسه مفيش تطابق
      if (!targetProperty && conversationFilters?.city?.length) {
        const cityRegex = conversationFilters.city.length === 1
          ? new RegExp(conversationFilters.city[0], 'i')
          : { $in: conversationFilters.city.map(c => new RegExp(c, 'i')) };
        targetProperty = await Property.findOne({
          $or: [
            { 'location.city': cityRegex },
            { 'location.area': cityRegex },
          ],
          saleType: 'rent',
        }).sort({ updatedAt: -1 }).lean();
        console.log(`🔍 Rental search using conversation filters: ${targetProperty ? 'FOUND - ' + targetProperty.title : 'NOT FOUND'}`);
      }

      // خطة احتياطية: لو لم نجد مع الوصف، نجرب أول مدينة من السياق
      if (!targetProperty && candidateCities.size > 0) {
        const citiesArr = Array.from(candidateCities);
        const cityRegex = citiesArr.length === 1 ? new RegExp(citiesArr[0], 'i') : { $in: citiesArr.map(c => new RegExp(c, 'i')) };
        targetProperty = await Property.findOne({
          $or: [
            { 'location.city': cityRegex },
            { 'location.area': cityRegex },
          ],
          saleType: 'rent',
        }).sort({ updatedAt: -1 }).lean();
        console.log(`🔍 Fallback rental search by city: ${targetProperty ? 'FOUND - ' + targetProperty.title : 'NOT FOUND'}`);
      }

      // خطة احتياطية إضافية: لو في عقار واحد تم استرجاعه بالفعل في هذه الجولة، استخدمه
      if (!targetProperty && retrievedProperties && retrievedProperties.length === 1) {
        targetProperty = retrievedProperties[0];
        console.log(`✅ Using single retrieved property for rental offer: ${targetProperty.title}`);
      }

      if (!targetProperty) {
        // ما لقيناش العقار - نسأل عن التوضيح
        let missingInfo = [];
        if (!propertyDescription) missingInfo.push("اسم العقار أو موقعه");
        if (!rentalOffer.monthlyRent) missingInfo.push("السعر الشهري المقترح");
        if (!rentalOffer.rentalDuration) missingInfo.push("مدة الإيجار (بالسنوات)");

        return res.json({
          success: true,
          answer: `تمام يا فندم! 👍 عشان أقدم عرض إيجار، محتاج أعرف:\n\n` +
            `❓ ${missingInfo.join('\n❓ ')}\n\n` +
            `لما تقولي التفاصيل دي، هقدم العرض للبائع مباشرة! 🤝`,
          results: [],
          meta: {
            searchType: "rental-needs-details",
            resultsCount: 0,
            hasFilters: false,
            action: "need_rental_details",
          },
        });
      }

      // التحقق: هل العقار فعلاً للإيجار؟
      if (targetProperty.saleType !== 'rent') {
        return res.json({
          success: true,
          answer: `⚠️ **${targetProperty.title}** ده عقار **${targetProperty.saleType === 'sale' ? 'للبيع' : 'غير متاح للإيجار'}**.\n\n` +
            `💰 السعر: **${targetProperty.price?.toLocaleString() || '—'} جنيه**\n\n` +
            `هل تحب تقدم عرض شراء بدلاً من الإيجار؟ 🏠`,
          results: [targetProperty],
          meta: {
            searchType: "property-not-for-rent",
            resultsCount: 1,
            hasFilters: false,
            action: "property_sale_not_rent",
          },
        });
      }

      // إنشاء عرض الإيجار
      const offerDetails = {
        offeredPrice: rentalOffer.monthlyRent || targetProperty.price, // استخدام سعر العقار إذا لم يحدد المستخدم
        offerType: 'rental',
        rentalDuration: rentalOffer.rentalDuration,
      };

      const offerResult = await createNegotiationFromAI(userId, targetProperty._id, offerDetails);

      if (offerResult.success) {
        let successMessage = `تمام يا فندم! 🤩 تم تقديم عرض إيجار على **${targetProperty.title}**.\n\n`;

        if (rentalOffer.monthlyRent) {
          successMessage += `💰 **السعر الشهري المقترح:** ${rentalOffer.monthlyRent.toLocaleString()} جنيه\n`;
        } else {
          successMessage += `💰 **السعر الشهري الأصلي:** ${targetProperty.price?.toLocaleString() || '—'} جنيه\n`;
        }

        if (rentalOffer.rentalDuration) {
          successMessage += `📅 **مدة الإيجار:** ${rentalOffer.rentalDuration} ${rentalOffer.rentalDuration === 1 ? 'سنة' : 'سنوات'}\n`;
        }

        successMessage += `\n✅ تم إرسال العرض للبائع! ⏳ هننتظر رده وهبلغ حضرتك فوراً.\n\n`;
        successMessage += `هل تحتاج مساعدة في أي شيء آخر؟ 😊`;

        return res.json({
          success: true,
          answer: successMessage,
          results: [targetProperty],
          meta: {
            searchType: "rental-offer-created",
            resultsCount: 1,
            hasFilters: false,
            action: "rental_offer_submitted",
            offerDetails: offerResult,
          },
        });
      } else {
        return res.json({
          success: true,
          answer: `⚠️ ${offerResult.message}`,
          results: [targetProperty],
          meta: {
            searchType: "rental-offer-failed",
            resultsCount: 1,
            hasFilters: false,
            action: "rental_offer_failed",
          },
        });
      }
    }

    // ✅ تنفيذ تعديل عرض التفاوض إذا تم طلبه
    if (offerModification && userId) {
      console.log("📝 Processing offer modification request...");
      console.log(`📝 Modification details:`, JSON.stringify(offerModification));
      const modificationResult = await updateNegotiationOffer(userId, offerModification);

      console.log(`📝 Modification result:`, JSON.stringify(modificationResult));

      if (modificationResult.success) {
        // رد مباشر بنجاح التعديل
        const successMessage = `✅ تم تحديث العرض بنجاح!\n\n` +
          `📌 **العقار:** ${modificationResult.propertyTitle}\n` +
          `${modificationResult.message}\n\n` +
          `حالة التفاوض: ${getStatusArabic(modificationResult.sessionStatus)}\n\n` +
          `هل تحتاج أي مساعدة أخرى؟ 😊`;

        return res.json({
          success: true,
          answer: successMessage,
          properties: [],
          meta: {
            searchType: "negotiation-update",
            resultsCount: 0,
            hasFilters: false,
            action: "offer_modified",
            modificationDetails: modificationResult
          },
        });
      } else {
        // في حالة الفشل، نضيف رسالة الخطأ للسياق وندع الـ AI يرد
        negotiationsContext += `\n\n⚠️ ملاحظة: حاول المستخدم تعديل عرض التفاوض لكن: ${modificationResult.message}`;
      }
    };

    // Always fetch user's transactions context if userId exists
    if (userId) {
      console.log("📋 Fetching user's full transaction context...");
      const [negotiations, drafts, contracts, deals] = await Promise.all([
        getUserNegotiations(userId),
        getUserDealDrafts(userId),
        getUserContracts(userId),
        getUserDeals(userId),
      ]);

      negotiationsContext = formatTransactionsContext(negotiations, drafts, contracts, deals);
      console.log(`📋 Found: ${negotiations.length} negotiations, ${drafts.length} drafts, ${contracts.length} contracts, ${deals.length} deals`);

      // ✅ عرض تفاصيل جلسات التفاوض للتأكد
      if (negotiations.length > 0) {
        console.log(`📋 Negotiations details:`);
        negotiations.forEach((n, i) => {
          console.log(`   ${i + 1}. ${n.propertyTitle} - Status: ${n.status} (${n.statusArabic})`);
        });
      }

      // ✅ عرض السياق الكامل للـ debugging
      if (negotiationsContext) {
        console.log(`📋 Context being sent to AI:\n${negotiationsContext.substring(0, 500)}...`);
      }
    } else if (isAskingAboutNegotiation || isAskingAboutTransactions) {
      // Even without userId, try to give a helpful response
      console.log("📋 Transaction inquiry but no userId - will ask AI to respond appropriately");
    }

    let aiAnswer = "";
    let followUpQuestion = null;

    // Detect if user wants property search or just chatting
    const wantsPropertySearch = detectPropertySearchIntent(query) || hasFilters;
    const hasEnoughInfo = hasEnoughDetailsToSearch(query, memorySummary);

    console.log(`🎯 Search intent detected: ${wantsPropertySearch ? 'YES' : 'NO'}`);
    console.log(`📋 Has enough details to search: ${hasEnoughInfo ? 'YES' : 'NO'}`);

    // Only search for properties if user intent indicates property search AND has enough details
    if (wantsPropertySearch && hasEnoughInfo) {
      // Try vector search first (always, since we have Fireworks)
      try {
        // Step 1: Perform vector search (RAG retrieval)
        console.log("🔍 Attempting vector search with enhanced query and merged filters...");
        // ✅ استخدام الاستعلام المُحسّن والفلاتر المدمجة
        if (hasFilters) {
          retrievedProperties = await searchWithFilters(enhancedQuery, mergedFilters, 3);

          // ✅ إذا لم نجد نتائج مع الفلاتر، جرب بدون فلاتر السعر
          if (retrievedProperties.length === 0 && (mergedFilters.minPrice || mergedFilters.maxPrice)) {
            console.log("🔄 No results with price filter, trying without price constraints...");
            const relaxedFilters = { ...mergedFilters };
            delete relaxedFilters.minPrice;
            delete relaxedFilters.maxPrice;
            retrievedProperties = await searchWithFilters(enhancedQuery, relaxedFilters, 5);
          }

          // ✅ إذا لا زلنا لم نجد، جرب بدون أي فلاتر
          if (retrievedProperties.length === 0) {
            console.log("🔄 Still no results, trying semantic search only...");
            retrievedProperties = await searchSimilarProperties(query, 5);
          }
        } else {
          retrievedProperties = await searchSimilarProperties(enhancedQuery, 3);
        } console.log(`📦 Retrieved ${retrievedProperties.length} properties from vector search`);

        // Step 2: Generate AI response using LLM (if AI configured)
        // ✅ إضافة سياق العقارات الحالية للـ negotiationsContext
        const fullContext = currentPropertiesContext + negotiationsContext;

        if (useAI && retrievedProperties.length > 0) {
          try {
            console.log("🤖 Generating AI response...");
            aiAnswer = await generateAIResponse(query, retrievedProperties, promptHistory, memorySummary, fullContext);

            // Step 3: Optional - Generate follow-up question
            followUpQuestion = await generateFollowUpQuestion(query, aiAnswer);
          } catch (llmError) {
            console.error("⚠️  LLM generation failed:", llmError.message);
            // Fallback response when AI fails
            aiAnswer = `وجدت ${retrievedProperties.length} عقار${retrievedProperties.length > 1 ? 'ات' : ''} مناسب${retrievedProperties.length > 1 ? 'ة' : ''} لبحثك عن "${query}". يمكنك الاطلاع على التفاصيل الكاملة لكل عقار أدناه.`;
          }
        } else if (retrievedProperties.length > 0) {
          // Provide a simple response when AI is not configured
          aiAnswer = `وجدت ${retrievedProperties.length} عقار${retrievedProperties.length > 1 ? 'ات' : ''} مناسب${retrievedProperties.length > 1 ? 'ة' : ''} بناءً على بحثك. إليك التفاصيل:`;
        } else {
          // ✅ استخدام AI للرد بشكل ذكي عندما لا توجد نتائج
          if (useAI) {
            try {
              aiAnswer = await generateAIResponse(query, [], promptHistory, memorySummary, fullContext);
            } catch (llmError) {
              aiAnswer = "لم أجد عقارات مطابقة لبحثك حالياً. جرب توسيع معايير البحث أو ابحث في مناطق أخرى.";
            }
          } else {
            aiAnswer = "لم أجد عقارات مطابقة لبحثك حالياً. جرب توسيع معايير البحث أو ابحث في مناطق أخرى.";
          }
        }
      } catch (error) {
        console.error("⚠️  Vector search failed:", error.message);
        console.error("Stack:", error.stack);
        // Fall back to basic search
        const searchRegex = new RegExp(query, "i");
        const cityRegexes = detectCityFromQuery(query).map((city) => new RegExp(city, "i"));
        const orClauses = [
          { title: searchRegex },
          { description: searchRegex },
          { "location.city": searchRegex },
          { "location.area": searchRegex },
          ...cityRegexes.map((regex) => ({ "location.city": regex })),
          ...cityRegexes.map((regex) => ({ "location.area": regex })),
        ];

        const fallbackFilter = {
          // ✅ استخدام الفلاتر المدمجة
          ...buildMongoFilterFromNormalizedFilters(mergedFilters),
        };

        if (orClauses.length) {
          fallbackFilter.$or = orClauses;
        }

        retrievedProperties = await Property.find(fallbackFilter)
          .limit(5)
          .select("-embedding")
          .sort({ createdAt: -1 });

        console.log(`📦 Basic search retrieved ${retrievedProperties.length} properties`);

        // Provide fallback response
        if (retrievedProperties.length > 0) {
          aiAnswer = `وجدت ${retrievedProperties.length} عقار${retrievedProperties.length > 1 ? 'ات' : ''} قد ${retrievedProperties.length > 1 ? 'تناسب' : 'يناسب'} احتياجاتك. راجع التفاصيل أدناه:`;
        } else {
          aiAnswer = "عذراً، لم أجد عقارات مطابقة لبحثك. حاول البحث بكلمات مختلفة أو في مناطق أخرى.";
        }
      }
    } else if (wantsPropertySearch && !hasEnoughInfo) {
      // User wants to search but hasn't provided enough details - let AI ask questions
      console.log("💬 Property intent detected but missing details - AI will ask questions");

      if (useAI) {
        try {
          // Generate response that asks for missing information
          const conversationResponse = await generateAIResponse(query, [], promptHistory, memorySummary, negotiationsContext);
          aiAnswer = conversationResponse;
        } catch (llmError) {
          console.error("⚠️  Conversation generation failed:", llmError.message);
          aiAnswer = "تمام! عشان أساعدك ألاقي العقار المناسب، محتاج أعرف إيه الميزانية اللي مرتاح فيها؟ 💰";
        }
      } else {
        aiAnswer = "تمام! عشان أساعدك ألاقي العقار المناسب، محتاج أعرف إيه الميزانية اللي مرتاح فيها؟";
      }
    } else {
      // For general conversation, just use AI without property context
      console.log("💬 General conversation mode - no property search");

      if (useAI) {
        try {
          // Generate conversational response without properties
          const conversationResponse = await generateAIResponse(query, [], promptHistory, memorySummary, negotiationsContext);
          aiAnswer = conversationResponse;
        } catch (llmError) {
          console.error("⚠️  Conversation generation failed:", llmError.message);
          // Fallback to simple response
          aiAnswer = "أهلاً بك! أنا مساعدك الذكي للعقارات. يمكنني مساعدتك في البحث عن شقق، فلل، أو أي نوع عقار. ما الذي تبحث عنه؟";
        }
      } else {
        aiAnswer = "مرحباً! كيف يمكنني مساعدتك اليوم؟ يمكنني البحث عن عقارات، تقديم معلومات عن الأسعار، أو الإجابة على أسئلتك.";
      }
    }

    if (userId) {
      const intent = wantsPropertySearch
        ? (hasEnoughInfo ? "property-search" : "gathering-requirements")
        : "general-chat";

      await recordInteraction({
        userId,
        userMessage: { role: "user", content: query },
        aiMessage: { role: "assistant", content: aiAnswer },
        intent,
      });

      refreshPreferencesFromHistory(userId).catch((error) => {
        console.warn("⚠️  Failed to refresh AI memory:", error.message);
      });
    }

    // Step 4: Return response
    // ✅ فقط أرجع النتائج إذا كان المستخدم يبحث عن عقار فعلياً
    const shouldReturnProperties = wantsPropertySearch && hasEnoughInfo && retrievedProperties.length > 0;

    res.json({
      success: true,
      answer: aiAnswer,
      results: shouldReturnProperties ? retrievedProperties : [], // ✅ لا ترجع نتائج في المحادثة العامة
      followUpQuestion: followUpQuestion,
      meta: {
        resultsCount: shouldReturnProperties ? retrievedProperties.length : 0,
        timestamp: new Date().toISOString(),
        mode: useAI ? 'ai' : 'basic',
        provider: isGeminiConfigured() ? 'gemini' : (isOpenAIConfigured() ? 'openai' : 'none'),
        searchPerformed: shouldReturnProperties,
      },
    });
  } catch (error) {
    console.error("❌ Error in aiQuery controller:", error.message);
    console.error("❌ Stack trace:", error.stack);
    res.status(500).json({
      success: false,
      message: "An error occurred while processing your query",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Generate embedding for a specific property
 * POST /api/ai/generate-embedding/:propertyId
 */
exports.generateEmbedding = async (req, res) => {
  try {
    const { propertyId } = req.params;

    if (!propertyId) {
      return res.status(400).json({
        success: false,
        message: "Property ID is required",
      });
    }

    const updatedProperty = await generatePropertyEmbedding(propertyId);

    res.json({
      success: true,
      message: "Embedding generated successfully",
      property: {
        id: updatedProperty._id,
        title: updatedProperty.title,
        hasEmbedding: !!updatedProperty.embedding,
      },
    });
  } catch (error) {
    console.error("❌ Error generating embedding:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to generate embedding",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Generate embeddings for all properties without embeddings
 * POST /api/ai/generate-all-embeddings
 */
exports.generateAllEmbeddings = async (req, res) => {
  try {
    console.log("🔄 Starting batch embedding generation...");
    const count = await generateAllEmbeddings();

    res.json({
      success: true,
      message: `Successfully generated embeddings for ${count} properties`,
      count: count,
    });
  } catch (error) {
    console.error("❌ Error in batch embedding generation:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to generate embeddings",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Test vector search directly
 * POST /api/ai/test-search
 * Body: { query: "test query" }
 */
exports.testSearch = async (req, res) => {
  try {
    const { query } = req.body;

    if (!query) {
      return res.status(400).json({
        success: false,
        message: "Query is required",
      });
    }

    const results = await searchSimilarProperties(query, 5);

    res.json({
      success: true,
      message: "Search completed",
      results: results,
      count: results.length,
    });
  } catch (error) {
    console.error("❌ Error in test search:", error.message);
    res.status(500).json({
      success: false,
      message: "Search failed",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Generate property recommendations based on onboarding answers
 * POST /api/ai/recommend
 */
exports.recommendFromPreferences = async (req, res) => {
  try {
    const preferences = req.body || {};
    const userRole = req.user?.role;

    if (userRole && userRole !== "buyer") {
      return res.status(403).json({
        success: false,
        message: "Recommendations are available for buyer accounts only",
      });
    }

    const filters = {};

    if (preferences.budgetEnabled) {
      const priceFilter = {};
      if (preferences.budgetMin) {
        priceFilter.$gte = Number(preferences.budgetMin);
      }
      if (preferences.budgetMax) {
        priceFilter.$lte = Number(preferences.budgetMax);
      }
      if (Object.keys(priceFilter).length) {
        filters.price = priceFilter;
      }
    }

    const normalizedTypes = normalizeTypes(preferences.propertyType);
    if (normalizedTypes.length) {
      filters.type = { $in: normalizedTypes };
    }

    if (preferences.location) {
      filters["location.city"] = new RegExp(`^${preferences.location}$`, "i");
    }

    if (preferences.areaRange) {
      const { min, max } = parseAreaRange(preferences.areaRange);
      const areaFilter = {};
      if (min != null) areaFilter.$gte = min;
      if (max != null) areaFilter.$lte = max;
      if (Object.keys(areaFilter).length) {
        filters.area = areaFilter;
      }
    }

    if (typeof preferences.bedrooms === "number") {
      filters.bedrooms = { $gte: preferences.bedrooms };
    }

    if (Array.isArray(preferences.features) && preferences.features.length) {
      filters.features = { $all: preferences.features };
    }

    if (preferences.purpose === "rent") {
      filters.listingStatus = { $in: ["rent", "both"] };
    } else if (preferences.purpose === "investment" || preferences.purpose === "quick_resale") {
      filters.listingStatus = { $in: ["sale", "both"] };
    }

    const limit = Number(process.env.RECOMMENDATION_LIMIT || 6);

    let results = await Property.find(filters)
      .sort({ isFeatured: -1, updatedAt: -1 })
      .limit(limit)
      .lean();

    if (results.length < limit) {
      const narrative = buildPreferenceNarrative(preferences);
      try {
        const vectorResults = await searchWithFilters(narrative, {
          minPrice: filters.price?.$gte,
          maxPrice: filters.price?.$lte,
          type: normalizedTypes.length === 1 ? normalizedTypes[0] : undefined,
          bedrooms: preferences.bedrooms,
          city: preferences.location,
        }, limit);

        vectorResults.forEach((property) => {
          if (!results.find((item) => item._id?.toString() === property._id?.toString())) {
            results.push(property);
          }
        });
      } catch (vectorError) {
        console.error("⚠️  Vector recommendation fallback failed:", vectorError.message);
      }
    }

    results = results.slice(0, limit);

    const recommendations = results.map((property, index) => {
      const score = property.score != null
        ? Math.min(Math.max(property.score, 0), 1)
        : Math.min(0.65 + (limit - index) * 0.05, 0.95);

      return {
        _id: property._id,
        title: property.title,
        description: property.description,
        price_egp: property.price,
        price: property.price,
        location: property.location,
        type: property.type,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
        area: property.area,
        listingStatus: property.listingStatus,
        features: property.features || [],
        coverImage: property.images?.[0] || null,
        images: property.images || [],
        match_score: Number(score.toFixed(2)),
      };
    });

    res.json({
      success: true,
      count: recommendations.length,
      recommendations,
    });
  } catch (error) {
    console.error("❌ Error generating recommendations:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to generate recommendations",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * 🎤 Voice AI Query Endpoint
 * Optimized for speech-to-text input and text-to-speech output
 * POST /api/ai/voice
 */
exports.voiceQuery = async (req, res) => {
  try {
    const { speechText, stage, history } = req.body;
    const userId = req.user?.id || req.user?._id || null;
    const userRole = req.user?.role;
    const isSeller = userRole === 'seller';

    console.log(`\n🎤 === Voice Query ===`);
    console.log(`👤 User: ${userId || 'anonymous'} (${userRole || 'guest'})`);
    console.log(`📍 Stage: ${stage || 'discovery'}`);
    console.log(`🗣️ Speech: "${speechText}"`);

    // Validate input
    if (!speechText || typeof speechText !== "string" || speechText.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Speech text is required",
        voiceResponse: "معلش مسمعتش كويس. ممكن تعيد تاني؟",
      });
    }

    const lowerSpeech = speechText.toLowerCase();

    // ✅ Handle seller property creation via voice
    if (isSeller && (detectAddPropertyIntent(speechText) || isInPropertyCreationSession(userId))) {
      console.log('🎤🏠 Voice: Seller property creation flow');
      
      try {
        const session = getSession(userId);
        const inSession = isInPropertyCreationSession(userId);
        
        // Start new session
        if (!inSession) {
          session.step = STEPS.START;
          const result = session.processResponse(speechText);
          const nextQuestion = session.getNextQuestion();
          
          return res.json({
            success: true,
            voiceResponse: nextQuestion,
            units: [],
            stage: 'property-creation',
            meta: { 
              isPropertyCreation: true, 
              step: session.step,
              mode: 'voice',
            },
          });
        }
        
        // Process current step
        const result = session.processResponse(speechText);
        
        // Validation error
        if (!result.success) {
          return res.json({
            success: true,
            voiceResponse: result.message,
            units: [],
            stage: 'property-creation',
            meta: { 
              isPropertyCreation: true, 
              step: session.step,
              validationError: true,
              mode: 'voice',
            },
          });
        }
        
        // Property creation complete
        if (result.isComplete) {
          const Property = require("../../models/propertyModel");
          const mongoose = require('mongoose');
          const propertyData = session.getPropertyData();
          const sellerObjectId = new mongoose.Types.ObjectId(userId);
          
          propertyData.seller = sellerObjectId;
          propertyData.addedBy = sellerObjectId;
          propertyData.termsAccepted = true;
          
          if (!propertyData.images || propertyData.images.length < 5) {
            propertyData.images = getPlaceholderImages(propertyData.type);
          }
          
          if (!propertyData.location.coordinates) {
            propertyData.location.coordinates = {
              type: 'Point',
              coordinates: [31.2357, 30.0444],
            };
          }
          
          const newProperty = new Property(propertyData);
          await newProperty.save();
          
          deleteSession(userId);
          
          const successMessage = `تم إضافة العقار ${newProperty.title} بنجاح. العقار موجود الآن في صفحة عقاراتي في البروفايل.`;
          
          return res.json({
            success: true,
            voiceResponse: successMessage,
            units: [newProperty],
            stage: 'property-created',
            meta: { 
              propertyId: newProperty._id,
              isPropertyCreation: true,
              mode: 'voice',
            },
          });
        }
        
        // Move to next step
        const nextQuestion = session.getNextQuestion();
        return res.json({
          success: true,
          voiceResponse: nextQuestion,
          units: [],
          stage: 'property-creation',
          meta: { 
            isPropertyCreation: true, 
            step: session.step,
            mode: 'voice',
          },
        });
        
      } catch (error) {
        console.error('❌ Voice property creation error:', error);
        deleteSession(userId);
        return res.json({
          success: true,
          voiceResponse: 'حصل خطأ في إضافة العقار. ممكن تجرب تاني من صفحة البروفايل.',
          units: [],
        });
      }
    }
    
    // ✅ Handle "عقاراتي" request via voice
    if (isSeller && (lowerSpeech.includes('عقاراتي') || lowerSpeech.includes('اعرض') && lowerSpeech.includes('عقار'))) {
      console.log('🎤📋 Voice: Seller requesting properties');
      
      try {
        const Property = require("../../models/propertyModel");
        const properties = await Property.find({ seller: userId })
          .sort({ createdAt: -1 })
          .limit(5);
        
        if (properties.length === 0) {
          return res.json({
            success: true,
            voiceResponse: 'ليس لديك أي عقارات حتى الآن. يمكنك إضافة عقار جديد بقول أضف عقار.',
            units: [],
          });
        }
        
        const voiceList = properties.map((p, i) => 
          `${i + 1}. ${p.title} في ${p.location?.city || ''} بسعر ${p.price?.toLocaleString() || ''} جنيه`
        ).join('. ');
        
        return res.json({
          success: true,
          voiceResponse: `لديك ${properties.length} عقار. ${voiceList}`,
          units: properties,
        });
      } catch (error) {
        return res.json({
          success: true,
          voiceResponse: 'حصل خطأ في جلب عقاراتك.',
          units: [],
        });
      }
    }
    
    // ✅ Handle "العروض الواردة" request via voice
    if (isSeller && (lowerSpeech.includes('العروض') || lowerSpeech.includes('عروض') || lowerSpeech.includes('deals') || lowerSpeech.includes('offers'))) {
      console.log('🎤💰 Voice: Seller requesting deals');
      
      try {
        const Property = require("../../models/propertyModel");
        const NegotiationSession = require("../../models/negotiationSessionModel");
        
        const properties = await Property.find({ seller: userId }).select('_id title');
        const propertyIds = properties.map(p => p._id);
        
        if (propertyIds.length === 0) {
          return res.json({
            success: true,
            voiceResponse: 'ليس لديك أي عقارات بعد. أضف عقار أولاً عشان تستقبل عروض عليه.',
            units: [],
          });
        }
        
        // جلب المفاوضات (العروض) على عقارات البائع
        const negotiations = await NegotiationSession.find({ 
          property: { $in: propertyIds }
        })
          .populate('property', 'title location.city')
          .populate('buyer', 'username')
          .sort({ createdAt: -1 })
          .limit(5);
        
        if (negotiations.length === 0) {
          return res.json({
            success: true,
            voiceResponse: `ليس لديك أي عروض حتى الآن. لديك ${properties.length} عقار منشور. انتظر حتى يقدم المشترين عروضهم.`,
            units: [],
          });
        }
        
        const getStatusArabic = (status) => {
          const map = {
            'pending': 'في الانتظار',
            'approved': 'تمت الموافقة',
            'declined': 'مرفوض',
            'confirmed': 'مؤكد',
          };
          return map[status] || status;
        };
        
        const voiceList = negotiations.map((n, i) => {
          const propertyTitle = n.property?.title || n.propertySnapshot?.title || 'عقار';
          const buyerName = n.buyer?.username || 'مشتري';
          const offerPrice = n.buyerOffer?.cashOfferPrice || n.buyerOffer?.offeredPrice || 0;
          const status = getStatusArabic(n.status);
          return `${i + 1}. عرض على ${propertyTitle} من ${buyerName} بمبلغ ${offerPrice?.toLocaleString()} جنيه. الحالة ${status}`;
        }).join('. ');
        
        return res.json({
          success: true,
          voiceResponse: `لديك ${negotiations.length} عرض. ${voiceList}`,
          units: negotiations,
        });
      } catch (error) {
        console.error('❌ Voice deals error:', error);
        return res.json({
          success: true,
          voiceResponse: 'حصل خطأ في جلب العروض.',
          units: [],
        });
      }
    }

    const { memorySummary, promptHistory } = await buildPromptContext(userId, history);

    // Get user negotiations context
    let negotiationsContext = "";
    if (userId) {
      const negotiations = await getUserNegotiations(userId);
      if (negotiations.length > 0) {
        negotiationsContext = negotiations.map(n => {
          const offeredPrice = n.buyerOffer?.offeredPrice || n.buyerOffer?.cashOfferPrice;
          return `${n.propertyTitle}: ${offeredPrice?.toLocaleString() || '—'} جنيه (${n.statusArabic})`;
        }).join('\n');
      }
    }

    // Search for relevant properties based on speech
    let retrievedUnits = [];
    const searchIntent = detectPropertySearchIntent(speechText);

    if (searchIntent) {
      const filters = extractFiltersFromText(speechText);
      const enhancedQuery = speechText;

      try {
        retrievedUnits = await searchWithFilters(enhancedQuery, filters, 3);
      } catch (searchError) {
        console.error("⚠️ Voice search failed:", searchError.message);
        retrievedUnits = [];
      }
    }

    // Generate voice-optimized response
    const voiceResponse = await generateVoiceResponse(
      speechText,
      retrievedUnits,
      stage || 'discovery',
      promptHistory,
      memorySummary,
      negotiationsContext
    );

    // Record interaction
    if (userId) {
      await recordInteraction({
        userId,
        userMessage: { role: "user", content: speechText },
        aiMessage: { role: "assistant", content: voiceResponse },
        intent: "voice-query",
      });
    }

    res.json({
      success: true,
      voiceResponse,
      units: retrievedUnits.slice(0, 2), // Max 2 units for voice
      stage: stage || 'discovery',
      meta: {
        unitsCount: retrievedUnits.length,
        timestamp: new Date().toISOString(),
        mode: 'voice',
      },
    });

  } catch (error) {
    console.error("❌ Error in voice query:", error.message);
    res.status(500).json({
      success: false,
      message: "Voice processing failed",
      voiceResponse: "معلش، حصل مشكلة تقنية. ممكن تحاول تاني؟",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};




