const User = require("../models/userModel");
const Property = require("../models/propertyModel");
const mongoose = require("mongoose");

exports.getDashboardStats = async (req, res) => {
  try {
    const { q, dateRange } = req.query;

    // ============================
    // 🔵 Build Filters
    // ============================
    let userFilter = {};
    let propertyFilter = {};

    // --- Search Filter ---
    if (q) {
      userFilter.$or = [
        { name: { $regex: q, $options: "i" } },
        { email: { $regex: q, $options: "i" } },
      ];

      propertyFilter.$or = [
        { title: { $regex: q, $options: "i" } },
        { "location.city": { $regex: q, $options: "i" } },
        { "location.area": { $regex: q, $options: "i" } },
      ];
    }

    // --- Date Range Filter ---
    if (dateRange) {
      const now = new Date();
      let startDate;

      if (dateRange === "today")
        startDate = new Date(new Date().setHours(0, 0, 0, 0));
      if (dateRange === "7days")
        startDate = new Date(now - 7 * 24 * 60 * 60 * 1000);
      if (dateRange === "30days")
        startDate = new Date(now - 30 * 24 * 60 * 60 * 1000);
      if (dateRange === "90days")
        startDate = new Date(now - 90 * 24 * 60 * 60 * 1000);

      userFilter.createdAt = { $gte: startDate };
      propertyFilter.createdAt = { $gte: startDate };
    }

    // ============================
    // 🔵 Users Count by Role
    // ============================
    const usersCount = await User.aggregate([
      { $match: userFilter },
      { $group: { _id: "$role", count: { $sum: 1 } } },
    ]);

    // ============================
    // 🔵 Properties Count by Status
    // ============================
    const propertiesCount = await Property.aggregate([
      { $match: propertyFilter },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    // ============================
    // 🔵 Developer Projects
    // ============================
    const developerIds = await User.find({
      role: "real_estate_developer",
      ...(q ? { name: { $regex: q, $options: "i" } } : {}),
      ...(dateRange ? { createdAt: userFilter.createdAt } : {}),
    }).distinct("_id");

    const developerProjects = await Property.countDocuments({
      developer: { $in: developerIds },
      ...propertyFilter,
    });

    // ============================
    // 🔵 Featured Properties
    // ============================
    const featuredProperties = await Property.countDocuments({
      isFeatured: true,
      ...propertyFilter,
    });

    // ============================
    // 🔵 Response
    // ============================
    res.json({
      message: "Dashboard stats retrieved successfully",
      data: {
        usersCount,
        propertiesCount,
        developerProjects,
        featuredProperties,
      },
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// 🟢 Get recent activity with pagination
// 🟢 Get recent activity with pagination
exports.getAllActivity = async (req, res) => {
  try {
    const { page = 1, limit = 20, dateRange, q } = req.query; // ✅ أضف q

    // 📅 فلتر حسب التاريخ
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

    const userFilter = startDate ? { createdAt: { $gte: startDate } } : {};
    const propertyFilter = startDate ? { createdAt: { $gte: startDate } } : {};

    // ✅ أضف البحث
    if (q) {
      userFilter.$or = [
        { name: new RegExp(q, "i") },
        { email: new RegExp(q, "i") },
      ];
      propertyFilter.$or = [
        { title: new RegExp(q, "i") },
        { projectName: new RegExp(q, "i") },
        { "location.city": new RegExp(q, "i") },
      ];
    }

    // جلب المستخدمين
    const allUsers = await User.find(userFilter)
      .sort({ createdAt: -1 })
      .select("name role createdAt");

    // جلب العقارات والمشاريع
    const allProperties = await Property.find(propertyFilter)
      .sort({ createdAt: -1 })
      .select("title status createdAt projectName type");

    // تحويل البيانات لنموذج النشاط
    const allActivity = [
      ...allUsers.map((u) => ({
        type: "user",
        title: "New user registered",
        description: `${u.name} signed up as ${u.role}`,
        time: u.createdAt,
      })),
      ...allProperties.map((p) => ({
        type: "property",
        title: p.type === "project" ? "Project listed" : "Property listed",
        description:
          p.type === "project"
            ? `${p.projectName || "Unnamed Project"} added with status ${p.status}`
            : `${p.title || "Untitled Property"} added with status ${p.status}`,
        time: p.createdAt,
      })),
    ].sort((a, b) => new Date(b.time) - new Date(a.time));

    // ✅ تطبيق pagination
    const skip = (page - 1) * limit;
    const total = allActivity.length;
    const paginatedActivity = allActivity.slice(skip, skip + Number(limit));
    const totalPages = Math.ceil(total / limit);

    res.json({
      message: "All activity",
      data: paginatedActivity,
      total,
      page: Number(page),
      pages: totalPages,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
exports.getNotifications = async (req, res) => {
  try {
    // جلب كل المستخدمين بدون limit
    const allUsers = await User.find()
      .sort({ createdAt: -1 })
      .select("name role createdAt");

    // جلب كل العقارات والمشاريع بدون limit
    const allProperties = await Property.find()
      .sort({ createdAt: -1 })
      .select("title status createdAt projectName userRole");

    const notifications = [
      ...allUsers.map((u) => ({
        id: `user-${u._id}`, // id فريد
        type: "success",
        title: "New User Registered",
        message: `${u.name} signed up as ${u.role}`,
        time: u.createdAt,
        read: false,
      })),
      ...allProperties.map((p) => ({
        id: `property-${p._id}`, // id فريد
        type: "info",
        title:
          p.userRole === "real_estate_developer"
            ? "Project Listed"
            : "Property Listed",
        message:
          p.userRole === "real_estate_developer"
            ? `${p.projectName} added with status ${p.status}`
            : `${p.title} added with status ${p.status}`,
        time: p.createdAt,
        read: false,
      })),
    ]
      .sort((a, b) => new Date(b.time) - new Date(a.time))
      .slice(0, 10); // آخر 10 إشعارات فقط

    res.json({ message: "Notifications retrieved", data: notifications });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// // 🟢 Dashboard search (with pagination)
// exports.searchDashboard = async (req, res) => {
//   try {
//     const { q, dateRange, page = 1, limit = 20 } = req.query;

//     // حساب التاريخ بناءً على الفلتر
//     let startDate = null;

//     if (dateRange && dateRange !== "all") {
//       const now = new Date();
//       switch (dateRange) {
//         case "today":
//           startDate = new Date(now.setHours(0, 0, 0, 0));
//           break;
//         case "7days":
//           startDate = new Date(now.setDate(now.getDate() - 7));
//           break;
//         case "30days":
//           startDate = new Date(now.setDate(now.getDate() - 30));
//           break;
//         case "90days":
//           startDate = new Date(now.setDate(now.getDate() - 90));
//           break;
//       }
//     }

//     const skip = (page - 1) * limit;

//     // ---------------- Users (with pagination) ----------------
//     const userFilter = { role: { $ne: "admin" } };
//     if (q) {
//       userFilter.$or = [
//         { name: new RegExp(q, "i") },
//         { email: new RegExp(q, "i") },
//         { phone: new RegExp(q, "i") },
//       ];
//     }
//     if (startDate) userFilter.createdAt = { $gte: startDate };

//     const users = await User.find(userFilter)
//       .select("-password")
//       .skip(skip)
//       .limit(Number(limit))
//       .sort({ createdAt: -1 });

//     const totalUsers = await User.countDocuments(userFilter);

//     // ---------------- Properties (with pagination) ----------------
//     const propertyFilter = {};
//     if (q) {
//       propertyFilter.$or = [
//         { title: new RegExp(q, "i") },
//         { description: new RegExp(q, "i") },
//         { "location.city": new RegExp(q, "i") },
//         { "location.area": new RegExp(q, "i") },
//       ];
//     }
//     if (startDate) propertyFilter.createdAt = { $gte: startDate };

//     const properties = await Property.find(propertyFilter)
//       .populate("seller developer", "name email phone")
//       .skip(skip)
//       .limit(Number(limit))
//       .sort({ createdAt: -1 });

//     const totalProperties = await Property.countDocuments(propertyFilter);

//     // ---------------- Stats ----------------
//     const usersCount = await User.aggregate([
//       { $match: startDate ? { createdAt: { $gte: startDate } } : {} },
//       { $group: { _id: "$role", count: { $sum: 1 } } },
//     ]);

//     const propertiesCount = await Property.aggregate([
//       { $match: startDate ? { createdAt: { $gte: startDate } } : {} },
//       { $group: { _id: "$status", count: { $sum: 1 } } },
//     ]);

//     const developerIds = await User.find({
//       role: "real_estate_developer",
//     }).distinct("_id");

//     const developerProjects = await Property.countDocuments({
//       developer: { $in: developerIds },
//       ...(startDate && { createdAt: { $gte: startDate } }),
//     });

//     const featuredProperties = await Property.countDocuments({
//       isFeatured: true,
//       ...(startDate && { createdAt: { $gte: startDate } }),
//     });

//     const stats = {
//       usersCount,
//       propertiesCount,
//       developerProjects,
//       featuredProperties,
//     };

//     // ---------------- Recent Activity (with pagination) ----------------
//     const allActivity = [
//       ...users.map((u) => ({
//         type: "user",
//         title: "New user registered",
//         description: `${u.name} signed up as ${u.role}`,
//         time: u.createdAt,
//       })),
//       ...properties.map((p) => ({
//         type: "property",
//         title: "Property listed",
//         description: `${p.title || "Untitled Property"} added with status ${p.status}`,
//         time: p.createdAt,
//       })),
//     ].sort((a, b) => new Date(b.time) - new Date(a.time));

//     const totalActivity = allActivity.length;

//     res.json({
//       message: "Search results",
//       data: {
//         users,
//         properties,
//         stats,
//         allActivity,
//       },
//       pagination: {
//         users: {
//           total: totalUsers,
//           page: Number(page),
//           pages: Math.ceil(totalUsers / limit),
//         },
//         properties: {
//           total: totalProperties,
//           page: Number(page),
//           pages: Math.ceil(totalProperties / limit),
//         },
//         activity: {
//           total: totalActivity,
//           page: Number(page),
//           pages: Math.ceil(totalActivity / limit),
//         },
//       },
//     });
//   } catch (err) {
//     res.status(500).json({ message: "Server error", error: err.message });
//   }
// };