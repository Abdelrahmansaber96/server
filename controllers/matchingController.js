const Property = require("../models/propertyModel");
const OnboardingPreference = require("../models/onboardingPreferenceModel");
const { searchWithFilters } = require("../ai/services/vector-search.service");

const PROJECT_STAGE_FILTERS = {
  ready: ["available", "completed"],
  under_construction: ["under-construction", "planned"],
};

function buildFilters(preferences = {}) {
  const filters = {};

  if (preferences.budgetEnabled) {
    const priceFilter = {};
    if (preferences.budgetMin != null) priceFilter.$gte = Number(preferences.budgetMin);
    if (preferences.budgetMax != null) priceFilter.$lte = Number(preferences.budgetMax);
    if (Object.keys(priceFilter).length) filters.price = priceFilter;
  }

  if (Array.isArray(preferences.propertyType) && preferences.propertyType.length) {
    filters.type = { $in: preferences.propertyType };
  }

  if (preferences.location) {
    filters["location.city"] = new RegExp(`^${preferences.location}$`, "i");
  }

  if (preferences.areaRange) {
    const rangeMap = {
      "<100": { max: 100 },
      "100-150": { min: 100, max: 150 },
      "150-200": { min: 150, max: 200 },
      ">200": { min: 200 },
    };
    const range = rangeMap[preferences.areaRange];
    if (range) {
      const areaFilter = {};
      if (range.min != null) areaFilter.$gte = range.min;
      if (range.max != null) areaFilter.$lte = range.max;
      if (Object.keys(areaFilter).length) filters.area = areaFilter;
    }
  }

  if (typeof preferences.bedrooms === "number") {
    filters.bedrooms = { $gte: preferences.bedrooms };
  }

  if (Array.isArray(preferences.features) && preferences.features.length) {
    filters.features = { $all: preferences.features };
  }

  if (preferences.projectStagePreference && preferences.projectStagePreference !== "no_preference") {
    const statuses = PROJECT_STAGE_FILTERS[preferences.projectStagePreference];
    if (statuses) {
      filters.status = { $in: statuses };
    }
  }

  return filters;
}

function buildNarrative(preferences = {}) {
  const parts = [];
  if (preferences.location) parts.push(`عقار في ${preferences.location}`);
  if (preferences.propertyType?.length) parts.push(`من نوع ${preferences.propertyType.join(" أو ")}`);
  if (preferences.bedrooms != null) parts.push(`بعدد غرف لا يقل عن ${preferences.bedrooms}`);
  if (preferences.areaRange) parts.push(`بنطاق مساحة ${preferences.areaRange}`);
  if (preferences.paymentPreference) {
    parts.push(
      preferences.paymentPreference === "installments" ? "مناسب للدفع بالتقسيط" : "مناسب للدفع النقدي"
    );
  }
  if (preferences.projectStagePreference && preferences.projectStagePreference !== "no_preference") {
    parts.push(
      preferences.projectStagePreference === "ready" ? "جاهز للتسليم" : "قيد الإنشاء"
    );
  }
  return parts.join(" - ") || "عقار مناسب";
}

function buildMatchReasons(preferences = {}, property = {}) {
  const reasons = [];
  if (preferences.location && property.location?.city) {
    reasons.push(`يقع في ${property.location.city} كما طلبت.`);
  }
  if (preferences.propertyType?.includes(property.type)) {
    reasons.push(`نوع العقار ${property.type} مطابق لتفضيلك.`);
  }
  if (preferences.bedrooms != null && property.bedrooms >= preferences.bedrooms) {
    reasons.push(`يوفر ${property.bedrooms} غرف وهو أعلى من الحد الأدنى.`);
  }
  if (preferences.areaRange && property.area) {
    reasons.push(`المساحة ${property.area} متر² ضمن النطاق المرغوب.`);
  }
  if (preferences.paymentPreference === "installments") {
    reasons.push("يمكننا التفاوض لتوفير خطة تقسيط مناسبة لهذا العقار.");
  }
  if (preferences.projectStagePreference === "ready" && property.status === "completed") {
    reasons.push("العقار جاهز للتسليم حالاً.");
  }
  if (preferences.projectStagePreference === "under_construction" && property.status === "under-construction") {
    reasons.push("العقار قيد الإنشاء كما تفضل.");
  }
  return reasons;
}

exports.getTopMatches = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "buyer") {
      return res.status(403).json({ message: "المطابقة متاحة لحسابات المشترين فقط" });
    }

    const onboarding = await OnboardingPreference.findOne({ user: req.user.id }).lean();
    if (!onboarding || !onboarding.preferences) {
      return res.status(404).json({ message: "فضلًا أكمل استبيان التفضيلات أولاً" });
    }

    const preferences = onboarding.preferences;
    const limit = Math.min(Number(req.query.limit) || 10, 20);
    const filters = buildFilters(preferences);

    let properties = await Property.find(filters)
      .sort({ isFeatured: -1, updatedAt: -1 })
      .limit(limit)
      .lean();

    if (properties.length < limit) {
      const narrative = buildNarrative(preferences);
      try {
        const vectorResults = await searchWithFilters(
          narrative,
          {
            minPrice: filters.price?.$gte,
            maxPrice: filters.price?.$lte,
            type: Array.isArray(preferences.propertyType) && preferences.propertyType.length === 1
              ? preferences.propertyType[0]
              : undefined,
            bedrooms: preferences.bedrooms,
            city: preferences.location,
          },
          limit
        );

        vectorResults.forEach((property) => {
          if (!properties.find((item) => String(item._id) === String(property._id))) {
            properties.push(property);
          }
        });
      } catch (error) {
        console.warn("⚠️ Matching agent vector fallback failed:", error.message);
      }
    }

    properties = properties.slice(0, limit);

    const matches = properties.map((property, index) => {
      const baseScore = property.score != null ? property.score : 0.6;
      const adjustedScore = Math.min(baseScore + (limit - index) * 0.02, 0.98);
      return {
        property,
        score: Number(adjustedScore.toFixed(2)),
        reasons: buildMatchReasons(preferences, property),
      };
    });

    res.json({
      success: true,
      count: matches.length,
      preferences,
      matches,
    });
  } catch (error) {
    console.error("❌ Failed to run matching agent:", error);
    res.status(500).json({ message: "حدث خطأ أثناء توليد الترشيحات" });
  }
};
