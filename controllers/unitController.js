const Unit = require("../models/unitModel");
const Property = require("../models/propertyModel");
const Deal = require("../models/dealModel");
const { createNotification } = require("./notificationController");

/**
 * Unit Controller - إدارة الوحدات العقارية
 */

// ✅ إنشاء وحدة جديدة (للمطور فقط)
exports.createUnit = async (req, res) => {
  try {
    const { projectId } = req.params;

    // تحقق من وجود المشروع وملكيته
    const project = await Property.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "المشروع غير موجود" });
    }

    if (project.type !== "project") {
      return res.status(400).json({ message: "هذا ليس مشروع مطور عقاري" });
    }

    const developerId =
      project.developer?.toString() || project.addedBy?.toString();
    if (developerId !== req.user.id && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "لا تملك صلاحية إضافة وحدات لهذا المشروع" });
    }

    const unitData = {
      ...req.body,
      project: projectId,
    };

    const unit = await Unit.create(unitData);

    // تحديث عدد الوحدات في المشروع
    await Property.findByIdAndUpdate(projectId, {
      $inc: { units: 1 },
    });
    // 🔔 إشعار للمطور نفسه (اختياري - للتأكيد)
    // const project = await Property.findById(projectId).populate("developer");
    const developerName = req.user.name || req.user.email || "Developer";

    // 🔔 إشعار لكل الأدمنز
    const admins = await User.find({ role: "admin" }).select("_id");

    await Promise.all(
      admins.map((admin) =>
        createNotification({
          type: "info",
          title: "New Unit Added to Project",
          message: `${developerName} added unit ${
            unit.unitNumber
          } to project: ${project.projectName || project.title}`,
          recipient: admin._id,
          recipientRole: "admin",
          referenceId: unit._id,
          referenceType: "property", // أو يمكن إنشاء "unit" كنوع جديد
        })
      )
    );
    res.status(201).json({
      success: true,
      message: "تم إنشاء الوحدة بنجاح",
      unit,
    });
  } catch (error) {
    console.error("❌ Failed to create unit:", error);
    res
      .status(500)
      .json({ message: "فشل في إنشاء الوحدة", error: error.message });
  }
};

// ✅ إنشاء عدة وحدات دفعة واحدة
exports.createBulkUnits = async (req, res) => {
  try {
    const { projectId } = req.params;
    const { units } = req.body;

    if (!Array.isArray(units) || units.length === 0) {
      return res.status(400).json({ message: "يرجى إرسال مصفوفة من الوحدات" });
    }

    const project = await Property.findById(projectId);
    if (!project) {
      return res.status(404).json({ message: "المشروع غير موجود" });
    }

    const developerId =
      project.developer?.toString() || project.addedBy?.toString();
    if (developerId !== req.user.id && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "لا تملك صلاحية إضافة وحدات لهذا المشروع" });
    }

    const unitsWithProject = units.map((u) => ({
      ...u,
      project: projectId,
    }));

    const createdUnits = await Unit.insertMany(unitsWithProject);

    // تحديث عدد الوحدات
    await Property.findByIdAndUpdate(projectId, {
      $inc: { units: createdUnits.length },
    });

    res.status(201).json({
      success: true,
      message: `تم إنشاء ${createdUnits.length} وحدة بنجاح`,
      units: createdUnits,
    });
  } catch (error) {
    console.error("❌ Failed to create bulk units:", error);
    res
      .status(500)
      .json({ message: "فشل في إنشاء الوحدات", error: error.message });
  }
};

// ✅ جلب وحدات مشروع معين
exports.getProjectUnits = async (req, res) => {
  try {
    const { projectId } = req.params;
    const {
      status,
      minPrice,
      maxPrice,
      minArea,
      maxArea,
      bedrooms,
      unitType,
      floor,
      page = 1,
      limit = 20,
      sort = "-createdAt",
    } = req.query;

    const filter = { project: projectId };

    if (status) filter.status = status;
    if (unitType) filter.unitType = unitType;
    if (bedrooms) filter.bedrooms = Number(bedrooms);
    if (floor) filter.floor = Number(floor);

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    if (minArea || maxArea) {
      filter.area = {};
      if (minArea) filter.area.$gte = Number(minArea);
      if (maxArea) filter.area.$lte = Number(maxArea);
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [units, total] = await Promise.all([
      Unit.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .populate("currentBooking.buyer", "name email phone"),
      Unit.countDocuments(filter),
    ]);

    res.json({
      success: true,
      units,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    console.error("❌ Failed to fetch project units:", error);
    res.status(500).json({ message: "فشل في جلب الوحدات" });
  }
};

// ✅ جلب وحدة واحدة بالتفاصيل
exports.getUnitById = async (req, res) => {
  try {
    const { unitId } = req.params;

    const unit = await Unit.findById(unitId)
      .populate(
        "project",
        "projectName title location developer developerInfo images"
      )
      .populate("currentBooking.buyer", "name email phone");

    if (!unit) {
      return res.status(404).json({ message: "الوحدة غير موجودة" });
    }

    // زيادة عداد المشاهدات
    unit.views += 1;
    await unit.save();

    res.json({ success: true, unit });
  } catch (error) {
    console.error("❌ Failed to fetch unit:", error);
    res.status(500).json({ message: "فشل في جلب الوحدة" });
  }
};

// ✅ تحديث وحدة
exports.updateUnit = async (req, res) => {
  try {
    const { unitId } = req.params;

    const unit = await Unit.findById(unitId).populate("project");
    if (!unit) {
      return res.status(404).json({ message: "الوحدة غير موجودة" });
    }

    const developerId =
      unit.project?.developer?.toString() || unit.project?.addedBy?.toString();
    if (developerId !== req.user.id && req.user.role !== "admin") {
      return res
        .status(403)
        .json({ message: "لا تملك صلاحية تعديل هذه الوحدة" });
    }

    // لا تسمح بتغيير المشروع
    delete req.body.project;

    Object.assign(unit, req.body);
    await unit.save();

    res.json({
      success: true,
      message: "تم تحديث الوحدة بنجاح",
      unit,
    });
  } catch (error) {
    console.error("❌ Failed to update unit:", error);
    res.status(500).json({ message: "فشل في تحديث الوحدة" });
  }
};

// ✅ حذف وحدة
exports.deleteUnit = async (req, res) => {
  try {
    const { unitId } = req.params;

    const unit = await Unit.findById(unitId).populate("project");
    if (!unit) {
      return res.status(404).json({ message: "الوحدة غير موجودة" });
    }

    const developerId =
      unit.project?.developer?.toString() || unit.project?.addedBy?.toString();
    if (developerId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "لا تملك صلاحية حذف هذه الوحدة" });
    }

    if (unit.status === "sold" || unit.status === "under_contract") {
      return res
        .status(400)
        .json({ message: "لا يمكن حذف وحدة مباعة أو تحت التعاقد" });
    }

    const projectId = unit.project._id;
    await unit.deleteOne();

    // تحديث عدد الوحدات في المشروع
    await Property.findByIdAndUpdate(projectId, {
      $inc: { units: -1 },
    });

    res.json({
      success: true,
      message: "تم حذف الوحدة بنجاح",
    });
  } catch (error) {
    console.error("❌ Failed to delete unit:", error);
    res.status(500).json({ message: "فشل في حذف الوحدة" });
  }
};

// ✅ إحصائيات وحدات المشروع
exports.getProjectUnitStats = async (req, res) => {
  try {
    const { projectId } = req.params;

    const stats = await Unit.getProjectStats(projectId);

    res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("❌ Failed to fetch unit stats:", error);
    res.status(500).json({ message: "فشل في جلب الإحصائيات" });
  }
};

// ✅ حجز وحدة (للمشتري)
exports.bookUnit = async (req, res) => {
  try {
    const { unitId } = req.params;
    const { depositAmount } = req.body;

    if (req.user.role !== "buyer") {
      return res.status(403).json({ message: "الحجز متاح للمشترين فقط" });
    }

    const unit = await Unit.findById(unitId).populate("project");
    if (!unit) {
      return res.status(404).json({ message: "الوحدة غير موجودة" });
    }

    if (unit.status !== "available") {
      return res.status(400).json({
        message: `الوحدة غير متاحة للحجز - الحالة: ${unit.status}`,
      });
    }

    // حساب مبلغ الحجز الافتراضي (5% أو المقدم الأدنى)
    const defaultDeposit =
      depositAmount ||
      Math.round(
        unit.price * ((unit.paymentPlan?.minDownPaymentPercent || 5) / 100)
      );

    // حجز لمدة 48 ساعة
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);

    unit.status = "booked";
    unit.currentBooking = {
      buyer: req.user.id,
      bookedAt: new Date(),
      expiresAt,
      depositAmount: defaultDeposit,
      depositPaid: false,
    };
    unit.inquiries += 1;

    await unit.save();
    // 🔔 إشعار للمطور/البائع
    const project = await Property.findById(unit.project).populate("developer");
    const developerId = project.developer?._id || project.addedBy;
    const buyerName = req.user.name || req.user.email || "Buyer";

    await Notification.create({
      type: "info",
      title: "Unit Booking Request",
      message: `${buyerName} booked unit ${unit.unitNumber} in your project: ${
        project.projectName || project.title
      }`,
      recipient: developerId,
      recipientRole: "real_estate_developer",
      referenceId: unit._id,
      referenceType: "property",
    });
    // إنشاء Deal للحجز
    const deal = await Deal.create({
      property: unit.project._id,
      buyer: req.user.id,
      seller: unit.project.developer || unit.project.addedBy,
      offerPrice: unit.price,
      status: "pending",
      reservation: {
        unitId: unit._id,
        unitNumber: unit.unitNumber,
        unitType: unit.unitType,
        area: unit.area,
        floor: unit.floor,
      },
      buyerContact: {
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
      },
    });

    res.json({
      success: true,
      message: "تم حجز الوحدة بنجاح - يرجى دفع العربون خلال 48 ساعة",
      unit,
      deal,
      booking: {
        expiresAt,
        depositAmount: defaultDeposit,
        instructions: "يرجى التواصل مع المطور لإتمام إجراءات الدفع",
      },
    });
  } catch (error) {
    console.error("❌ Failed to book unit:", error);
    res.status(500).json({ message: "فشل في حجز الوحدة" });
  }
};

// ✅ تأكيد دفع العربون (للمطور)
exports.confirmDeposit = async (req, res) => {
  try {
    const { unitId } = req.params;
    const { paymentReference } = req.body;

    const unit = await Unit.findById(unitId).populate("project");
    if (!unit) {
      return res.status(404).json({ message: "الوحدة غير موجودة" });
    }

    const developerId =
      unit.project?.developer?.toString() || unit.project?.addedBy?.toString();
    if (developerId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "فقط المطور يمكنه تأكيد الدفع" });
    }

    if (unit.status !== "booked" || !unit.currentBooking?.buyer) {
      return res.status(400).json({ message: "الوحدة ليست محجوزة" });
    }

    unit.currentBooking.depositPaid = true;
    unit.status = "reserved"; // حالة أعلى من محجوز
    await unit.save();

    // تحديث الـ Deal
    await Deal.findOneAndUpdate(
      { "reservation.unitId": unitId },
      {
        status: "accepted",
        depositPayment: {
          amount: unit.currentBooking.depositAmount,
          status: "paid",
          paidAt: new Date(),
          reference: paymentReference,
        },
      }
    );

    res.json({
      success: true,
      message: "تم تأكيد دفع العربون - الوحدة محجوزة رسمياً",
      unit,
    });
  } catch (error) {
    console.error("❌ Failed to confirm deposit:", error);
    res.status(500).json({ message: "فشل في تأكيد الدفع" });
  }
};

// ✅ إلغاء حجز (للمطور أو تلقائياً)
exports.cancelBooking = async (req, res) => {
  try {
    const { unitId } = req.params;
    const { reason } = req.body;

    const unit = await Unit.findById(unitId).populate("project");
    if (!unit) {
      return res.status(404).json({ message: "الوحدة غير موجودة" });
    }

    const developerId =
      unit.project?.developer?.toString() || unit.project?.addedBy?.toString();
    const buyerId = unit.currentBooking?.buyer?.toString();

    // المطور أو المشتري أو الأدمن يمكنهم الإلغاء
    if (
      developerId !== req.user.id &&
      buyerId !== req.user.id &&
      req.user.role !== "admin"
    ) {
      return res
        .status(403)
        .json({ message: "لا تملك صلاحية إلغاء هذا الحجز" });
    }

    if (!["booked", "reserved"].includes(unit.status)) {
      return res.status(400).json({ message: "الوحدة ليست محجوزة" });
    }

    unit.status = "available";
    unit.currentBooking = undefined;
    await unit.save();

    // تحديث الـ Deal
    await Deal.findOneAndUpdate(
      {
        "reservation.unitId": unitId,
        status: { $in: ["pending", "accepted"] },
      },
      {
        status: "cancelled",
        messages: [
          {
            sender: req.user.id,
            text: reason || "تم إلغاء الحجز",
            sentAt: new Date(),
          },
        ],
      }
    );

    res.json({
      success: true,
      message: "تم إلغاء الحجز - الوحدة متاحة مرة أخرى",
      unit,
    });
  } catch (error) {
    console.error("❌ Failed to cancel booking:", error);
    res.status(500).json({ message: "فشل في إلغاء الحجز" });
  }
};

// ✅ تحويل الحجز لبيع (للمطور)
exports.markAsSold = async (req, res) => {
  try {
    const { unitId } = req.params;

    const unit = await Unit.findById(unitId).populate("project");
    if (!unit) {
      return res.status(404).json({ message: "الوحدة غير موجودة" });
    }

    const developerId =
      unit.project?.developer?.toString() || unit.project?.addedBy?.toString();
    if (developerId !== req.user.id && req.user.role !== "admin") {
      return res.status(403).json({ message: "فقط المطور يمكنه تأكيد البيع" });
    }

    if (!["booked", "reserved", "under_contract"].includes(unit.status)) {
      return res
        .status(400)
        .json({ message: "الوحدة يجب أن تكون محجوزة أولاً" });
    }

    unit.status = "sold";
    await unit.save();

    // تحديث الـ Deal
    await Deal.findOneAndUpdate(
      { "reservation.unitId": unitId },
      { status: "closed" }
    );

    res.json({
      success: true,
      message: "تم تسجيل البيع بنجاح 🎉",
      unit,
    });
  } catch (error) {
    console.error("❌ Failed to mark as sold:", error);
    res.status(500).json({ message: "فشل في تسجيل البيع" });
  }
};

// ✅ البحث عن وحدات (للعملاء)
exports.searchUnits = async (req, res) => {
  try {
    const {
      city,
      minPrice,
      maxPrice,
      minArea,
      maxArea,
      bedrooms,
      unitType,
      paymentType,
      maxDownPayment,
      page = 1,
      limit = 20,
      sort = "price",
    } = req.query;

    // جلب المشاريع المتاحة
    const projectFilter = { type: "project" };
    if (city) {
      projectFilter["location.city"] = new RegExp(city, "i");
    }

    const projectIds = await Property.find(projectFilter).distinct("_id");

    // بناء فلتر الوحدات
    const filter = {
      project: { $in: projectIds },
      status: "available",
    };

    if (unitType) filter.unitType = unitType;
    if (bedrooms) filter.bedrooms = Number(bedrooms);

    if (minPrice || maxPrice) {
      filter.price = {};
      if (minPrice) filter.price.$gte = Number(minPrice);
      if (maxPrice) filter.price.$lte = Number(maxPrice);
    }

    if (minArea || maxArea) {
      filter.area = {};
      if (minArea) filter.area.$gte = Number(minArea);
      if (maxArea) filter.area.$lte = Number(maxArea);
    }

    if (paymentType) {
      filter["paymentPlan.paymentType"] = { $in: [paymentType, "both"] };
    }

    if (maxDownPayment) {
      filter["paymentPlan.minDownPaymentPercent"] = {
        $lte: Number(maxDownPayment),
      };
    }

    const skip = (Number(page) - 1) * Number(limit);

    const [units, total] = await Promise.all([
      Unit.find(filter)
        .sort(sort)
        .skip(skip)
        .limit(Number(limit))
        .populate("project", "projectName title location developerInfo images"),
      Unit.countDocuments(filter),
    ]);

    res.json({
      success: true,
      units,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
    });
  } catch (error) {
    console.error("❌ Failed to search units:", error);
    res.status(500).json({ message: "فشل في البحث" });
  }
};

// ✅ طلب زيارة للوحدة
exports.requestVisit = async (req, res) => {
  try {
    const { unitId } = req.params;
    const { preferredDate, preferredTime, message } = req.body;

    const unit = await Unit.findById(unitId).populate("project");
    if (!unit) {
      return res.status(404).json({ message: "الوحدة غير موجودة" });
    }

    unit.inquiries += 1;
    await unit.save();

    // إنشاء Deal بنوع استفسار/زيارة
    const deal = await Deal.create({
      property: unit.project._id,
      buyer: req.user.id,
      seller: unit.project.developer || unit.project.addedBy,
      offerPrice: unit.price,
      status: "pending",
      reservation: {
        unitId: unit._id,
        unitNumber: unit.unitNumber,
        unitType: unit.unitType,
        visitRequest: true,
        preferredDate,
        preferredTime,
      },
      buyerContact: {
        name: req.user.name,
        email: req.user.email,
        phone: req.user.phone,
        message: message || `طلب زيارة للوحدة ${unit.unitNumber}`,
      },
    });

    res.json({
      success: true,
      message: "تم إرسال طلب الزيارة - سيتواصل معك المطور قريباً",
      deal,
    });
  } catch (error) {
    console.error("❌ Failed to request visit:", error);
    res.status(500).json({ message: "فشل في إرسال طلب الزيارة" });
  }
};
