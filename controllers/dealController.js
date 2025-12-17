const Deal = require("../models/dealModel");
const Property = require("../models/propertyModel");
const { createNotification } = require("./notificationController");
const User = require("../models/userModel");
// Create a deal (offer)
exports.createDeal = async (req, res) => {
  try {
    const {
      property: propertyId,
      offerPrice,
      reservation,
      contact,
      message,
    } = req.body;
    const buyerId = req.user?.id; // ناخدها من الـ JWT بس للأمان

    if (!propertyId || !buyerId) {
      return res
        .status(400)
        .json({ message: "property and buyer are required" });
    }

    // تأكد إن الـ property موجود
    const property = await Property.findById(propertyId);
    if (!property) {
      return res.status(404).json({ message: "Property not found" });
    }

    // seller من العقار نفسه (أو المطور لو مشروع)
    const seller = property.seller || property.developer;

    if (!seller) {
      return res.status(400).json({
        message: "Property does not have an assigned seller/developer",
      });
    }

    // ما ينفعش المشتري يبقى نفسو البائع
    if (seller.toString() === buyerId) {
      return res
        .status(400)
        .json({ message: "Seller cannot create a deal with themselves" });
    }

    const numericOffer =
      typeof offerPrice === "number"
        ? offerPrice
        : Number(
            String(offerPrice || property.price || 0)
              .toString()
              .replace(/[^0-9.]/g, "")
          ) || 0;

    const deal = new Deal({
      property: propertyId,
      buyer: buyerId,
      seller,
      offerPrice: numericOffer,
      status: "pending",
      reservation: reservation || undefined,
      buyerContact: contact
        ? {
            name: contact.name,
            phone: contact.phone,
            email: contact.email,
            message: contact.message,
          }
        : undefined,
    });

    if (message) {
      deal.messages.push({ sender: buyerId, text: message });
    }

    await deal.save();
    // 🔔 إشعار للبائع/المطور
    // const property = await Property.findById(propertyId)
    //   .populate("seller")
    //   .populate("developer");

    const sellerId = seller;
    const sellerRole = property.developer ? "real_estate_developer" : "seller";
    const buyerUser = await User.findById(buyerId);
    const buyerName = buyerUser.name || buyerUser.email || "Buyer";
    const propertyTitle = property.projectName || property.title || "Property";

    await createNotification({
      type: "info",
      title: "New Deal Offer",
      message: `${buyerName} made an offer of ${numericOffer.toLocaleString()} EGP on your ${
        property.developer ? "project" : "property"
      }: ${propertyTitle}`,
      recipient: sellerId,
      recipientRole: sellerRole,
      referenceId: deal._id,
      referenceType: "deal",
    });

    res.status(201).json({ message: "Deal created", deal });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get deals for a user (buyer or seller)
exports.getDealsForUser = async (req, res) => {
  try {
    const userId = req.user?.id; // من التوكن بس

    const deals = await Deal.find({
      $or: [{ buyer: userId }, { seller: userId }],
    })
      .populate("property")
      .populate("buyer", "name email")
      .populate("seller", "name email")
      .sort({ createdAt: -1 });

    res.json(deals);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

// Get deal by id
exports.getDealById = async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id)
      .populate("property")
      .populate("buyer", "name email")
      .populate("seller", "name email")
      .populate("messages.sender", "name email");

    if (!deal) return res.status(404).json({ message: "Deal not found" });

    // تحقق إن المستخدم طرف في الصفقة (buyer أو seller)
    if (
      deal.buyer.toString() !== req.user.id &&
      deal.seller.toString() !== req.user.id
    ) {
      return res
        .status(403)
        .json({ message: "Not authorized to view this deal" });
    }

    res.json(deal);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

// Add message to deal
exports.sendMessage = async (req, res) => {
  try {
    const deal = await Deal.findById(req.params.id);
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    // تحقق إن المرسل طرف في الصفقة
    if (
      deal.buyer.toString() !== req.user.id &&
      deal.seller.toString() !== req.user.id
    ) {
      return res
        .status(403)
        .json({ message: "Not authorized to send messages in this deal" });
    }

    const text = req.body.text;
    if (!text) return res.status(400).json({ message: "Text is required" });

    deal.messages.push({ sender: req.user.id, text });
    await deal.save();

    res.json({ message: "Message sent", messages: deal.messages });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

// Update deal status (accept/reject)
exports.updateDealStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!["pending", "accepted", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const deal = await Deal.findById(req.params.id);
    if (!deal) return res.status(404).json({ message: "Deal not found" });

    // بس البائع يقدر يغير الحالة
    if (deal.seller.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ message: "Only the seller can update deal status" });
    }

    deal.status = status;
    await deal.save();
    // 🔔 إشعار للمشتري
    const sellerUser = await User.findById(deal.seller);
    const property = await Property.findById(deal.property);
    const sellerName = sellerUser.name || sellerUser.email || "Seller";
    const propertyTitle =
      property?.projectName || property?.title || "Property";

    await createNotification({
      type: status === "accepted" ? "success" : "warning",
      title: status === "accepted" ? "Deal Accepted" : "Deal Rejected",
      message:
        status === "accepted"
          ? `${sellerName} accepted your deal on ${propertyTitle}.`
          : `${sellerName} rejected your deal on ${propertyTitle}.`,
      recipient: deal.buyer,
      recipientRole: "buyer",
      referenceId: deal._id,
      referenceType: "deal",
    });
    // إذا تم قبول الصفقة وفيه إيداع مدفوع، إنشاء العقد تلقائياً
    if (
      status === "accepted" &&
      deal.depositPayment?.status === "paid" &&
      !deal.contract
    ) {
      const Contract = require("../models/contractModel");

      const finalPrice = deal.finalPrice || deal.offerPrice;
      const depositAmount = deal.depositPayment.amount || 0;
      const remainingAmount = finalPrice - depositAmount;

      // إنشاء خطة دفع أساسية (3 أقساط)
      const installments = 3;
      const installmentAmount = Math.round(remainingAmount / installments);
      const paymentPlan = [];

      for (let i = 0; i < installments; i++) {
        paymentPlan.push({
          amount:
            i === installments - 1
              ? remainingAmount - installmentAmount * (installments - 1)
              : installmentAmount,
          dueDate: new Date(Date.now() + (i + 1) * 30 * 24 * 60 * 60 * 1000),
          status: "pending",
        });
      }

      const contract = await Contract.create({
        contractNumber: `CON-${Date.now()}-${deal._id.toString().slice(-6)}`,
        deal: deal._id,
        buyer: deal.buyer,
        seller: deal.seller,
        property: deal.property,
        totalPrice: finalPrice,
        paymentPlan,
        status: "draft",
      });

      deal.contract = contract._id;
      await deal.save();
    }

    res.json({ message: "Deal updated", deal });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
