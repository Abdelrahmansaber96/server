const mongoose = require("mongoose");

const propertySchema = new mongoose.Schema(
  {
    // 🏠 Common fields (for both sellers & developers)
    title: {
      type: String,
      trim: true,
      minlength: 3,
      maxlength: 150,
    },

    type: {
      type: String,
      enum: ["villa", "apartment", "house", "condo", "townhouse", "project"],
      required: true,
    },

    description: { type: String, maxlength: 2000 },

    location: {
      city: { type: String },
      area: { type: String, trim: true },
      nearBy: [String],
      coordinates: {
        type: { type: String, enum: ["Point"], default: "Point" },
        coordinates: { type: [Number], required: true }, // ⬅️ array of numbers
      },
    },
    price: { type: Number, min: 0 },
    area: { type: Number, min: 0 },
    bedrooms: { type: Number, min: 0, default: 0 },
    bathrooms: { type: Number, min: 0, default: 0 },

    listingStatus: {
      type: String,
      enum: ["sale", "rent", "both"],
    },

    images: {
      type: [String],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "At least one image is required",
      },
    },

    documents: [
      {
        name: { type: String },
        url: { type: String },
      },
    ],

    features: {
      type: [String],
      default: [],
    },

    paymentPlan: {
      paymentType: {
        type: String,
        enum: ["cash", "installments", "both"],
      },
      minDownPaymentPercent: {
        type: Number,
        min: 0,
        max: 100,
      },
      maxInstallmentYears: {
        type: Number,
        min: 0,
      },
      allowInstallments: {
        type: Boolean,
        default: true,
      },
      notes: String,
    },

    isFeatured: {
      type: Boolean,
      default: false,
    },

    aiVerified: {
      type: Boolean,
      default: false,
    },

    verifiedAt: {
      type: Date,
    },

    termsAccepted: {
      type: Boolean,
      default: false,
    },

    // 🧍 Seller field (normal users)
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // 🏗️ Developer project fields
    projectName: { type: String },
    developer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    units: { type: Number, default: 0 },
    completionPercentage: { type: Number, min: 0, max: 100 },
    status: {
      type: String,
      enum: [
        "available",
        "sold",
        "rented",
        "under-construction",
        "completed",
        "planned",
      ],
      default: "available",
    },

    developerInfo: {
      logo: String,
      location: String,
      totalProjects: Number,
      phone: String,
      email: String,
      website: String,
      description: String,
    },

    // 🏠 أنواع الوحدات المتاحة في المشروع (للعرض في التفاصيل)
    unitOptions: [
      {
        label: { type: String }, // مثل "شقة عصرية", "بنتهاوس فاخر"
        size: { type: String }, // مثل "120 م²"
        view: { type: String }, // مثل "إطلالة على الحديقة"
        delivery: { type: String }, // مثل "تسليم 2026"
        price: { type: String }, // مثل "3,200,000 EGP"
        bedrooms: { type: Number, min: 0 },
        bathrooms: { type: Number, min: 0 },
      },
    ],

    // 💳 خطط الدفع المتاحة
    paymentPlans: [
      {
        name: { type: String }, // مثل "خطة 8 سنوات"
        downPayment: { type: String }, // مثل "10% مقدم"
        monthlyInstallment: { type: String }, // مثل "32,000 EGP / شهر"
        duration: { type: String }, // مثل "96 شهر"
      },
    ],

    // 📅 مواعيد التسليم
    deliveryDate: { type: String },

    // 🧩 To differentiate who added it
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    views: { type: Number, default: 0 },

    // 🤖 AI/RAG - Vector embedding field
    embedding: {
      type: [Number],
      select: false, // Don't include in regular queries for performance
    },
  },
  { timestamps: true }
);

// ⚡ Indexes
propertySchema.index({ price: 1 });
propertySchema.index({ "location.city": 1 });
propertySchema.index({ bedrooms: 1 });
propertySchema.index({ isFeatured: 1 });
propertySchema.index({ "location.coordinates": "2dsphere" });

module.exports = mongoose.model("Property", propertySchema);
