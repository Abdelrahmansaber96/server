const OnboardingPreference = require("../models/onboardingPreferenceModel");

const sanitizePreferences = (preferences = {}) => ({
  budgetEnabled: Boolean(preferences.budgetEnabled),
  budgetMin:
    preferences.budgetMin !== undefined && preferences.budgetMin !== null
      ? Number(preferences.budgetMin)
      : null,
  budgetMax:
    preferences.budgetMax !== undefined && preferences.budgetMax !== null
      ? Number(preferences.budgetMax)
      : null,
  propertyType: Array.isArray(preferences.propertyType)
    ? preferences.propertyType
    : [],
  purpose: preferences.purpose || "",
  location: preferences.location || "",
  areaRange: preferences.areaRange || "",
  bedrooms:
    preferences.bedrooms !== undefined && preferences.bedrooms !== null
      ? Number(preferences.bedrooms)
      : null,
  paymentPreference: preferences.paymentPreference || "",
  projectStagePreference: preferences.projectStagePreference || "",
  features: Array.isArray(preferences.features) ? preferences.features : [],
});

exports.getMyOnboarding = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const onboarding = await OnboardingPreference.findOne({ user: userId }).lean();

    res.json({
      success: true,
      onboarding,
    });
  } catch (error) {
    console.error("❌ Failed to fetch onboarding preferences:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch onboarding preferences",
    });
  }
};

exports.saveOrUpdate = async (req, res) => {
  try {
    const userId = req.user?.id;
    const role = req.user?.role;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    if (role && role !== "buyer") {
      return res.status(403).json({
        message: "Only buyers can save onboarding preferences",
      });
    }

    const { preferences, recommendations, skipped, source, prompt } = req.body || {};

    if (!skipped && !preferences) {
      return res.status(400).json({
        message: "Preferences payload is required unless skipping",
      });
    }

    const updatePayload = {
      hasCompleted: true,
      skipped: Boolean(skipped),
      lastAiSource: source || "onboarding",
      lastAiPrompt: prompt || null,
      lastCompletedAt: new Date(),
    };

    if (skipped) {
      updatePayload.preferences = null;
      updatePayload.recommendations = [];
    } else {
      updatePayload.preferences = sanitizePreferences(preferences);
      updatePayload.recommendations = Array.isArray(recommendations)
        ? recommendations
        : [];
    }

    const onboarding = await OnboardingPreference.findOneAndUpdate(
      { user: userId },
      { $set: updatePayload, $setOnInsert: { user: userId } },
      { new: true, upsert: true }
    ).lean();

    res.json({
      success: true,
      onboarding,
    });
  } catch (error) {
    console.error("❌ Failed to save onboarding preferences:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to save onboarding preferences",
    });
  }
};
