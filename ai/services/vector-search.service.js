const Property = require("../../models/propertyModel");
const { searchSimilarProperties: langchainSearch } = require("./embeddings.service");

const STOP_WORDS = new Set([
  "في",
  "عن",
  "على",
  "من",
  "الى",
  "الي",
  "مطلوب",
  "ابحث",
  "ابغي",
  "اريد",
  "عايز",
  "عاوزه",
  "شقة",
  "شقه",
  "apartment",
  "apartment",
  "flat",
  "villa",
  "looking",
  "search",
  "for",
  "in",
]);

const LOCATION_SYNONYMS = [
  ["القاهرة", "القاهره", "cairo"],
  ["الجيزة", "الجيزه", "giza"],
  ["الاسكندرية", "الاسكندريه", "alexandria", "اسكندرية"],
  ["اسوان", "أسوان", "aswan"],
  ["الغردقة", "hurghada"],
  ["شرم", "شرم الشيخ", "sharm", "sharm el sheikh"],
  ["دمياط", "damietta"],
  ["المنصورة", "mansoura"],
  ["سوهاج", "sohag"],
  ["اسيوط", "أسيوط", "assiut"],
  ["الاقصر", "الأقصر", "luxor"],
  ["السادس من اكتوبر", "6 اكتوبر", "6 october", "october"],
];

const LOCATION_VARIANT_MAP = new Map();
LOCATION_SYNONYMS.forEach((group) => {
  const normalizedGroup = group.map((value) => value.toLowerCase());
  group.forEach((variant) => {
    LOCATION_VARIANT_MAP.set(
      variant.toLowerCase(),
      new Set(group.concat(normalizedGroup))
    );
  });
});

function escapeRegExp(value = "") {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractKeywords(text = "") {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => !STOP_WORDS.has(word));
}

function expandKeywordVariants(keyword) {
  const normalized = keyword.toLowerCase();
  const variantSet = LOCATION_VARIANT_MAP.get(normalized);
  if (!variantSet) {
    return [keyword];
  }
  return Array.from(variantSet);
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : [value];
}

// الحالات المتاحة للعقارات (استبعاد المباعة والمؤجرة)
const AVAILABLE_STATUSES = ["available", "under-construction", "completed", "planned"];

function buildFilterConditions(filters = {}) {
  const clauses = [];
  
  // ✅ فلترة العقارات المتاحة فقط (استبعاد المباعة والمؤجرة)
  clauses.push({ status: { $in: AVAILABLE_STATUSES } });
  
  if (filters.minPrice || filters.maxPrice) {
    const priceClause = {};
    if (filters.minPrice) priceClause.$gte = Number(filters.minPrice);
    if (filters.maxPrice) priceClause.$lte = Number(filters.maxPrice);
    clauses.push({ price: priceClause });
  }
  if (filters.type) {
    clauses.push({ type: filters.type });
  }
  if (filters.bedrooms) {
    // مطابقة دقيقة لعدد الغرف
    clauses.push({ bedrooms: { $eq: Number(filters.bedrooms) } });
  }
  // ✅ فلتر المساحة
  if (filters.minArea || filters.maxArea) {
    const areaClause = {};
    if (filters.minArea) areaClause.$gte = Number(filters.minArea);
    if (filters.maxArea) areaClause.$lte = Number(filters.maxArea);
    clauses.push({ area: areaClause });
  }
  const cityValues = toArray(filters.city);
  if (cityValues.length) {
    clauses.push({
      "location.city": {
        $in: cityValues.map((city) => new RegExp(`^${escapeRegExp(city)}$`, "i")),
      },
    });
  }
  if (filters.area && !filters.minArea && !filters.maxArea) {
    // هذا للموقع (المنطقة) وليس المساحة
    const areaValues = toArray(filters.area);
    clauses.push({
      "location.area": {
        $in: areaValues.map((area) => new RegExp(`^${escapeRegExp(area)}$`, "i")),
      },
    });
  }
  if (filters.listingStatus) {
    clauses.push({ listingStatus: filters.listingStatus });
  }
  return clauses;
}

async function fallbackDatabaseSearch(queryText, filters = {}, limit = 5) {
  const keywords = extractKeywords(queryText);
  
  // ✅ بناء شروط البحث النصي
  const textSearchConditions = [];
  
  // البحث في العنوان والوصف بكل الكلمات المفتاحية
  keywords.forEach((keyword) => {
    const variants = expandKeywordVariants(keyword);
    const regexes = variants.map((variant) => new RegExp(escapeRegExp(variant), "i"));
    regexes.forEach((regex) => {
      textSearchConditions.push({ title: regex });
      textSearchConditions.push({ description: regex });
      textSearchConditions.push({ "location.city": regex });
      textSearchConditions.push({ "location.area": regex });
    });
  });

  const filterConditions = buildFilterConditions(filters);
  
  // ✅ تجربة 1: بحث مع كل الفلاتر والكلمات
  let mongoQuery = {};
  if (filterConditions.length > 0) {
    mongoQuery.$and = filterConditions;
  }
  if (textSearchConditions.length > 0) {
    if (!mongoQuery.$and) mongoQuery.$and = [];
    mongoQuery.$and.push({ $or: textSearchConditions });
  }

  let docs = await Property.find(mongoQuery)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  // ✅ تجربة 2: إذا لم نجد نتائج، ابحث بالفلاتر فقط (بدون keywords)
  if (docs.length === 0 && filterConditions.length > 0) {
    console.log(`ℹ️ No results with keywords, trying filters only...`);
    mongoQuery = { $and: filterConditions };
    docs = await Property.find(mongoQuery)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  // ✅ تجربة 3: إذا لا زلنا لم نجد، ابحث بالكلمات فقط (بدون فلاتر السعر)
  if (docs.length === 0 && textSearchConditions.length > 0) {
    console.log(`ℹ️ No results with filters, trying keywords only...`);
    // فقط فلتر الحالة (استبعاد المباع)
    mongoQuery = {
      $and: [
        { status: { $in: AVAILABLE_STATUSES } },
        { $or: textSearchConditions }
      ]
    };
    docs = await Property.find(mongoQuery)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
  }

  // ✅ تجربة 4: إذا لا زلنا لم نجد، أرجع مصفوفة فارغة بدلاً من عقارات غير مطابقة
  if (docs.length === 0) {
    console.log(`ℹ️ No matching results found, returning empty array`);
    return [];
  }

  console.log(
    `ℹ️ Using fallback property search (${docs.length} results, keywords: ${keywords.join(", ") || "none"})`
  );
  return docs.map((doc) => ({ ...doc, score: doc.score ?? 0 }));
}

function mergeAndLimitResults(primary = [], secondary = [], limit = 5) {
  const seen = new Set();
  const pickId = (item) => {
    if (!item) return null;
    if (item._id) return item._id.toString();
    if (item.id) return item.id.toString();
    return `${item.title || ""}-${item.price || 0}-${item.location?.city || ""}`;
  };

  const result = [];

  const pushItem = (item) => {
    if (!item || result.length >= limit) return;
    const id = pickId(item);
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    result.push(item);
  };

  primary.forEach(pushItem);
  const uniqueSecondary = secondary.filter((item) => {
    const id = pickId(item);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const getTimestamp = (item) =>
    item?.createdAt ? new Date(item.createdAt).getTime() : 0;

  const findOldestIndex = () => {
    if (!result.length) return -1;
    let idx = 0;
    let oldestTs = getTimestamp(result[0]);
    for (let i = 1; i < result.length; i++) {
      const ts = getTimestamp(result[i]);
      if (ts < oldestTs) {
        oldestTs = ts;
        idx = i;
      }
    }
    return idx;
  };

  uniqueSecondary.forEach((item) => {
    if (result.length < limit) {
      result.push(item);
      return;
    }

    const oldestIdx = findOldestIndex();
    if (oldestIdx === -1) return;
    const oldestItem = result[oldestIdx];
    if (getTimestamp(item) > getTimestamp(oldestItem)) {
      result.splice(oldestIdx, 1, item);
    }
  });

  return result.slice(0, limit);
}

async function tryVectorSearch(queryText, limit = 5) {
  try {
    const results = await langchainSearch(queryText, limit);
    if (!Array.isArray(results)) {
      return [];
    }
    return results;
  } catch (error) {
    console.warn("⚠️ Vector search unavailable, using database search only:", error.message);
    return [];
  }
}

/**
 * Search for similar properties using LangChain Vector Store
 * @param {String} queryText - User search query
 * @param {Number} limit - Number of results to return (default: 5)
 * @returns {Promise<Array>} Array of matching properties
 */
async function searchSimilarProperties(queryText, limit = 5) {
  const [vectorResults, fallbackResults] = await Promise.all([
    tryVectorSearch(queryText, limit * 2),
    fallbackDatabaseSearch(queryText, {}, limit * 3),
  ]);

  // ✅ إذا لم يجد vector search نتائج، اعتمد على fallback فقط
  if (vectorResults.length === 0) {
    console.log(`ℹ️ Using fallback results only: ${fallbackResults.length}`);
    return fallbackResults.slice(0, limit);
  }

  const finalResults = mergeAndLimitResults(vectorResults, fallbackResults, limit);
  console.log(`✅ Combined search returned ${finalResults.length} results`);
  return finalResults;
}

/**
 * Search properties with filters + vector search
 * @param {String} queryText - User query
 * @param {Object} filters - Additional filters (price range, type, etc.)
 * @param {Number} limit - Number of results
 * @returns {Promise<Array>} Filtered matching properties
 */
async function searchWithFilters(queryText, filters = {}, limit = 5) {
  console.log(`🔍 searchWithFilters called with query: "${queryText}"`);
  console.log(`📊 Filters received:`, JSON.stringify(filters));
  
  // Get vector results first for semantic relevance
  const [vectorResults, fallbackResults] = await Promise.all([
    tryVectorSearch(queryText, limit * 3),
    fallbackDatabaseSearch(queryText, filters, limit * 3),
  ]);

  const cityRegexes = toArray(filters.city).map(
    (city) => new RegExp(`^${escapeRegExp(city)}$`, "i")
  );

  let filteredResults = vectorResults.filter((property) => {
    // ✅ استبعاد العقارات المباعة أو المؤجرة
    if (property.status && !AVAILABLE_STATUSES.includes(property.status)) return false;
    
    // فلتر السعر
    if (filters.minPrice && property.price < Number(filters.minPrice)) return false;
    if (filters.maxPrice && property.price > Number(filters.maxPrice)) return false;
    
    // فلتر نوع العقار
    if (filters.type && property.type !== filters.type) return false;
    
    // فلتر عدد الغرف
    if (filters.bedrooms && property.bedrooms < Number(filters.bedrooms)) return false;
    
    // ✅ فلتر المساحة
    if (filters.minArea && property.area < Number(filters.minArea)) return false;
    if (filters.maxArea && property.area > Number(filters.maxArea)) return false;
    
    // فلتر المدينة
    if (cityRegexes.length) {
      const cityValue = property.location?.city || "";
      if (!cityRegexes.some((regex) => regex.test(cityValue))) return false;
    }
    return true;
  });

  console.log(`📊 Vector results after filtering: ${filteredResults.length} (from ${vectorResults.length})`);

  filteredResults = filteredResults.slice(0, limit);

  const merged = mergeAndLimitResults(filteredResults, fallbackResults, limit);
  console.log(`ℹ️ Filtered search combined results count ${merged.length}`);
  return merged;
}

module.exports = {
  searchSimilarProperties,
  searchWithFilters,
};

/*
===================================================
📌 LANGCHAIN VECTOR STORE SETUP
===================================================

✅ No MongoDB Atlas Vector Index needed anymore!
✅ Using LangChain MemoryVectorStore with Fireworks AI embeddings
✅ Vector search happens in-memory (faster for small datasets)

📝 NOTES:
===================================================
- Embeddings are stored in-memory using LangChain
- No need to create MongoDB vector indexes
- Fireworks AI embeddings: 512 dimensions
- Properties are automatically added to vector store when generated
- For large datasets, consider using persistent vector stores (Pinecone, Weaviate, etc.)
*/
