const { searchSimilarProperties, searchWithFilters } = require("../services/vector-search.service");
const { generateAIResponse, generateFollowUpQuestion, isGeminiConfigured } = require("../services/llm-agent.service");
const {
  buildPromptContext,
  recordInteraction,
  refreshPreferencesFromHistory,
} = require("../services/memory.service");
const { generatePropertyEmbedding, generateAllEmbeddings } = require("../services/embeddings.service");
const Property = require("../../models/propertyModel");
const NegotiationSession = require("../../models/negotiationSessionModel");
const DealDraft = require("../../models/dealDraftModel");
const Contract = require("../../models/contractModel");
const Deal = require("../../models/dealModel");

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
  
  // كلمات تدل على تقديم عرض سعر أو تأكيد العرض
  const offerKeywords = /أعرض|اعرض|عرض.*على|عرضي|عروض|عرضت|أقدم|اقدم|قدم.*عرض|قدم|negotiate|offer/i;
  
  if (!offerKeywords.test(lowerQuery)) {
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
  
  // إذا مفيش سعر في الرسالة الحالية، ابحث في آخر رسائل المحادثة
  if (!offeredPrice || offeredPrice < 10000) {
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
    
    // لسه مفيش سعر؟ يبقى مش offer
    if (!offeredPrice || offeredPrice < 10000) {
      return null;
    }
  }
  
  // استخراج نوع الدفع (كاش أو تقسيط)
  const isCash = /كاش|نقد|cash/i.test(lowerQuery);
  const isInstallment = /تقسيط|قسط|installment/i.test(lowerQuery);
  
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
      sessionStatus: session.status
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
      cashOfferPrice: offerDetails.offeredPrice,
      downPaymentPercent: offerDetails.downPaymentPercent,
      installmentYears: offerDetails.installmentYears,
      notes: offerDetails.notes || "",
    };
    
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
    
    console.log(`✅ Negotiation session created via AI: ${session._id}`);
    
    return {
      success: true,
      message: "تم تقديم العرض بنجاح",
      sessionId: session._id,
      propertyTitle: property.title,
      offeredPrice: offerDetails.offeredPrice,
      propertyPrice: property.price,
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
    const { query, filters, history } = req.body;
    const userId = req.user?.id || req.user?._id || null;
    const { memorySummary, promptHistory } = await buildPromptContext(userId, history);
    
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
    const isAskingAboutNegotiation = detectNegotiationStatusIntent(query);
    const isAskingAboutTransactions = detectTransactionStatusIntent(query);
    const isAskingOfferDetails = detectOfferDetailsInquiry(query);
    let negotiationsContext = "";
    
    // ✅ كشف طلب تعديل عرض التفاوض
    const offerModification = detectOfferModificationIntent(query);
    
    // ✅ كشف عرض سعر جديد على عقار (مع البحث في سياق المحادثة)
    const priceOffer = detectPriceOfferIntent(query, promptHistory);
    
    // ✅ كشف نية التفاوض (بدون سعر بالضرورة)
    const negotiationRequest = detectNegotiationRequestIntent(query);
    
    console.log(`🔍 Negotiation inquiry detected: ${isAskingAboutNegotiation ? 'YES' : 'NO'}, userId: ${userId || 'none'}`);
    console.log(`🔍 Transaction inquiry detected: ${isAskingAboutTransactions ? 'YES' : 'NO'}`);
    console.log(`🔍 Offer details inquiry detected: ${isAskingOfferDetails ? 'YES' : 'NO'}`);
    console.log(`🔄 Offer modification detected: ${offerModification ? JSON.stringify(offerModification) : 'NO'}`);
    console.log(`💰 Price offer detected: ${priceOffer ? JSON.stringify(priceOffer) : 'NO'}`);
    console.log(`🤝 Negotiation request detected: ${negotiationRequest ? JSON.stringify(negotiationRequest) : 'NO'}`);
    
    // ✅ معالجة طلب التفاوض على عقار (مع إنشاء جلسة فعلية)
    if (negotiationRequest && userId && !priceOffer) {
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
      
      if (!targetProperty) {
        // لم نجد العقار - نسأل عن توضيح
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
    
    // ✅ تقديم عرض سعر على عقار
    if (priceOffer && userId) {
      console.log("💵 Processing price offer request...");
      
      // البحث عن العقار المذكور في السياق أو في آخر نتائج البحث
      let targetProperty = null;
      
      // محاولة استخراج اسم/وصف العقار من النص
      const propertyNamePatterns = [
        // "أعرض 2 مليون على شقة فاخرة في التجمع الخامس"
        /(?:على|علي)\s+((?:ال)?(?:شق[ةه]|فيلا|منزل|عقار|بيت|دوبلكس|استوديو|محل|دوبليكس)\s+[^\n،؟!]+)/i,
        // "أتفاوض على الفيلا المستقلة في زايد"
        /(?:أتفاوض|اتفاوض|تفاوض)\s+(?:على|علي)\s+((?:ال)?(?:شق[ةه]|فيلا|منزل|عقار|بيت|دوبلكس|دوبليكس)\s+[^\n،؟!]+)/i,
        // "للشقة الفاخرة" أو "لشقة عصرية"
        /(?:ل|لل)((?:شق[ةه]|فيلا|منزل|عقار|بيت|دوبلكس|استوديو|محل|دوبليكس)\s+[^\n،؟!]+)/i,
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
      
      // استخراج الموقع من الوصف أو الـ query
      const locationMatch = query.match(/(?:في|فى)\s+([^\n،.؟!]+)/i);
      const locationName = locationMatch ? locationMatch[1].trim() : null;
      
      // البحث عن العقار المطابق
      if (propertyDescription || locationName) {
        const searchTerms = propertyDescription || locationName;
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
          console.log(`   ${i+1}. ${n.propertyTitle} - Status: ${n.status} (${n.statusArabic})`);
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

    let retrievedProperties = [];
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
          }        console.log(`📦 Retrieved ${retrievedProperties.length} properties from vector search`);

        // Step 2: Generate AI response using LLM (if AI configured)
        if (useAI && retrievedProperties.length > 0) {
          try {
            console.log("🤖 Generating AI response...");
            aiAnswer = await generateAIResponse(query, retrievedProperties, promptHistory, memorySummary, negotiationsContext);

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
              aiAnswer = await generateAIResponse(query, [], promptHistory, memorySummary, negotiationsContext);
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
