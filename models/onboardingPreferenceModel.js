const mongoose = require("mongoose");

const preferenceSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      required: true,
      index: true,
    },
    hasCompleted: {
      type: Boolean,
      default: false,
    },
    skipped: {
      type: Boolean,
      default: false,
    },
    preferences: {
      budgetEnabled: Boolean,
      budgetMin: Number,
      budgetMax: Number,
      propertyType: {
        type: [String],
        default: [],
      },
      purpose: String,
      location: String,
      areaRange: String,
      bedrooms: Number,
      paymentPreference: {
        type: String,
        enum: ['cash', 'installments'],
      },
      projectStagePreference: {
        type: String,
        enum: ['ready', 'under_construction', 'no_preference'],
      },
      features: {
        type: [String],
        default: [],
      },
    },
    recommendations: {
      type: [mongoose.Schema.Types.Mixed],
      default: [],
    },
    lastAiPrompt: String,
    lastAiSource: {
      type: String,
      default: "onboarding",
    },
    lastCompletedAt: Date,
  },
  { timestamps: true }
);

module.exports = mongoose.model("OnboardingPreference", preferenceSchema);
