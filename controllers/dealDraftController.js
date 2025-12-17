const DealDraft = require("../models/dealDraftModel");
const NegotiationSession = require("../models/negotiationSessionModel");
const Property = require("../models/propertyModel");
const Deal = require("../models/dealModel");
require("../models/userModel");
const { createNotification } = require("./notificationController");

const DEFAULT_PAYMENT_METHOD = "bank_transfer";
const PAYMENT_INSTRUCTIONS = {
  bank_transfer:
    "قم بتحويل العربون لحساب البائع البنكي ثم ارفع إيصال التحويل داخل لوحة التحكم خلال 24 ساعة.",
  manual:
    "تم تسجيل العربون. يرجى مشاركة إيصال الدفع مع البائع عبر الدردشة أو البريد الإلكتروني.",
  cash: "يرجى التنسيق مع البائع لتسليم العربون نقداً خلال 24 ساعة وإرفاق إيصال الاستلام.",
};

const getPaymentInstructions = (method) =>
  PAYMENT_INSTRUCTIONS[method] || PAYMENT_INSTRUCTIONS[DEFAULT_PAYMENT_METHOD];

const getDocumentId = (value) => {
  if (!value) return null;
  if (typeof value === "object") {
    return value._id || value.id || null;
  }
  return value;
};

const loadDealDetails = async (dealId) => {
  if (!dealId) return null;
  return Deal.findById(dealId)
    .populate("property")
    .populate("buyer", "name email")
    .populate("seller", "name email");
};

const findExistingDealForDraft = async (draft) => {
  const negotiationId = getDocumentId(draft.negotiation);
  if (negotiationId) {
    const deal = await Deal.findOne({ negotiation: negotiationId });
    if (deal) return deal;
  }

  const propertyId = getDocumentId(draft.property);
  const buyerId = getDocumentId(draft.buyer);
  const sellerId = getDocumentId(draft.seller);

  if (propertyId && buyerId && sellerId) {
    return Deal.findOne({
      property: propertyId,
      buyer: buyerId,
      seller: sellerId,
    }).sort({ createdAt: -1 });
  }

  return null;
};

const ensureLinkedDealReference = async (draft) => {
  if (!draft || draft.status !== "reserved" || draft.linkedDeal) {
    return draft;
  }

  const existingDeal = await findExistingDealForDraft(draft);
  if (existingDeal?._id) {
    draft.linkedDeal = existingDeal._id;
    await draft.save();
  }

  return draft;
};

const ensureDealForReservedDraft = async (draft) => {
  let deal = await findExistingDealForDraft(draft);
  if (deal) return deal;

  const fallbackAmount =
    draft.paymentSchedule?.downPaymentAmount ||
    Math.round((draft.price || 0) * 0.1);

  const paymentRecord = draft.reservationPayment || {
    amount: fallbackAmount,
    method: DEFAULT_PAYMENT_METHOD,
    currency: "EGP",
    reference: `AUTO-RSV-${Date.now()}`,
    status: "paid",
    paidAt: draft.reservedAt || new Date(),
  };

  deal = await Deal.create({
    property: getDocumentId(draft.property),
    buyer: getDocumentId(draft.buyer),
    seller: getDocumentId(draft.seller),
    negotiation: getDocumentId(draft.negotiation),
    offerPrice: draft.price,
    finalPrice: draft.price,
    status: "pending",
    depositPayment: paymentRecord,
  });

  return deal;
};

function computeSchedule(property, negotiation) {
  const propertyPrice =
    property.price || negotiation?.propertySnapshot?.price || 0;
  const offerType =
    negotiation?.buyerOffer?.offerType ||
    negotiation?.intentType ||
    (negotiation?.buyerOffer?.cashOffer ? "cash" : "installments");

  if (offerType === "rent") {
    const monthlyRent = negotiation?.buyerOffer?.rentBudget || propertyPrice;
    const months = negotiation?.buyerOffer?.rentDurationMonths || 12;
    return {
      downPaymentPercent: 0,
      downPaymentAmount: monthlyRent,
      remainingAmount: monthlyRent * months,
      installmentYears: months / 12,
      monthlyInstallment: monthlyRent,
      paymentType: "rent",
    };
  }

  if (offerType === "cash") {
    // ✅ استخدام سعر الكاش المقترح من المشتري بدلاً من سعر العقار الرسمي
    const cashPrice = negotiation?.buyerOffer?.cashOfferPrice || propertyPrice;
    return {
      downPaymentPercent: 100,
      downPaymentAmount: cashPrice,
      remainingAmount: 0,
      installmentYears: 0,
      monthlyInstallment: 0,
      paymentType: "cash",
      originalPrice: propertyPrice,
      agreedPrice: cashPrice,
    };
  }

  const downPercent =
    negotiation?.buyerCounterOffer?.downPaymentPercent ||
    negotiation?.buyerOffer?.downPaymentPercent ||
    10;
  const years =
    negotiation?.buyerCounterOffer?.installmentYears ||
    negotiation?.buyerOffer?.installmentYears ||
    3;
  const downPaymentAmount = Math.round(propertyPrice * (downPercent / 100));
  const remainingAmount = propertyPrice - downPaymentAmount;
  const months = years * 12 || 1;
  const monthlyInstallment = Math.round(remainingAmount / months);

  return {
    downPaymentPercent: downPercent,
    downPaymentAmount,
    remainingAmount,
    installmentYears: years,
    monthlyInstallment,
    paymentType: "installments",
  };
}

exports.createDraftFromNegotiation = async (req, res) => {
  try {
    const { negotiationId } = req.body;
    if (!negotiationId) {
      return res.status(400).json({ message: "رقم جلسة التفاوض مطلوب" });
    }

    const negotiation = await NegotiationSession.findOne({
      _id: negotiationId,
      buyer: req.user.id,
    }).populate("property");
    if (!negotiation) {
      return res
        .status(404)
        .json({ message: "لم يتم العثور على جلسة التفاوض" });
    }

    if (negotiation.status !== "approved") {
      return res
        .status(409)
        .json({ message: "لا يمكن إنشاء عقد قبل موافقة البائع" });
    }

    const property = negotiation.property;
    const schedule = computeSchedule(property, negotiation);

    // Determine the agreed price based on offer type
    const offerType = negotiation?.buyerOffer?.offerType || "installments";
    let agreedPrice = property.price; // fallback
    if (offerType === "cash" && negotiation?.buyerOffer?.cashOfferPrice) {
      agreedPrice = negotiation.buyerOffer.cashOfferPrice;
    } else if (offerType === "rent" && negotiation?.buyerOffer?.rentBudget) {
      agreedPrice = negotiation.buyerOffer.rentBudget;
    }

    const draft = await DealDraft.create({
      buyer: req.user.id,
      seller: negotiation.seller,
      property: property._id,
      negotiation: negotiation._id,
      summary: {
        propertyTitle: property.title,
        propertyLocation: `${property.location?.city || ""} ${
          property.location?.area || ""
        }`.trim(),
        meetingDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        notes:
          "تم توليد العقد بواسطة الوكيل الذكي بناءً على العرضين المتوافقين.",
      },
      price: agreedPrice,
      paymentSchedule: schedule,
    });

    res.status(201).json({ success: true, draft });
  } catch (error) {
    console.error("❌ Failed to create deal draft:", error);
    res.status(500).json({ message: "تعذر إنشاء العقد المبدئي" });
  }
};

const HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};

async function confirmReservationCore({
  draftId,
  buyerId,
  paymentMethod = DEFAULT_PAYMENT_METHOD,
}) {
  const draft = await DealDraft.findOne({ _id: draftId, buyer: buyerId })
    .populate("property")
    .populate("seller", "name email phone")
    .populate("buyer", "name email phone");

  if (!draft) {
    throw new HttpError(404, "العقد غير موجود");
  }

  // =============================
  // لو محجوز بالفعل
  // =============================
  if (draft.status === "reserved") {
    const existingDeal = await findExistingDealForDraft(draft);
    const populatedDeal = await loadDealDetails(existingDeal?._id);
    await ensureLinkedDealReference(draft);

    return {
      draft,
      deal: populatedDeal,
      paymentStub: populatedDeal?.depositPayment,
    };
  }

  // =============================
  // Create reservation payment
  // =============================
  const paymentSchedule = draft.paymentSchedule || {};
  const downPaymentAmount =
    paymentSchedule.downPaymentAmount || Math.round((draft.price || 0) * 0.1);

  const paymentRecord = {
    amount: downPaymentAmount,
    method: paymentMethod,
    currency: "EGP",
    reference: `RSV-${Date.now()}`,
    status: "paid",
    paidAt: new Date(),
  };

  draft.status = "reserved";
  draft.reservationPayment = paymentRecord;
  draft.reservedAt = paymentRecord.paidAt;

  // =============================
  // Create / Update deal
  // =============================
  let deal = await findExistingDealForDraft(draft);
  if (!deal) {
    deal = await Deal.create({
      property: getDocumentId(draft.property),
      buyer: getDocumentId(draft.buyer),
      seller: getDocumentId(draft.seller),
      negotiation: getDocumentId(draft.negotiation),
      offerPrice: draft.price,
      finalPrice: draft.price,
      status: "pending",
      depositPayment: paymentRecord,
    });
  } else {
    deal.depositPayment = paymentRecord;
    deal.status = "pending";
    await deal.save();
  }

  draft.linkedDeal = deal._id;
  await draft.save();

  const populatedDeal = await loadDealDetails(deal._id);

  // =============================
  // 🔔 Notifications
  // =============================
  const property = draft.property;

  const propertyTitle = property?.projectName || property?.title || "Property";

  const amountFormatted = downPaymentAmount.toLocaleString();
  const buyerName = draft.buyer?.name || "Buyer";

  // 🔔 إشعار للبائع / المطور
  await createNotification({
    type: "success",
    title: "Property Reserved",
    message: `${buyerName} reserved ${propertyTitle} and paid ${amountFormatted} EGP.`,
    recipient: draft.seller._id,
    recipientRole: property?.developer ? "real_estate_developer" : "seller",
    referenceId: deal._id,
    referenceType: "deal",
  });

  // 🔔 إشعار للمشتري
  await createNotification({
    type: "success",
    title: "Reservation Confirmed",
    message: `Your reservation for ${propertyTitle} has been confirmed. You paid ${amountFormatted} EGP.`,
    recipient: draft.buyer._id,
    recipientRole: "buyer",
    referenceId: deal._id,
    referenceType: "deal",
  });

  console.log("✅ Reservation confirmed - Deal created:", {
    draftId: draft._id,
    dealId: deal._id,
    linkedDeal: draft.linkedDeal,
  });

  return {
    draft,
    deal: populatedDeal,
    paymentStub: {
      ...paymentRecord,
      instructions: getPaymentInstructions(paymentMethod),
    },
  };
}

exports.confirmReservation = async (req, res) => {
  try {
    const { draftId, paymentMethod = DEFAULT_PAYMENT_METHOD } = req.body;
    const result = await confirmReservationCore({
      draftId,
      buyerId: req.user.id,
      paymentMethod,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof HttpError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error("❌ Failed to confirm reservation:", error);
    res.status(500).json({ message: "تعذر تأكيد الحجز" });
  }
};

exports.confirmReservationCore = confirmReservationCore;

exports.listDrafts = async (req, res) => {
  try {
    const ownershipFilters = [{ buyer: req.user.id }, { seller: req.user.id }];

    // include properties owned by this seller/developer even if draft.seller missing
    const ownedProperties = await Property.find({
      $or: [{ seller: req.user.id }, { developer: req.user.id }],
    }).select("_id");

    if (ownedProperties.length) {
      ownershipFilters.push({
        property: { $in: ownedProperties.map((doc) => doc._id) },
      });
    }

    const drafts = await DealDraft.find({
      $or: ownershipFilters,
    })
      .sort({ updatedAt: -1 })
      .populate("property", "title price location images seller developer")
      .populate("buyer", "name email phone")
      .populate("seller", "name email phone")
      .populate("linkedDeal");

    // Force link reserved drafts to deals; create missing deals on the fly
    for (const draft of drafts) {
      if (draft.status === "reserved" && !draft.linkedDeal) {
        const deal = await ensureDealForReservedDraft(draft);
        if (deal?._id) {
          draft.linkedDeal = deal._id;
          await draft.save();
          console.log(`🔗 Auto-linked draft ${draft._id} to deal ${deal._id}`);
        }
      }
    }

    console.log(`📋 Fetched ${drafts.length} drafts for user ${req.user.id}`);

    res.json({ success: true, drafts });
  } catch (error) {
    console.error("❌ Failed to fetch drafts:", error);
    res.status(500).json({ message: "تعذر تحميل العقود" });
  }
};
