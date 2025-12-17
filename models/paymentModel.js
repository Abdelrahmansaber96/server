const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    contract: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contract",
      required: true,
      index: true,
    },
    payer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: "EGP" },

    method: {
      type: String,
      enum: ["Fawry", "Paymob", "Visa", "Cash"],
      required: true,
    },

    status: {
      type: String,
      enum: ["pending", "success", "failed"],
      default: "pending",
      index: true,
    },

    transactionId: { type: String, trim: true }, // من بوابة الدفع
    dueDate: { type: Date }, // لو قسط
    paidAt: { type: Date }, // لو الدفع تم فعليًا
  },
  { timestamps: true }
);

module.exports = mongoose.model("Payment", paymentSchema);
