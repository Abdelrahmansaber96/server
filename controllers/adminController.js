const User = require("../models/userModel");
const Property = require("../models/propertyModel");

// ✅ Get all users (with pagination & optional search), exclude super admin
// ✅ Get all users (with pagination & optional search), exclude super admin
exports.getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, q, role, dateRange } = req.query;

    let skip = 0;
    let limitNumber = Number(limit);

    if (limit === "all") {
      limitNumber = 0;
    } else {
      skip = (page - 1) * limitNumber;
    }

    const filter = { role: { $ne: "admin" } };

    if (role && role !== "all") {
      filter.role = role; // ✅ فلترة حقيقية من السيرفر
    }

    // 🔍 بحث
    if (q) {
      filter.$or = [
        { name: new RegExp(q, "i") },
        { email: new RegExp(q, "i") },
        { phone: new RegExp(q, "i") },
      ];
    }

    // 📅 فلتر حسب التاريخ
    if (dateRange && dateRange !== "all") {
      let startDate = new Date();
      switch (dateRange) {
        case "today":
          startDate.setHours(0, 0, 0, 0);
          break;
        case "7days":
          startDate.setDate(startDate.getDate() - 7);
          break;
        case "30days":
          startDate.setDate(startDate.getDate() - 30);
          break;
        case "90days":
          startDate.setDate(startDate.getDate() - 90);
          break;
      }
      filter.createdAt = { $gte: startDate };
    }

    const users = await User.find(filter)
      .select("-password")
      .skip(skip)
      .limit(limitNumber)
      .sort({ createdAt: -1 });

    const total = await User.countDocuments(filter);

    // ✅ إضافة عدد العقارات لكل يوزر
    const enhancedUsers = await Promise.all(
      users.map(async (user) => {
        let propertiesCount = 0;

        if (user.role === "seller") {
          propertiesCount = await Property.countDocuments({ seller: user._id });
        }

        if (user.role === "real_estate_developer") {
          propertiesCount = await Property.countDocuments({
            developer: user._id,
          });
        }

        return {
          ...user.toObject(),
          properties: propertiesCount,
          initials: user.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase(),
          joined: user.createdAt.toLocaleDateString("en-GB"),
        };
      })
    );

    res.json({
      message: "Users retrieved successfully",
      data: enhancedUsers,
      total,
      page: limit === "all" ? 1 : Number(page),
      limit: limit === "all" ? total : limitNumber,
      pages: limit === "all" ? 1 : Math.ceil(total / limitNumber),
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
// ✅ Update user role
exports.updateUserRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (
      !role ||
      ![
        "buyer",
        "seller",
        "real_estate_developer",
        "admin",
        "developer",
      ].includes(role)
    ) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const user = await User.findByIdAndUpdate(
      id,
      { role },
      { new: true }
    ).select("-password");

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({ message: "User role updated", user });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ✅ Delete any user
// ✅ Delete any user and their properties
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // احصل على كل العقارات اللي أضافها المستخدم
    const properties = await Property.find({ addedBy: id });

    // احذف كل العقارات دي
    await Property.deleteMany({ addedBy: id });

    // احذف المستخدم نفسه
    const user = await User.findByIdAndDelete(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      message: "User and their properties deleted successfully",
      userId: id,
      deletedPropertiesCount: properties.length,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ✅ Get all properties (admin can see everything)
// ✅ Get all properties (admin can see everything)
exports.getAllProperties = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      q,
      city,
      minPrice,
      maxPrice,
      bedrooms,
      type,
      listingStatus,
      features,
      isFeatured,
      status,
      addedBy,
      dateRange, // ✅ أضف dateRange
    } = req.query;

    const filter = {};

    if (q) {
      filter.$or = [
        { title: new RegExp(q, "i") },
        { description: new RegExp(q, "i") },
        { "location.city": new RegExp(q, "i") },
        { "location.area": new RegExp(q, "i") },
      ];
    }

    // 📅 فلتر حسب التاريخ
    if (dateRange && dateRange !== "all") {
      let startDate = new Date();
      switch (dateRange) {
        case "today":
          startDate.setHours(0, 0, 0, 0);
          break;
        case "7days":
          startDate.setDate(startDate.getDate() - 7);
          break;
        case "30days":
          startDate.setDate(startDate.getDate() - 30);
          break;
        case "90days":
          startDate.setDate(startDate.getDate() - 90);
          break;
      }
      filter.createdAt = { $gte: startDate };
    }

    if (city) filter["location.city"] = city;
    if (bedrooms) filter.bedrooms = Number(bedrooms);
    if (minPrice || maxPrice) filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
    if (type) filter.type = type;
    if (listingStatus) filter.listingStatus = listingStatus;
    if (features) filter.features = { $in: features.split(",") };
    if (isFeatured) filter.isFeatured = isFeatured === "true";
    if (status) filter.status = status;
    if (addedBy) filter.addedBy = addedBy;

    let skip = 0;
    let limitNumber = Number(limit);
    if (limit === "all") {
      limitNumber = 0;
    } else {
      skip = (page - 1) * limitNumber;
    }

    const properties = await Property.find(filter)
      .populate("seller developer", "name email phone")
      .skip(skip)
      .limit(limitNumber)
      .sort({ createdAt: -1 });

    const total = await Property.countDocuments(filter);

    res.json({
      message: "Properties retrieved successfully",
      data: properties,
      total,
      page: Number(page),
      limit: limit === "all" ? total : Number(limit),
      pages: limit === "all" ? 1 : Math.ceil(total / limitNumber),
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
// ✅ Admin verify property (AI/manual)
exports.verifyProperty = async (req, res) => {
  try {
    const { id } = req.params;
    const { aiVerified } = req.body;

    const property = await Property.findById(id);
    if (!property)
      return res.status(404).json({ message: "Property not found" });

    property.aiVerified = aiVerified === true;
    property.verifiedAt = new Date();

    await property.save();

    res.json({ message: "Property verified successfully", property });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ✅ Admin delete any property
exports.deleteProperty = async (req, res) => {
  try {
    const { id } = req.params;

    const property = await Property.findByIdAndDelete(id);
    if (!property)
      return res.status(404).json({ message: "Property not found" });

    // ✅ ارجع الـ id عشان الـ Redux يعرف يحذف من الـ State
    res.json({
      message: "Property deleted successfully",
      id: id, // ← أضف السطر ده
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
exports.getTotalViews = async (req, res) => {
  try {
    const totalViews = await Property.aggregate([
      { $project: { views: { $ifNull: ["$views", 0] } } }, // لو views مفيش خليها 0
      { $group: { _id: null, total: { $sum: "$views" } } },
    ]);

    res.json({
      totalViews: totalViews[0]?.total || 0,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
// ✅ Get Analytics Data
exports.getAnalyticsData = async (req, res) => {
  try {
    const { dateRange = "7days" } = req.query;

    // حساب التاريخ من وإلى
  let startDate = null;

  if (dateRange && dateRange !== "all") {
    startDate = new Date();
    switch (dateRange) {
      case "today":
        startDate.setHours(0, 0, 0, 0);
        break;
      case "7days":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "30days":
        startDate.setDate(startDate.getDate() - 30);
        break;
      case "90days":
        startDate.setDate(startDate.getDate() - 90);
        break;
    }
  }


    // 📊 Revenue Analytics (حسب التاريخ)
    const revenueData = await Property.aggregate([
      { $match: startDate ? { createdAt: { $gte: startDate } } : {} },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          totalRevenue: { $sum: "$price" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // 📊 Properties Growth (حسب التاريخ)
    const propertiesGrowth = await Property.aggregate([
      { $match: startDate ? { createdAt: { $gte: startDate } } : {} },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // 📊 Users Growth (حسب التاريخ)
    const usersGrowth = await User.aggregate([
      { $match: startDate ? { createdAt: { $gte: startDate } } : {} },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // 📊 Properties by Status
    const propertiesByStatus = await Property.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // 📊 Properties by Type
    const propertiesByType = await Property.aggregate([
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
    ]);

    // 📊 Users by Role
    const usersByRole = await User.aggregate([
      { $match: { role: { $ne: "admin" } } },
      {
        $group: {
          _id: "$role",
          count: { $sum: 1 },
        },
      },
    ]);

    // 📊 Top Properties by Views
    const topProperties = await Property.find()
      .sort({ views: -1 })
      .limit(10)
      .select("title projectName views price location");

    res.json({
      message: "Analytics data retrieved successfully",
      data: {
        revenueData,
        propertiesGrowth,
        usersGrowth,
        propertiesByStatus,
        propertiesByType,
        usersByRole,
        topProperties,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ✅ Get Performance Metrics
exports.getPerformanceMetrics = async (req, res) => {
  try {
    // 1️⃣ Total Properties
    const totalProperties = await Property.countDocuments();

    // 2️⃣ Properties Matching (مثال: كل العقارات اللي تم التحقق منها AI)
    const matchedProperties = await Property.countDocuments({ aiVerified: true });

    // 3️⃣ Price Analysis (كمية العقارات اللي السعر متوافق مع المتوسط مثلاً)
    const avgPriceAggregation = await Property.aggregate([
      { $group: { _id: null, avgPrice: { $avg: "$price" } } },
    ]);
    const avgPrice = avgPriceAggregation[0]?.avgPrice || 0;

    // مثال: 95% من العقارات أقل أو أعلى من المتوسط ب±10%
    const lowerBound = avgPrice * 0.9;
    const upperBound = avgPrice * 1.1;
    const withinPriceRange = await Property.countDocuments({
      price: { $gte: lowerBound, $lte: upperBound },
    });

    // 4️⃣ Document Verification (كمية العقارات اللي عندها documents)
    const withDocuments = await Property.countDocuments({ documents: { $exists: true, $not: { $size: 0 } } });

    // ⚡ احسب النسب المئوية
    const performanceMetrics = {
      propertyMatching: totalProperties ? ((matchedProperties / totalProperties) * 100).toFixed(0) + "%" : "0%",
      priceAnalysis: totalProperties ? ((withinPriceRange / totalProperties) * 100).toFixed(0) + "%" : "0%",
      documentVerification: totalProperties ? ((withDocuments / totalProperties) * 100).toFixed(0) + "%" : "0%",
    };

    res.json({
      message: "Performance Metrics retrieved successfully",
      data: performanceMetrics,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
exports.getSellerProperties = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      q,
      city,
      bedrooms,
      minPrice,
      maxPrice,
      type,
      listingStatus,
      features,
      status,
      dateRange,
    } = req.query;

    const filter = { seller: { $exists: true } }; // 💥 أهم جزء

    if (q) {
      filter.$or = [
        { title: new RegExp(q, "i") },
        { description: new RegExp(q, "i") },
        { "location.city": new RegExp(q, "i") },
        { "location.area": new RegExp(q, "i") },
      ];
    }

    // 📅 Date filter
    if (dateRange && dateRange !== "all") {
      let startDate = new Date();
      switch (dateRange) {
        case "today":
          startDate.setHours(0, 0, 0, 0);
          break;
        case "7days":
          startDate.setDate(startDate.getDate() - 7);
          break;
        case "30days":
          startDate.setDate(startDate.getDate() - 30);
          break;
        case "90days":
          startDate.setDate(startDate.getDate() - 90);
          break;
      }
      filter.createdAt = { $gte: startDate };
    }

    if (city) filter["location.city"] = city;
    if (bedrooms) filter.bedrooms = Number(bedrooms);
    if (type) filter.type = type;
    if (listingStatus) filter.listingStatus = listingStatus;
    if (features) filter.features = { $in: features.split(",") };
    if (status) filter.status = status;

    if (minPrice || maxPrice) filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);

    const skip = (page - 1) * limit;

    const properties = await Property.find(filter)
      .populate("seller", "name email phone")
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await Property.countDocuments(filter);

    res.json({
      message: "Seller properties retrieved successfully",
      data: properties,
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
exports.getDeveloperProjects = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      q,
      city,
      minPrice,
      maxPrice,
      bedrooms,
      type,
      listingStatus,
      features,
      status,
      dateRange,
    } = req.query;

    const filter = { developer: { $exists: true } }; // 💥 أهم جزء

    if (q) {
      filter.$or = [
        { title: new RegExp(q, "i") },
        { description: new RegExp(q, "i") },
        { projectName: new RegExp(q, "i") },
        { "location.city": new RegExp(q, "i") },
        { "location.area": new RegExp(q, "i") },
      ];
    }

    // 📅 Date filter
    if (dateRange && dateRange !== "all") {
      let startDate = new Date();
      switch (dateRange) {
        case "today":
          startDate.setHours(0, 0, 0, 0);
          break;
        case "7days":
          startDate.setDate(startDate.getDate() - 7);
          break;
        case "30days":
          startDate.setDate(startDate.getDate() - 30);
          break;
        case "90days":
          startDate.setDate(startDate.getDate() - 90);
          break;
      }
      filter.createdAt = { $gte: startDate };
    }

    if (city) filter["location.city"] = city;
    if (bedrooms) filter.bedrooms = Number(bedrooms);
    if (type) filter.type = type;
    if (listingStatus) filter.listingStatus = listingStatus;
    if (features) filter.features = { $in: features.split(",") };
    if (status) filter.status = status;

    if (minPrice || maxPrice) filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);

    const skip = (page - 1) * limit;

    const projects = await Property.find(filter)
      .populate("developer", "name email phone")
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await Property.countDocuments(filter);

    res.json({
      message: "Developer projects retrieved successfully",
      data: projects,
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
