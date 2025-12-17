const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    role: {
      type: String,
      enum: ["user", "assistant"],
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const preferencesSchema = new mongoose.Schema(
  {
    budgetMin: Number,
    budgetMax: Number,
    locations: [String],
    propertyTypes: [String],
    bedrooms: Number,
    furnished: {
      type: String,
      enum: ["furnished", "unfurnished", "either"],
    },
    purpose: String,
    extras: [String],
  },
  { _id: false }
);

const aiMemorySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      unique: true,
      required: true,
    },
    preferences: {
      type: preferencesSchema,
      default: {},
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    lastIntent: {
      type: String,
      trim: true,
    },
    conversationHistory: {
      type: [messageSchema],
      default: [],
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("AiMemory", aiMemorySchema);
