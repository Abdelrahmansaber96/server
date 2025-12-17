const mongoose = require("mongoose");

const termsSchema = new mongoose.Schema(
  {
    downPaymentPercent: Number,
    installmentYears: Number,
    cashOffer: Boolean,
    offerType: {
      type: String,
      enum: ["installments", "cash", "rent"],
      default: "installments",
    },
    cashOfferPrice: Number,
    rentBudget: Number,
    rentDurationMonths: Number,
    notes: String,
  },
  { _id: false }
);

const counterOfferSchema = new mongoose.Schema(
  {
    label: String,
    downPaymentPercent: Number,
    installmentYears: Number,
    message: String,
    offerType: {
      type: String,
      enum: ["installments", "cash", "rent"],
    },
    cashAmount: Number,
    rentBudget: Number,
    rentDurationMonths: Number,
  },
  { _id: false }
);

const negotiationSessionSchema = new mongoose.Schema(
  {
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true },
    propertySnapshot: {
      title: String,
      price: Number,
      location: {
        city: String,
        area: String,
      },
      listingStatus: String,
    },
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    buyerOffer: termsSchema,
    sellerTerms: termsSchema,
    buyerCounterOffer: counterOfferSchema,
    sellerCounterOffer: counterOfferSchema,
    intentType: {
      type: String,
      enum: ["installments", "cash", "rent"],
      default: "installments",
    },
    status: {
      type: String,
      enum: ["pending",
    "approved",
    "declined",
    "draft_requested",
    "draft_generated",
    "draft_sent",
    "confirmed"],
      default: "pending",
    },
    decisionBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    decisionAt: Date,
    decisionNotes: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("NegotiationSession", negotiationSessionSchema);
