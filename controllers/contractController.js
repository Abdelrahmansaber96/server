const Contract = require("../models/contractModel");
const Deal = require("../models/dealModel");
const Property = require("../models/propertyModel");
const { createNotification } = require("./notificationController");
// Create contract (only from an accepted deal)
exports.createContract = async (req, res) => {
  try {
    const { deal: dealId, totalPrice, paymentPlan } = req.body;
    const deal = await Deal.findById(dealId);
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    // deal لازم يكون مقبول
    if (deal.status !== "accepted") {
      return res
        .status(400)
        .json({ message: "Deal must be accepted before creating a contract" });
    }

    // تحقق إن المستخدم هو buyer أو seller
    if (
      deal.buyer.toString() !== req.user.id &&
      deal.seller.toString() !== req.user.id
    ) {
      return res
        .status(403)
        .json({ message: "Not authorized to create contract for this deal" });
    }

    const contract = new Contract({
      deal: dealId,
      buyer: deal.buyer,
      seller: deal.seller,
      property: deal.property,
      totalPrice,
      paymentPlan: Array.isArray(paymentPlan) ? paymentPlan : [],
    });

    await contract.save();
    res.status(201).json({ message: "Contract created", contract });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get contracts for a user
exports.getContractsForUser = async (req, res) => {
  try {
    const userId = req.user?.id;

    const contracts = await Contract.find({
      $or: [{ buyer: userId }, { seller: userId }],
    })
      .populate("deal property buyer seller")
      .sort({ createdAt: -1 });

    res.json(contracts);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

// Sign contract (buyer/seller sign separately)
exports.signContract = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id)
      .populate("deal")
      .populate("property")
      .populate("buyer")
      .populate("seller");

    if (!contract)
      return res.status(404).json({ message: "Contract not found" });

    const signerName = req.user.name || req.user.email || "User";

    // =============================
    // Buyer signs
    // =============================
    if (contract.buyer._id.toString() === req.user.id) {
      contract.signed.buyer = true;

      // 🔔 إشعار للبائع
      await createNotification({
        type: "success",
        title: "Contract Signed by Buyer",
        message: `${signerName} signed the contract.`,
        recipient: contract.seller._id,
        recipientRole: contract.property?.developer
          ? "real_estate_developer"
          : "seller",
        referenceId: contract._id,
        referenceType: "contract",
      });

    // =============================
    // Seller signs
    // =============================
    } else if (contract.seller._id.toString() === req.user.id) {
      contract.signed.seller = true;

      // 🔔 إشعار للمشتري
      await createNotification({
        type: "success",
        title: "Contract Signed by Seller",
        message: `${signerName} signed the contract.`,
        recipient: contract.buyer._id,
        recipientRole: "buyer",
        referenceId: contract._id,
        referenceType: "contract",
      });

    } else {
      return res
        .status(403)
        .json({ message: "Not authorized to sign this contract" });
    }

    await contract.save();

    // =============================
    // لو الطرفين وقعوا
    // =============================
    if (contract.signed.buyer && contract.signed.seller) {
      const propertyId = contract.property?._id || contract.property;

      if (propertyId) {
        const listingStatus = contract.property?.listingStatus;

        // rented لو إيجار، غير كده sold
        const newStatus = listingStatus === "rent" ? "rented" : "sold";

        await Property.findByIdAndUpdate(propertyId, {
          status: newStatus,
        });

        // 🔔 إشعار للطرفين بإتمام العقد
        await Promise.all([
          createNotification({
            type: "success",
            title: "Contract Completed",
            message: `Contract has been fully signed. The property is now ${newStatus}.`,
            recipient: contract.buyer._id,
            recipientRole: "buyer",
            referenceId: contract._id,
            referenceType: "contract",
          }),
          createNotification({
            type: "success",
            title: "Contract Completed",
            message: `Contract has been fully signed. The property is now ${newStatus}.`,
            recipient: contract.seller._id,
            recipientRole: contract.property?.developer
              ? "real_estate_developer"
              : "seller",
            referenceId: contract._id,
            referenceType: "contract",
          }),
        ]);

        console.log(
          `✅ Property ${propertyId} marked as ${newStatus} after contract signing`
        );
      }
    }

    res.json({ message: "Contract signed", contract });
  } catch (err) {
    console.error("Error signing contract:", err);
    res.status(500).json({ message: "Server error" });
  }
};


// Mark installment as paid (only buyer or seller)
exports.markPaymentPlanItemPaid = async (req, res) => {
  try {
    const { contractId, paymentIndex } = req.params;
    const contract = await Contract.findById(contractId);
    if (!contract)
      return res.status(404).json({ message: "Contract not found" });

    // تحقق إن اللي بيعدل طرف في العقد
    if (
      contract.buyer.toString() !== req.user.id &&
      contract.seller.toString() !== req.user.id
    ) {
      return res
        .status(403)
        .json({ message: "Not authorized to update payments" });
    }

    const idx = Number(paymentIndex);
    if (!contract.paymentPlan[idx]) {
      return res.status(400).json({ message: "Payment item not found" });
    }

    // buyer هو اللي بيدفع
    if (contract.buyer.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Only the buyer can mark payments as paid" });
    }

    contract.paymentPlan[idx].status = "paid";
    await contract.save();

    res.json({ message: "Payment item marked as paid", contract });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
