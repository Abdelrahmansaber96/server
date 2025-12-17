const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["success", "info", "warning", "error"],
      default: "info",
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    read: { type: Boolean, default: false },

    // 👇 إضافة recipient للـ user محدد
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true, // 👈 مهم جداً
    },

    recipientRole: {
      type: String,
      enum: ["buyer", "seller", "real_estate_developer", "all", "admin"],
      default: "all",
    },

    referenceId: { type: mongoose.Schema.Types.ObjectId, default: null },

    // 👇 إضافة reference type عشان نعرف نوع الـ reference
    referenceType: {
      type: String,
      enum: [
        "property",
        "deal",
        "contract",
        "negotiation",
        "draft",
        "payment",
        "user", // ⬅️ أضفها هنا
        "system", // ⬅️ ممكن تحتاج دي كمان
      ],
      default: null,
    },
  },
  { timestamps: true }
);

// 👇 Index للبحث السريع
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });

module.exports = mongoose.model("Notification", notificationSchema);
