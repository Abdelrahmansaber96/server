const Property = require("../models/propertyModel");
const NegotiationSession = require("../models/negotiationSessionModel");
const DealDraft = require("../models/dealDraftModel");
const { confirmReservationCore } = require("./dealDraftController");
const { createNotification } = require("./notificationController");

function parseNumber(value) {
  if (value === undefined || value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolveOfferType(body = {}) {
  if (
    body.offerType === "cash" ||
    body.negotiationIntent === "cash" ||
    body.cashOffer === true
  ) {
    return "cash";
  }
  if (body.offerType === "rent" || body.negotiationIntent === "rent") {
    return "rent";
  }
  return "installments";
}

function normalizeBuyerOffer(body = {}) {
  const offerType = resolveOfferType(body);
  return {
    offerType,
    cashOffer: offerType === "cash",
    downPaymentPercent:
      offerType === "installments"
        ? parseNumber(body.downPaymentPercent)
        : undefined,
    installmentYears:
      offerType === "installments"
        ? parseNumber(body.installmentYears)
        : undefined,
    cashOfferPrice:
      offerType === "cash" ? parseNumber(body.cashOfferPrice) : undefined,
    rentBudget: offerType === "rent" ? parseNumber(body.rentBudget) : undefined,
    rentDurationMonths:
      offerType === "rent" ? parseNumber(body.rentDurationMonths) : undefined,
    notes: body.offerText || body.notes || "",
  };
}

function buildSellerTerms(property = {}) {
  const fallback = {
    downPaymentPercent: 10,
    installmentYears: 3,
    cashOffer: property.paymentPlan?.paymentType === "cash",
    notes: property.paymentPlan?.notes || "",
    cashOfferPrice: property.price || 0,
    rentBudget: property.rentPrice || property.price || 0,
    rentDurationMonths: 12,
  };

  if (!property.paymentPlan) {
    return fallback;
  }

  return {
    downPaymentPercent:
      property.paymentPlan.minDownPaymentPercent ?? fallback.downPaymentPercent,
    installmentYears:
      property.paymentPlan.maxInstallmentYears ?? fallback.installmentYears,
    cashOffer: property.paymentPlan.paymentType === "cash",
    notes: property.paymentPlan.notes || fallback.notes,
    cashOfferPrice: property.price || fallback.cashOfferPrice,
    rentBudget: property.paymentPlan.rentBudget || fallback.rentBudget,
    rentDurationMonths:
      property.paymentPlan.rentDurationMonths || fallback.rentDurationMonths,
  };
}

function generateCounterOffers(
  buyerOffer = {},
  sellerTerms = {},
  propertyPrice = 0
) {
  const offerType =
    buyerOffer.offerType || (buyerOffer.cashOffer ? "cash" : "installments");

  if (offerType === "cash") {
    const buyerPrice = buyerOffer.cashOfferPrice || propertyPrice;
    const sellerPrice = sellerTerms.cashOfferPrice || propertyPrice;
    const midpoint = Math.round((buyerPrice + sellerPrice) / 2);
    return {
      buyerCounterOffer: {
        label: "عرض كاش للمشتري",
        offerType: "cash",
        cashAmount: buyerPrice,
        message: `عرض نقدي بقيمة ${buyerPrice.toLocaleString()} مع إمكانية التفاوض حتى ${midpoint.toLocaleString()}.`,
      },
      sellerCounterOffer: {
        label: "عرض كاش من البائع",
        offerType: "cash",
        cashAmount: sellerPrice,
        message: `البائع يستهدف ${sellerPrice.toLocaleString()} عند الدفع الكاش.`,
      },
      estimatedReservation: Math.round(midpoint * 0.1),
    };
  }

  if (offerType === "rent") {
    const buyerBudget =
      buyerOffer.rentBudget || sellerTerms.rentBudget || propertyPrice;
    const sellerBudget = sellerTerms.rentBudget || buyerBudget;
    const months =
      buyerOffer.rentDurationMonths || sellerTerms.rentDurationMonths || 12;
    const averageBudget = Math.round((buyerBudget + sellerBudget) / 2);
    return {
      buyerCounterOffer: {
        label: "عرض إيجار للمشتري",
        offerType: "rent",
        rentBudget: buyerBudget,
        rentDurationMonths: months,
        message: `إيجار شهري ${buyerBudget.toLocaleString()} لمدة ${months} شهر.`,
      },
      sellerCounterOffer: {
        label: "عرض إيجار من البائع",
        offerType: "rent",
        rentBudget: sellerBudget,
        rentDurationMonths: months,
        message: `البائع يفضل إيجار شهري ${sellerBudget.toLocaleString()} مع مدة ${months} شهر.`,
      },
      estimatedReservation: averageBudget,
    };
  }

  // Installments - use buyer's values if provided, otherwise use seller's terms
  const sellerDown = sellerTerms.downPaymentPercent ?? 10;
  const sellerYears = sellerTerms.installmentYears ?? 3;

  // Use buyer's values directly if provided, don't average them
  const buyerDown = buyerOffer.downPaymentPercent;
  const buyerYears = buyerOffer.installmentYears;

  // For counter offer, suggest a middle ground only if buyer provided values
  const counterDown =
    buyerDown != null ? Math.round((buyerDown + sellerDown) / 2) : sellerDown;
  const counterYears =
    buyerYears != null
      ? Math.round((buyerYears + sellerYears) / 2)
      : sellerYears;

  const buyerMessage = buyerOffer.cashOffer
    ? "عرض نقدي كامل مع خصم فوري يمكن مناقشته"
    : buyerDown != null
    ? `دفع مقدم ${buyerDown}% وتقسيط ${buyerYears || sellerYears} سنوات.`
    : `تقسيط حتى ${buyerYears || sellerYears} سنوات.`;

  const sellerMessage = `الحد الأدنى مقدم ${sellerDown}% مع تقسيط حتى ${sellerYears} سنوات.`;

  return {
    buyerCounterOffer: {
      label: "عرضك",
      downPaymentPercent: buyerDown,
      installmentYears: buyerYears,
      message: buyerMessage,
      offerType: "installments",
    },
    sellerCounterOffer: {
      label: "شروط البائع",
      downPaymentPercent: sellerDown,
      installmentYears: sellerYears,
      message: sellerMessage,
      offerType: "installments",
    },
    estimatedReservation: propertyPrice * ((counterDown || sellerDown) / 100),
  };
}

function derivePaymentSchedule(property = {}, negotiation) {
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
      // ✅ إضافة السعر الأصلي والسعر المقترح للمرجعية
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

exports.startNegotiation = async (req, res) => {
  try {
    if (!req.user || req.user.role !== "buyer") {
      return res.status(403).json({ message: "التفاوض متاح للمشترين فقط" });
    }

    const { propertyId } = req.body;
    if (!propertyId) {
      return res.status(400).json({ message: "رقم العقار مطلوب" });
    }

    const property = await Property.findById(propertyId).lean();
    if (!property) {
      return res.status(404).json({ message: "لم يتم العثور على العقار" });
    }

    // ✅ التحقق من أن العقار متاح وليس مباع أو مؤجر
    const unavailableStatuses = ["sold", "rented"];
    if (property.status && unavailableStatuses.includes(property.status)) {
      const statusMessage =
        property.status === "sold"
          ? "تم بيع هذا العقار بالفعل"
          : "تم تأجير هذا العقار بالفعل";
      return res.status(400).json({
        message: `عذراً، ${statusMessage}. يرجى البحث عن عقار آخر متاح.`,
        propertyStatus: property.status,
        isUnavailable: true,
      });
    }

    const buyerOffer = normalizeBuyerOffer(req.body);
    const sellerTerms = buildSellerTerms(property);
    const counters = generateCounterOffers(
      buyerOffer,
      sellerTerms,
      property.price || 0
    );
    const intentType =
      req.body.negotiationIntent || buyerOffer.offerType || "installments";

    const activeStatuses = [
      "pending",
      "approved",
      "draft_requested",
      "draft_generated",
      "draft_sent",
    ];

    const existingSession = await NegotiationSession.findOne({
      property: property._id,
      buyer: req.user.id,
      status: { $in: activeStatuses },
    }).sort({ createdAt: -1 });

    if (existingSession) {
      existingSession.propertySnapshot = {
        ...(existingSession.propertySnapshot?.toObject?.() ||
          existingSession.propertySnapshot ||
          {}),
        title: property.title,
        price: property.price,
        location: property.location,
        listingStatus:
          property.listingStatus ||
          existingSession.propertySnapshot?.listingStatus,
      };
      existingSession.buyerOffer = {
        ...existingSession.buyerOffer?.toObject?.(),
        ...buyerOffer,
      };
      existingSession.intentType = intentType;
      existingSession.sellerTerms = sellerTerms;
      existingSession.buyerCounterOffer = counters.buyerCounterOffer;
      existingSession.sellerCounterOffer = counters.sellerCounterOffer;
      await existingSession.save();

      return res.status(200).json({
        success: true,
        session: existingSession,
        reservationEstimate: counters.estimatedReservation,
        duplicate: true,
      });
    }

    const session = await NegotiationSession.create({
      property: property._id,
      propertySnapshot: {
        title: property.title,
        price: property.price,
        location: property.location,
        listingStatus: property.listingStatus,
      },
      buyer: req.user.id,
      seller: property.seller || property.developer,
      buyerOffer,
      sellerTerms,
      buyerCounterOffer: counters.buyerCounterOffer,
      sellerCounterOffer: counters.sellerCounterOffer,
      intentType,
    });
    // // 🔔 إشعار للبائع/المطور
    // const property = await Property.findById(propertyId)
    //   .populate("seller")
    //   .populate("developer");

    const sellerId = property.developer?._id || property.seller?._id;
    const sellerRole = property.developer ? "real_estate_developer" : "seller";
    const buyerName = req.user.name || req.user.email || "Buyer";
    const propertyTitle = property.projectName || property.title || "Property";

    // ✅ بناء رسالة الإشعار مع تفاصيل العرض
    let offerDetails = "";
    if (buyerOffer.offerType === "cash" && buyerOffer.cashOfferPrice) {
      offerDetails = ` بسعر ${buyerOffer.cashOfferPrice.toLocaleString()} جنيه كاش`;
    } else if (buyerOffer.offerType === "installments") {
      offerDetails = ` بنظام تقسيط: مقدم ${buyerOffer.downPaymentPercent || 10}% على ${buyerOffer.installmentYears || 3} سنوات`;
    } else if (buyerOffer.offerType === "rent" && buyerOffer.rentBudget) {
      offerDetails = ` للإيجار بـ ${buyerOffer.rentBudget.toLocaleString()} جنيه شهرياً`;
    }

    await createNotification({
      type: "info",
      title: "عرض تفاوض جديد",
      message: `${buyerName} قدم عرض تفاوض على ${
        property.developer ? "مشروعك" : "عقارك"
      }: ${propertyTitle}${offerDetails}`,
      recipient: sellerId,
      recipientRole: sellerRole,
      referenceId: session._id,
      referenceType: "negotiation",
    });
    res.status(201).json({
      success: true,
      session,
      reservationEstimate: counters.estimatedReservation,
    });
  } catch (error) {
    console.error("❌ Failed to start negotiation:", error);
    res.status(500).json({ message: "تعذر بدء جلسة التفاوض" });
  }
};

exports.listNegotiations = async (req, res) => {
  try {
    const role = req.user?.role;
    const baseQuery =
      role === "seller" || role === "developer"
        ? { seller: req.user.id }
        : { buyer: req.user.id };

    const sessions = await NegotiationSession.find(baseQuery)
      .sort({ updatedAt: -1 })
      .limit(50)
      .populate("property", "title price location images")
      .populate("buyer", "name email phone role")
      .populate("seller", "name email phone role");

    const normalized = sessions.map((session) => {
      const propertyInfo = session.property || session.propertySnapshot || {};
      return {
        _id: session._id,
        property: propertyInfo,
        propertySnapshot: session.propertySnapshot,
        buyer: session.buyer,
        seller: session.seller,
        buyerOffer: session.buyerOffer,
        sellerTerms: session.sellerTerms,
        buyerCounterOffer: session.buyerCounterOffer,
        sellerCounterOffer: session.sellerCounterOffer,
        intentType: session.intentType,
        status: session.status,
        decisionBy: session.decisionBy,
        decisionAt: session.decisionAt,
        decisionNotes: session.decisionNotes,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
      };
    });

    res.json({ success: true, sessions: normalized });
  } catch (error) {
    console.error("❌ Failed to fetch negotiations:", error);
    res.status(500).json({ message: "تعذر تحميل جلسات التفاوض" });
  }
};

exports.updateNegotiationStatus = async (req, res) => {
  try {
    if (
      !req.user ||
      !["seller", "developer", "admin"].includes(req.user.role)
    ) {
      return res
        .status(403)
        .json({ message: "فقط مالك العقار يمكنه اعتماد التفاوض" });
    }

    const { id } = req.params;
    const { status, notes } = req.body;
    if (!status || !["approved", "declined"].includes(status)) {
      return res.status(400).json({ message: "حالة غير صحيحة" });
    }

    const session = await NegotiationSession.findById(id);
    if (!session) {
      return res.status(404).json({ message: "الجلسة غير موجودة" });
    }

    if (
      session.seller?.toString() !== req.user.id &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ message: "لا تمتلك صلاحية على هذا العقار" });
    }

    if (session.status !== "pending") {
      return res
        .status(409)
        .json({ message: "تم اتخاذ قرار بالفعل لهذه الجلسة" });
    }

    session.status = status;
    session.decisionBy = req.user.id;
    session.decisionAt = new Date();
    session.decisionNotes =
      notes || (status === "approved" ? "تمت الموافقة" : "تم الرفض");
    await session.save();
    // 🔔 إشعار للمشتري
    const property = await Property.findById(session.property);
    const sellerName = req.user.name || req.user.email || "Seller";
    const propertyTitle =
      property?.projectName || property?.title || "Property";
    const buyerId = session.buyer;

    await createNotification({
      type: status === "approved" ? "success" : "warning",
      title:
        status === "approved" ? "Negotiation Approved" : "Negotiation Declined",
      message:
        status === "approved"
          ? `${sellerName} approved your negotiation on ${propertyTitle}. You can now proceed.`
          : `${sellerName} declined your negotiation on ${propertyTitle}.`,
      recipient: buyerId,
      recipientRole: "buyer",
      referenceId: session._id,
      referenceType: "negotiation",
    });
    res.json({ success: true, session });
  } catch (error) {
    console.error("❌ Failed to update negotiation status:", error);
    res.status(500).json({ message: "تعذر تحديث حالة التفاوض" });
  }
};

exports.requestDraft = async (req, res) => {
  try {
    if (req.user.role !== "buyer") {
      return res
        .status(403)
        .json({ message: "فقط المشتري يمكنه طلب مسودة العقد" });
    }

    const session = await NegotiationSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: "الجلسة غير موجودة" });

    if (session.buyer?.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ message: "لا تمتلك صلاحية على هذه الجلسة" });
    }

    if (session.status !== "approved") {
      return res
        .status(409)
        .json({ message: "يجب أن تكون الجلسة مقبولة لطلب مسودة العقد" });
    }

    session.status = "draft_requested";
    await session.save();

    res.json({ success: true, session });
  } catch (err) {
    console.error("❌ Failed to request draft:", err);
    res.status(500).json({ message: "فشل في طلب المسودة" });
  }
};

exports.generateDraft = async (req, res) => {
  try {
    if (!["seller", "developer"].includes(req.user.role)) {
      return res.status(403).json({ message: "فقط البائع يمكنه إنشاء مسودة" });
    }

    const session = await NegotiationSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: "الجلسة غير موجودة" });

    if (
      session.seller?.toString() !== req.user.id &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ message: "لا تمتلك صلاحية على هذه الجلسة" });
    }

    if (session.status !== "draft_requested") {
      return res
        .status(409)
        .json({ message: "يجب أن تكون هناك طلب مسودة لإنشاء مسودة" });
    }

    session.status = "draft_generated";
    await session.save();

    res.json({ success: true, session });
  } catch (err) {
    console.error("❌ Failed to generate draft:", err);
    res.status(500).json({ message: "فشل في إنشاء المسودة" });
  }
};

exports.sendDraft = async (req, res) => {
  try {
    if (!["seller", "developer"].includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "فقط البائع يمكنه إرسال المسودة" });
    }

    const session = await NegotiationSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: "الجلسة غير موجودة" });

    if (
      session.seller?.toString() !== req.user.id &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ message: "لا تمتلك صلاحية على هذه الجلسة" });
    }

    if (session.status !== "draft_generated") {
      return res
        .status(409)
        .json({ message: "يجب أن تكون المسودة تم إنشاؤها قبل الإرسال" });
    }

    session.status = "draft_sent";
    await session.save();

    res.json({ success: true, session });
  } catch (err) {
    console.error("❌ Failed to send draft:", err);
    res.status(500).json({ message: "فشل في إرسال المسودة" });
  }
};
exports.confirmReservation = async (req, res) => {
  try {
    if (req.user.role !== "buyer") {
      return res.status(403).json({ message: "فقط المشتري يمكنه تأكيد الحجز" });
    }

    const session = await NegotiationSession.findById(req.params.id).populate(
      "property"
    );
    if (!session) return res.status(404).json({ message: "الجلسة غير موجودة" });

    if (session.buyer?.toString() !== req.user.id) {
      return res
        .status(403)
        .json({ message: "لا تمتلك صلاحية على هذه الجلسة" });
    }

    if (
      !["draft_sent", "approved", "draft_generated"].includes(session.status)
    ) {
      return res
        .status(409)
        .json({ message: "يجب أن يتم إرسال المسودة أولاً" });
    }

    let draft = await DealDraft.findOne({ negotiation: session._id });
    if (!draft) {
      const propertyDoc = session.property?._id
        ? session.property
        : await Property.findById(session.property).lean();
      if (!propertyDoc && !session.propertySnapshot) {
        return res
          .status(409)
          .json({ message: "لا يمكن إنشاء مسودة بدون بيانات العقار" });
      }

      const schedule = derivePaymentSchedule(
        propertyDoc || session.propertySnapshot || {},
        session
      );
      const location =
        propertyDoc?.location || session.propertySnapshot?.location || {};
      const propertyTitle =
        propertyDoc?.title || session.propertySnapshot?.title || "Property";
      const propertyId = propertyDoc?._id || session.property;

      draft = await DealDraft.create({
        buyer: session.buyer,
        seller: session.seller,
        property: propertyId,
        negotiation: session._id,
        summary: {
          propertyTitle,
          propertyLocation: `${location.city || ""} ${
            location.area || ""
          }`.trim(),
          meetingDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          notes: "تم توليد العقد تلقائياً بعد موافقة الطرفين.",
        },
        price: propertyDoc?.price || session.propertySnapshot?.price || 0,
        paymentSchedule: schedule,
      });
    }

    const paymentMethod = req.body.paymentMethod;
    const confirmationResult = await confirmReservationCore({
      draftId: draft._id,
      buyerId: req.user.id,
      paymentMethod,
    });

    session.status = "confirmed";
    session.decisionBy = req.user.id;
    session.decisionAt = new Date();
    await session.save();

    res.json({ success: true, session, ...confirmationResult });
  } catch (err) {
    console.error("❌ Failed to confirm reservation:", err);
    if (err.status) {
      return res.status(err.status).json({ message: err.message });
    }
    res.status(500).json({ message: "فشل في تأكيد الحجز" });
  }
};
