const Payment = require("../models/paymentModel");
const Contract = require("../models/contractModel");
const { createNotification } = require("./notificationController");


// Create a payment record
exports.createPayment = async (req, res) => {
  try {
    const { contract: contractId, amount, method } = req.body;
    const payer = req.user?.id; // نخليها من الـ JWT فقط عشان الأمان

    if (!contractId || !payer || !amount || !method) {
      return res
        .status(400)
        .json({ message: "contract, payer, amount and method are required" });
    }

    // Verify contract exists
    const contract = await Contract.findById(contractId);
    if (!contract) {
      return res.status(404).json({ message: "Contract not found" });
    }

    // Create payment
    const payment = new Payment({
      contract: contractId,
      payer,
      amount,
      method,
      status: "pending",
    });
    await payment.save();

    res.status(201).json({ message: "Payment created", payment });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Update payment status
exports.updatePaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!["pending", "success", "failed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const payment = await Payment.findById(id);
    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    // Authorization check → بس صاحب الـ payment يقدر يعدل
    if (payment.payer.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Not authorized to update this payment" });
    }

    payment.status = status;
    await payment.save();

    // =============================
    // 🔔 إشعارات + مزامنة العقد
    // =============================
    if (payment.contract) {
      const contract = await Contract.findById(payment.contract)
        .populate("buyer")
        .populate("seller")
        .populate("property");

      if (contract) {
        const buyerName = contract.buyer?.name || "Buyer";
        const amount = payment.amount.toLocaleString();

        // ✅ عند نجاح الدفع
        if (status === "success") {
          // 🔔 إشعار للبائع / المطور
          await createNotification({
            type: "success",
            title: "Payment Received",
            message: `${buyerName} paid ${amount} EGP.`,
            recipient: contract.seller._id,
            recipientRole: contract.property?.developer
              ? "real_estate_developer"
              : "seller",
            referenceId: payment._id,
            referenceType: "payment",
          });

          // 🔄 تحديث installment في العقد
          const idx = contract.paymentPlan.findIndex(
            (p) => p.status === "pending" && p.amount === payment.amount
          );

          if (idx >= 0) {
            contract.paymentPlan[idx].status = "paid";
            await contract.save();
          }
        }

        // ❌ عند فشل الدفع
        if (status === "failed") {
          await createNotification({
            type: "error",
            title: "Payment Failed",
            message: `Payment of ${amount} EGP has failed.`,
            recipient: contract.buyer._id,
            recipientRole: "buyer",
            referenceId: payment._id,
            referenceType: "payment",
          });
        }
      }
    }

    res.json({ message: "Payment status updated", payment });
  } catch (err) {
    console.error("Error updating payment status:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};


// Get payments (by user or contract)
exports.getPayments = async (req, res) => {
  try {
    const { contractId } = req.query;

    const filter = {};
    if (contractId) filter.contract = contractId;

    // دايمًا المستخدم يشوف بس الـ payments بتاعته
    filter.payer = req.user.id;

    const payments = await Payment.find(filter)
      .populate("contract", "totalPrice buyer seller")
      .sort({ createdAt: -1 });

    res.json(payments);
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
