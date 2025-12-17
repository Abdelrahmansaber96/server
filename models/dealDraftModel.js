const mongoose = require("mongoose");

const paymentScheduleSchema = new mongoose.Schema(
  {
    downPaymentPercent: Number,
    downPaymentAmount: Number,
    remainingAmount: Number,
    installmentYears: Number,
    monthlyInstallment: Number,
    paymentType: {
      type: String,
      enum: ["cash", "installments", "rent"],
    },
  },
  { _id: false }
);

const reservationPaymentSchema = new mongoose.Schema(
  {
    amount: Number,
    method: { type: String, default: "bank_transfer" },
    currency: { type: String, default: "EGP" },
    reference: String,
    status: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "paid",
    },
    paidAt: Date,
  },
  { _id: false }
);

const dealDraftSchema = new mongoose.Schema(
  {
    buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    property: { type: mongoose.Schema.Types.ObjectId, ref: "Property", required: true },
    negotiation: { type: mongoose.Schema.Types.ObjectId, ref: "NegotiationSession" },
    linkedDeal: { type: mongoose.Schema.Types.ObjectId, ref: "Deal" },
    summary: {
      propertyTitle: String,
      propertyLocation: String,
      meetingDate: Date,
      notes: String,
    },
    price: Number,
    paymentSchedule: paymentScheduleSchema,
    reservationPayment: reservationPaymentSchema,
    reservedAt: Date,
    status: {
      type: String,
      enum: ["draft", "reserved", "cancelled"],
      default: "draft",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("DealDraft", dealDraftSchema);
