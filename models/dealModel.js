const mongoose = require("mongoose");

const depositPaymentSchema = new mongoose.Schema(
  {
    amount: Number,
    method: { type: String, default: "manual" },
    currency: { type: String, default: "EGP" },
    reference: String,
    status: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    paidAt: Date,
  },
  { _id: false }
);

const dealSchema = new mongoose.Schema(
  {
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
      index: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    negotiation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NegotiationSession",
      index: true,
    },

    offerPrice: { type: Number, min: 0 },
    finalPrice: { type: Number, min: 0 }, // السعر اللي اتفقوا عليه

    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "cancelled", "closed"],
      default: "pending",
      index: true,
    },

    expiresAt: { type: Date }, // العرض ينتهي امتى

    messages: [
      {
        sender: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String, trim: true },
        sentAt: { type: Date, default: Date.now },
      },
    ],

    // Optional reservation context for developer project bookings
    reservation: {
      unitLabel: String,
      unitSize: String,
      planName: String,
      downPayment: String,
      monthlyInstallment: String,
      note: String,
    },

    // Buyer contact details (so developers can follow up on inquiries)
    buyerContact: {
      name: String,
      phone: String,
      email: String,
      message: String,
    },

    depositPayment: depositPaymentSchema,

    contract: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Contract",
    }, // لو الصفقة خلصت بعقد
  },
  { timestamps: true }
);

module.exports = mongoose.model("Deal", dealSchema);
