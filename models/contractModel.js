const mongoose = require("mongoose");

const contractSchema = new mongoose.Schema(
  {
    contractNumber: { type: String, unique: true, index: true }, // مرجع خارجي للعقد

    deal: { type: mongoose.Schema.Types.ObjectId, ref: "Deal", required: true },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    seller: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    property: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Property",
      required: true,
    },

    totalPrice: { type: Number, required: true, min: 0 },

    paymentPlan: [
      {
        amount: { type: Number, required: true, min: 0 },
        dueDate: { type: Date, required: true },
        status: {
          type: String,
          enum: ["pending", "paid", "overdue"],
          default: "pending",
        },
        paidAt: { type: Date },
        method: {
          type: String,
          enum: ["Fawry", "Paymob", "Visa", "Cash"],
        },
      },
    ],

    status: {
      type: String,
      enum: ["draft", "active", "completed", "cancelled"],
      default: "draft",
    },

    signed: {
      buyer: { type: Boolean, default: false },
      seller: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Contract", contractSchema);
