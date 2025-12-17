const path = require("path");
const Property = require("../models/propertyModel");
const { createNotification } = require("./notificationController");

// ✅ Create property
// ✅ Create property (supports both seller & real_estate_developer)
exports.createProperty = async (req, res) => {
  try {
    const data = req.body;

    // 🧩 Parse JSON strings from FormData
    const parseIfString = (field) => {
      if (data[field] && typeof data[field] === "string") {
        try {
          data[field] = JSON.parse(data[field]);
        } catch {
          return res.status(400).json({ message: `Invalid ${field} format` });
        }
      }
    };

    ["location", "features", "documents", "developerInfo"].forEach(
      parseIfString
    );

    // 🧠 Detect user role (from token)
    const userRole = req.user?.role || "seller";

    // 🧍‍♂️ If seller — normal property
    if (userRole === "seller") {
      data.addedBy = req.user.id; // ✅
      data.seller = req.user.id;

      if (
        !data.title ||
        !data.price ||
        !data.location ||
        !data.location.city ||
        !data.type ||
        !data.listingStatus ||
        !data.area
      ) {
        return res.status(400).json({
          message:
            "For sellers: title, type, price, area, listingStatus, and location.city are required",
        });
      }
    }

    // 🏗️ If developer — project property
    else if (userRole === "real_estate_developer") {
      data.addedBy = req.user.id; // ✅
      data.developer = req.user.id;

      if (!data.projectName || !data.developerInfo) {
        return res.status(400).json({
          message: "For developers: projectName and developerInfo are required",
        });
      }
    }

    // 🧾 Terms acceptance (for all)
    if (!data.termsAccepted) {
      return res
        .status(400)
        .json({ message: "You must accept the terms to continue" });
    }

    // 🖼️ Handle uploaded files via Multer (5 images required)
    // 🖼️ Handle images (uploaded or via JSON)
    let uploadedImages = [];

    // الحالة 1️⃣: صور جاية من الـ FormData (مرفوعة فعليًا)
    if (req.files?.images && req.files.images.length > 0) {
      uploadedImages = req.files.images.map(
        (f) =>
          `${req.protocol}://${req.get("host")}/uploads/${path.basename(
            f.path
          )}`
      );
    }

    // الحالة 2️⃣: صور جاية كـ JSON لينكات
    if (data.images && Array.isArray(data.images)) {
      uploadedImages = [...uploadedImages, ...data.images];
    }

    // ✅ تحقق إن فيه 5 صور على الأقل
    if (!uploadedImages || uploadedImages.length < 5) {
      return res.status(400).json({
        message: "At least 5 images are required for a property.",
      });
    }

    data.images = uploadedImages;

    if (req.files?.documents) {
      data.documents = req.files.documents.map((f) => ({
        name: f.originalname,
        url: `${req.protocol}://${req.get("host")}/uploads/${path.basename(
          f.path
        )}`,
      }));
    }
    // ⚠️ تأكد من وجود location.coordinates
    if (!data.location) data.location = {};

    if (!data.location.coordinates) {
      data.location.coordinates = {
        type: "Point",
        coordinates: [31.2357, 30.0444], // longitude, latitude
      };
    }

    // ⚠️ تأكد من وجود addedBy
    if (!data.addedBy) {
      data.addedBy = req.user.id;
    }
    // ✅ Save property in DB
    const property = new Property(data);
    await property.save();
    // 🔔 إنشاء notification
     // 🧾 اسم المستخدم (يتعامل مع كل الحالات)
    const userName =
      req.user.name || req.user.username || req.user.email || "User";
    const isProject = userRole === "real_estate_developer";
    const propertyTitle = isProject ? property.projectName : property.title;

    // 👇 إشعار للأدمن فقط (كل الأدمنز)
    // هنجيب كل الأدمنز ونبعتلهم إشعار
    const User = require("../models/userModel");
    const admins = await User.find({ role: "admin" }).select("_id");

    // إنشاء إشعار لكل أدمن
    for (const admin of admins) {
      await createNotification({
        type: "info",
        title: isProject ? "New Project Created" : "New Property Listed",
        message: `${userName} added a new ${
          isProject ? "project" : "property"
        }: ${propertyTitle}`,
        recipient: admin._id, // 👈 كل أدمن لوحده
        recipientRole: "admin",
        referenceId: property._id,
        referenceType: "property",
      });
    }

    console.log(`✅ Sent ${admins.length} notifications to admins`);

    res.status(201).json({
      message:
        userRole === "real_estate_developer"
          ? "Developer project created successfully"
          : "Property created successfully",
      property,
    });
  } catch (err) {
    console.error("❌ Error creating property:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
//  Get properties (with filters and pagination)
//  ✅ Get properties created by sellers only (with filters and pagination)
exports.getProperties = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 12,
      q,
      city,
      area,
      minPrice,
      maxPrice,
      bedrooms,
      type,
      listingStatus,
      features,
      isFeatured,
      status,
    } = req.query;

    // ✅ filter only properties added by sellers and hide sold listings by default
    const filter = { seller: { $exists: true }, status: { $ne: "sold" } };

    if (q) {
      filter.$or = [
        { title: new RegExp(q, "i") },
        { description: new RegExp(q, "i") },
        { "location.city": new RegExp(q, "i") },
        { "location.area": new RegExp(q, "i") },
      ];
    }

    if (city) filter["location.city"] = new RegExp(`^${city}$`, "i");
    if (area) filter["location.area"] = new RegExp(`^${area}$`, "i");
    if (bedrooms) filter.bedrooms = Number(bedrooms);
    if (minPrice || maxPrice) filter.price = {};
    if (minPrice) filter.price.$gte = Number(minPrice);
    if (maxPrice) filter.price.$lte = Number(maxPrice);
    if (type) filter.type = type;
    if (listingStatus) filter.listingStatus = listingStatus;
    if (features) filter.features = { $in: features.split(",") };
    if (isFeatured) filter.isFeatured = isFeatured === "true";
    if (status) filter.status = status;

    const skip = (Number(page) - 1) * Number(limit);

    const items = await Property.find(filter)
      .populate("seller", "name email phone avatar")
      .skip(skip)
      .limit(Number(limit))
      .sort({ createdAt: -1 });

    const total = await Property.countDocuments(filter);

    res.json({
      message: "Seller properties retrieved successfully",
      data: items,
      total,
      page: Number(page),
      limit: Number(limit),
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ✅ Get single property
exports.getPropertyById = async (req, res) => {
  try {
    const prop = await Property.findById(req.params.id).populate(
      "seller",
      "name email phone avatar"
    );
    if (!prop) return res.status(404).json({ message: "Property not found" });
    res.json(prop);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};

exports.updateProperty = async (req, res) => {
  try {
    const propertyId = req.params.id;
    const userRole = req.user.role;
    const userId = req.user.id;

    // 🔍 تحقق من ملكية العقار
    const filter = { _id: propertyId };
    if (userRole === "seller") filter.seller = userId;
    if (userRole === "real_estate_developer") filter.developer = userId;

    let property = await Property.findOne(filter);
    if (!property) {
      return res
        .status(404)
        .json({ message: "Property not found or not authorized" });
    }

    const data = req.body;

    // 🧩 Parse JSON fields
    const parseIfString = (field) => {
      if (data[field] && typeof data[field] === "string") {
        try {
          data[field] = JSON.parse(data[field]);
        } catch {
          return res.status(400).json({ message: `Invalid ${field} format` });
        }
      }
    };
    [
      "location",
      "features",
      "documents",
      "developerInfo",
      "existingImages",
      "removeImages",
    ].forEach(parseIfString);

    // 🖼️ جهّز الصور الجديدة (لو اترفعت)
    let newImages = [];
    if (req.files?.images?.length > 0) {
      newImages = req.files.images.map(
        (f) =>
          `${req.protocol}://${req.get("host")}/uploads/${path.basename(
            f.path
          )}`
      );
    }

    // ✨ لو المستخدم حذف صور
    if (data.removeImages && Array.isArray(data.removeImages)) {
      property.images = property.images.filter(
        (img) => !data.removeImages.includes(img)
      );
    }

    // ✨ لو بعت existingImages من الواجهة
    if (data.existingImages && Array.isArray(data.existingImages)) {
      property.images = data.existingImages;
    }

    // ✨ دمج الصور القديمة اللي فضلت + الجديدة
    property.images = [...(property.images || []), ...newImages];

    // ✅ تأكد إن العدد النهائي ≥ 5
    if (!property.images || property.images.length < 5) {
      return res.status(400).json({
        message: "At least 5 images are required for a property.",
      });
    }

    // 🧾 Handle uploaded documents
    if (req.files?.documents) {
      const newDocs = req.files.documents.map((f) => ({
        name: f.originalname,
        url: `${req.protocol}://${req.get("host")}/uploads/${path.basename(
          f.path
        )}`,
      }));
      property.documents = [...(property.documents || []), ...newDocs];
    }

    // ❌ Handle document deletion
    if (data.removeDocuments && Array.isArray(data.removeDocuments)) {
      property.documents = property.documents.filter(
        (doc) => !data.removeDocuments.includes(doc.url)
      );
    }
    delete data.addedBy;
    delete data.seller;
    delete data.developer;

    // 📝 حدّث باقي البيانات
    Object.assign(property, data);
    // ⚠️ تأكد من وجود location.coordinates
    if (!property.location) property.location = {};

    if (!property.location.coordinates) {
      property.location.coordinates = {
        type: "Point",
        coordinates: [31.2357, 30.0444],
      };
    }

    // ⚠️ تأكد من وجود addedBy
    if (!property.addedBy) {
      property.addedBy = req.user.id;
    }
    // ⚠️ تأكد من وجود location.coordinates.coordinates بشكل صحيح
    if (!property.location) property.location = {};
    if (!property.location.coordinates) property.location.coordinates = {};
    if (!Array.isArray(property.location.coordinates.coordinates)) {
      property.location.coordinates.type = "Point";
      property.location.coordinates.coordinates = [31.2357, 30.0444]; // long, lat
    }

    // 💾 حفظ التعديلات
    await property.save();

    res.json({
      message: "Property updated successfully",
      property,
    });
  } catch (err) {
    console.error("❌ Error updating property:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};


// ✅ Delete property (supports seller & developer)
exports.deleteProperty = async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    // 🧠 إعداد الفلتر حسب نوع المستخدم
    const filter = { _id: req.params.id };
    if (role === "seller") filter.seller = userId;
    else if (role === "real_estate_developer") filter.developer = userId;
    else {
      return res.status(403).json({
        message:
          "Access denied — only sellers or developers can delete properties.",
      });
    }

    const deleted = await Property.findOneAndDelete(filter);

    if (!deleted) {
      return res
        .status(404)
        .json({ message: "Property not found or not authorized to delete" });
    }

    res.json({ message: "Property deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting property:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// ✅ Get properties created by current seller or developer
exports.getSellerProperties = async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    let filter = {};

    if (role === "seller") {
      filter = { seller: userId };
    } else if (role === "real_estate_developer") {
      filter = { developer: userId };
    } else {
      return res.status(403).json({
        message:
          "Access denied — Only sellers or real estate developers can view their properties.",
      });
    }

    const properties = await Property.find(filter)
      .populate(
        role === "seller" ? "seller" : "developer",
        "name email phone avatar"
      )
      .sort({ createdAt: -1 });

    if (!properties.length) {
      return res.json({
        message: "You don't have any properties yet.",
        data: [],
      });
    }

    res.json({
      message: "Properties retrieved successfully.",
      count: properties.length,
      data: properties,
    });
  } catch (err) {
    console.error("Error fetching properties:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};

// Get properties created by developers
exports.getDeveloperProperties = async (req, res) => {
  try {
    const properties = await Property.find({ developer: { $exists: true } })
      .populate("developer", "name email phone avatar")
      .sort({ createdAt: -1 });

    res.json({
      message: "Developer properties retrieved successfully",
      count: properties.length,
      data: properties,
    });
  } catch (err) {
    console.error("Error fetching developer properties:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
exports.incrementViews = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedProperty = await Property.findByIdAndUpdate(
      id,
      { $inc: { views: 1 } },
      { new: true } // ✅ مهم للحصول على النسخة المحدثة
    );

    res.json({ property: updatedProperty });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
