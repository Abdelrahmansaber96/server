const mongoose = require("mongoose");

/**
 * Unit Model - الوحدات العقارية داخل مشاريع المطورين
 * كل وحدة تنتمي لمشروع (Property with type='project')
 */
const unitSchema = new mongoose.Schema(
  {
    // 🔗 المشروع الأب
    project: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
      index: true,
    },

    // 🏠 بيانات الوحدة الأساسية
    unitNumber: {
      type: String,
      required: true,
      trim: true,
    },
    
    unitType: {
      type: String,
      enum: ["apartment", "villa", "duplex", "penthouse", "studio", "townhouse", "office", "shop", "other"],
      default: "apartment",
    },

    floor: {
      type: Number,
      min: -5, // للأدوار السفلية/جراجات
      max: 200,
    },

    // 📐 المساحة والغرف
    area: {
      type: Number,
      required: true,
      min: 10,
    },

    bedrooms: {
      type: Number,
      min: 0,
      default: 1,
    },

    bathrooms: {
      type: Number,
      min: 0,
      default: 1,
    },

    // 💰 التسعير
    price: {
      type: Number,
      required: true,
      min: 0,
    },

    pricePerMeter: {
      type: Number,
      min: 0,
    },

    // 💳 خطة الدفع
    paymentPlan: {
      paymentType: {
        type: String,
        enum: ["cash", "installments", "both"],
        default: "both",
      },
      minDownPaymentPercent: {
        type: Number,
        min: 0,
        max: 100,
        default: 10,
      },
      maxInstallmentYears: {
        type: Number,
        min: 0,
        max: 30,
        default: 7,
      },
      monthlyInstallment: {
        type: Number,
        min: 0,
      },
      cashDiscount: {
        type: Number,
        min: 0,
        max: 100,
        default: 0,
      },
      notes: String,
    },

    // 📊 الحالة
    status: {
      type: String,
      enum: ["available", "booked", "sold", "reserved", "under_contract"],
      default: "available",
      index: true,
    },

    // 🎨 المميزات والوصف
    features: {
      type: [String],
      default: [],
    },

    view: {
      type: String,
      enum: ["garden", "street", "sea", "pool", "city", "landscape", "corner", "main_facade", "other"],
    },

    finishing: {
      type: String,
      enum: ["core_shell", "semi_finished", "fully_finished", "super_lux", "ultra_lux"],
      default: "fully_finished",
    },

    description: {
      type: String,
      maxlength: 1000,
    },

    // 🖼️ الصور
    images: {
      type: [String],
      default: [],
    },

    floorPlan: {
      type: String, // URL للمخطط
    },

    // 📅 التسليم
    deliveryDate: {
      type: Date,
    },

    isReady: {
      type: Boolean,
      default: false,
    },

    // 👤 الحجز الحالي (لو محجوزة)
    currentBooking: {
      buyer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      bookedAt: Date,
      expiresAt: Date,
      depositAmount: Number,
      depositPaid: {
        type: Boolean,
        default: false,
      },
    },

    // 📈 إحصائيات
    views: {
      type: Number,
      default: 0,
    },

    inquiries: {
      type: Number,
      default: 0,
    },

    // 🤖 AI/RAG - Vector embedding
    embedding: {
      type: [Number],
      select: false,
    },
  },
  { timestamps: true }
);

// ⚡ Indexes
unitSchema.index({ project: 1, status: 1 });
unitSchema.index({ price: 1 });
unitSchema.index({ area: 1 });
unitSchema.index({ bedrooms: 1 });
unitSchema.index({ "paymentPlan.minDownPaymentPercent": 1 });

// 🔄 Pre-save: حساب السعر لكل متر تلقائياً
unitSchema.pre("save", function (next) {
  if (this.price && this.area) {
    this.pricePerMeter = Math.round(this.price / this.area);
  }
  next();
});

// 📊 Static: إحصائيات الوحدات لمشروع معين
unitSchema.statics.getProjectStats = async function (projectId) {
  const stats = await this.aggregate([
    { $match: { project: new mongoose.Types.ObjectId(projectId) } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalValue: { $sum: "$price" },
        avgPrice: { $avg: "$price" },
        minPrice: { $min: "$price" },
        maxPrice: { $max: "$price" },
      },
    },
  ]);

  const result = {
    total: 0,
    available: 0,
    booked: 0,
    sold: 0,
    reserved: 0,
    totalValue: 0,
    soldValue: 0,
    bookedValue: 0,
    priceRange: { min: 0, max: 0, avg: 0 },
  };

  stats.forEach((s) => {
    result.total += s.count;
    result[s._id] = s.count;
    result.totalValue += s.totalValue;

    if (s._id === "sold") result.soldValue = s.totalValue;
    if (s._id === "booked") result.bookedValue = s.totalValue;

    if (!result.priceRange.min || s.minPrice < result.priceRange.min) {
      result.priceRange.min = s.minPrice;
    }
    if (s.maxPrice > result.priceRange.max) {
      result.priceRange.max = s.maxPrice;
    }
  });

  if (result.total > 0) {
    result.priceRange.avg = Math.round(result.totalValue / result.total);
  }

  return result;
};

module.exports = mongoose.model("Unit", unitSchema);
