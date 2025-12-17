const mongoose = require("mongoose");
require("dotenv").config();

const Property = require("./models/propertyModel");
const Unit = require("./models/unitModel");
const User = require("./models/userModel");

/**
 * Seed Script للمشاريع والوحدات
 * استخدام: node seedDeveloperProjects.js
 */

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
    process.exit(1);
  }
};

const seedDeveloperProjects = async () => {
  try {
    await connectDB();

    // البحث عن المطور
    const developer = await User.findOne({ email: "developer2@test.com" });
    if (!developer) {
      console.error("❌ Developer not found with email: developer2@test.com");
      console.log("💡 Create developer account first or update the email");
      process.exit(1);
    }

    console.log(`✅ Found developer: ${developer.name} (${developer._id})`);

    // حذف المشاريع والوحدات القديمة للمطور
    const oldProjects = await Property.find({ developer: developer._id });
    for (const project of oldProjects) {
      await Unit.deleteMany({ project: project._id });
    }
    await Property.deleteMany({ developer: developer._id });
    console.log("🗑️  Cleaned old projects and units");

    // المشاريع الجديدة
    const projects = [
      {
        projectName: "مشروع النيل الجديد",
        title: "مشروع النيل الجديد - كمبوند سكني متكامل",
        description:
          "مشروع سكني فاخر على ضفاف النيل يضم وحدات سكنية متنوعة بمساحات مختلفة مع كافة الخدمات والمرافق",
        type: "project",
        developer: developer._id,
        addedBy: developer._id,
        location: {
          city: "القاهرة",
          area: "المعادي",
          address: "كورنيش النيل، المعادي",
          coordinates: {
            type: "Point",
            coordinates: [31.2569, 29.9602], // [lng, lat]
          },
        },
        price: 2500000,
        units: 120,
        completionPercentage: 75,
        status: "under-construction",
        features: [
          "أمن وحراسة 24/7",
          "مسبح أولمبي",
          "نادي رياضي",
          "حديقة مركزية",
          "موقف سيارات",
          "مول تجاري",
          "منطقة أطفال",
        ],
        images: [
          "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800",
          "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800",
        ],
        developerInfo: {
          name: developer.name,
          logo: developer.logo,
          phone: developer.phone || "+20 123 456 7890",
          email: developer.email,
          totalProjects: 5,
          description: "مطور عقاري رائد في السوق المصري",
        },
        // أنواع الوحدات المتاحة في هذا المشروع
        unitOptions: [
          {
            label: "شقة 2 غرف",
            size: "120-150 م²",
            view: "إطلالة على الحديقة",
            delivery: "تسليم 2026",
            price: "2,000,000 - 2,500,000 EGP",
          },
          {
            label: "شقة 3 غرف",
            size: "150-180 م²",
            view: "إطلالة على النيل",
            delivery: "تسليم 2026",
            price: "2,800,000 - 3,500,000 EGP",
          },
          {
            label: "بنتهاوس فاخر",
            size: "200-250 م²",
            view: "بانوراما النيل",
            delivery: "تسليم 2027",
            price: "5,000,000 - 7,000,000 EGP",
          },
        ],
        // خطط الدفع
        paymentPlans: [
          {
            name: "خطة 10 سنوات",
            downPayment: "10% مقدم",
            monthlyInstallment: "حسب المساحة",
            duration: "120 شهر",
          },
          {
            name: "خطة 7 سنوات",
            downPayment: "15% مقدم",
            monthlyInstallment: "حسب المساحة",
            duration: "84 شهر",
          },
          {
            name: "كاش",
            downPayment: "100%",
            monthlyInstallment: "-",
            duration: "دفعة واحدة - خصم 10%",
          },
        ],
        deliveryDate: "2026-2027",
      },
      {
        projectName: "مشروع جاردن سيتي",
        title: "جاردن سيتي - فلل فاخرة",
        description:
          "مشروع فلل فاخرة في قلب التجمع الخامس بتصميمات عصرية ومساحات خضراء واسعة",
        type: "project",
        developer: developer._id,
        addedBy: developer._id,
        location: {
          city: "القاهرة",
          area: "التجمع الخامس",
          address: "شارع التسعين، التجمع الخامس",
          coordinates: {
            type: "Point",
            coordinates: [31.4286, 30.0131],
          },
        },
        price: 5000000,
        units: 50,
        completionPercentage: 45,
        status: "under-construction",
        features: [
          "فلل منفصلة",
          "حدائق خاصة",
          "مسابح خاصة",
          "جراجات مغطاة",
          "بوابات ذكية",
          "نظام طاقة شمسية",
        ],
        images: [
          "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800",
          "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800",
        ],
        developerInfo: {
          name: developer.name,
          phone: developer.phone || "+20 123 456 7890",
          email: developer.email,
          totalProjects: 5,
        },
        // أنواع الوحدات المتاحة في هذا المشروع
        unitOptions: [
          {
            label: "فيلا منفصلة",
            size: "300-400 م²",
            view: "حديقة خاصة",
            delivery: "تسليم 2027",
            price: "5,000,000 - 6,500,000 EGP",
          },
          {
            label: "فيلا توين هاوس",
            size: "250-300 م²",
            view: "حديقة مشتركة",
            delivery: "تسليم 2027",
            price: "4,500,000 - 5,500,000 EGP",
          },
          {
            label: "فيلا مع مسبح",
            size: "400-500 م²",
            view: "إطلالة بانورامية",
            delivery: "تسليم 2028",
            price: "7,000,000 - 8,500,000 EGP",
          },
        ],
        // خطط الدفع
        paymentPlans: [
          {
            name: "خطة 8 سنوات",
            downPayment: "15% مقدم",
            monthlyInstallment: "حسب المساحة",
            duration: "96 شهر",
          },
          {
            name: "خطة 5 سنوات",
            downPayment: "25% مقدم",
            monthlyInstallment: "حسب المساحة",
            duration: "60 شهر",
          },
        ],
        deliveryDate: "2027-2028",
      },
      {
        projectName: "برج الماسة",
        title: "برج الماسة - الداون تاون الإداري الجديد",
        description:
          "برج إداري تجاري في قلب العاصمة الإدارية الجديدة مع وحدات مكتبية ومحلات تجارية",
        type: "project",
        developer: developer._id,
        addedBy: developer._id,
        location: {
          city: "القاهرة",
          area: "العاصمة الإدارية",
          address: "الداون تاون، العاصمة الإدارية الجديدة",
          coordinates: {
            type: "Point",
            coordinates: [31.7265, 30.0290],
          },
        },
        price: 1500000,
        units: 200,
        completionPercentage: 90,
        status: "completed",
        features: [
          "مصاعد حديثة",
          "تشطيب سوبر لوكس",
          "مولدات كهرباء",
          "نظام إطفاء حريق",
          "كاميرات مراقبة",
          "موقف متعدد الطوابق",
        ],
        images: [
          "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?w=800",
          "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800",
        ],
        developerInfo: {
          name: developer.name,
          phone: developer.phone || "+20 123 456 7890",
          email: developer.email,
          totalProjects: 5,
        },
        // أنواع الوحدات المتاحة في هذا المشروع
        unitOptions: [
          {
            label: "مكتب إداري",
            size: "50-100 م²",
            view: "إطلالة بانورامية",
            delivery: "استلام فوري",
            price: "1,000,000 - 2,500,000 EGP",
          },
          {
            label: "محل تجاري",
            size: "30-80 م²",
            view: "واجهة رئيسية",
            delivery: "استلام فوري",
            price: "800,000 - 2,000,000 EGP",
          },
        ],
        // خطط الدفع
        paymentPlans: [
          {
            name: "خطة 5 سنوات",
            downPayment: "20% مقدم",
            monthlyInstallment: "حسب المساحة",
            duration: "60 شهر",
          },
          {
            name: "كاش",
            downPayment: "100%",
            monthlyInstallment: "-",
            duration: "دفعة واحدة - خصم 15%",
          },
        ],
        deliveryDate: "استلام فوري",
      },
    ];

    console.log("📝 Creating projects...");
    const createdProjects = await Property.insertMany(projects);
    console.log(`✅ Created ${createdProjects.length} projects`);

    // إنشاء وحدات لكل مشروع
    console.log("\n📦 Creating units for each project...");

    // مشروع النيل الجديد - 120 وحدة سكنية
    const nilProject = createdProjects[0];
    const nilUnits = [];

    // 40 شقة من 2 غرفة
    for (let i = 1; i <= 40; i++) {
      nilUnits.push({
        project: nilProject._id,
        unitNumber: `A-${i}`,
        unitType: "apartment",
        floor: Math.floor((i - 1) / 4) + 1,
        area: 120 + Math.floor(Math.random() * 30),
        bedrooms: 2,
        bathrooms: 2,
        price: 2000000 + Math.floor(Math.random() * 500000),
        finishing: "fully_finished",
        view: i % 3 === 0 ? "garden" : "street",
        features: ["بلكونة", "مطبخ مجهز", "تكييف"],
        paymentPlan: {
          paymentType: "both",
          minDownPaymentPercent: 10,
          maxInstallmentYears: 8,
          cashDiscount: 5,
        },
        status: i <= 30 ? "available" : i <= 35 ? "booked" : "sold",
        deliveryDate: new Date("2026-12-31"),
      });
    }

    // 40 شقة من 3 غرف
    for (let i = 41; i <= 80; i++) {
      nilUnits.push({
        project: nilProject._id,
        unitNumber: `B-${i - 40}`,
        unitType: "apartment",
        floor: Math.floor((i - 41) / 4) + 1,
        area: 160 + Math.floor(Math.random() * 40),
        bedrooms: 3,
        bathrooms: 2,
        price: 2800000 + Math.floor(Math.random() * 700000),
        finishing: "fully_finished",
        view: i % 2 === 0 ? "garden" : "main_facade",
        features: ["بلكونة", "مطبخ مجهز", "تكييف", "غرفة خادمة"],
        paymentPlan: {
          paymentType: "both",
          minDownPaymentPercent: 15,
          maxInstallmentYears: 10,
          cashDiscount: 7,
        },
        status: i <= 70 ? "available" : i <= 75 ? "reserved" : "sold",
        deliveryDate: new Date("2026-12-31"),
      });
    }

    // 40 بنتهاوس فاخر
    for (let i = 81; i <= 120; i++) {
      nilUnits.push({
        project: nilProject._id,
        unitNumber: `P-${i - 80}`,
        unitType: "penthouse",
        floor: Math.floor((i - 81) / 4) + 15,
        area: 250 + Math.floor(Math.random() * 100),
        bedrooms: 4,
        bathrooms: 3,
        price: 5000000 + Math.floor(Math.random() * 2000000),
        finishing: "ultra_lux",
        view: "sea",
        features: [
          "تراس خاص",
          "جاكوزي",
          "مطبخ إيطالي",
          "غرفة خادمة",
          "Smart Home",
        ],
        paymentPlan: {
          paymentType: "both",
          minDownPaymentPercent: 20,
          maxInstallmentYears: 10,
          cashDiscount: 10,
        },
        status: i <= 100 ? "available" : i <= 110 ? "booked" : "sold",
        deliveryDate: new Date("2027-06-30"),
      });
    }

    await Unit.insertMany(nilUnits);
    console.log(`  ✅ Created ${nilUnits.length} units for ${nilProject.projectName}`);

    // مشروع جاردن سيتي - 50 فيلا
    const gardenProject = createdProjects[1];
    const gardenUnits = [];

    for (let i = 1; i <= 50; i++) {
      gardenUnits.push({
        project: gardenProject._id,
        unitNumber: `V-${i}`,
        unitType: "villa",
        floor: 1,
        area: 400 + Math.floor(Math.random() * 200),
        bedrooms: i <= 20 ? 4 : 5,
        bathrooms: i <= 20 ? 3 : 4,
        price: 5000000 + Math.floor(Math.random() * 3000000),
        finishing: "super_lux",
        view: "garden",
        features: [
          "حديقة خاصة 300م²",
          "مسبح خاص",
          "جراج لسيارتين",
          "غرفة سائق",
          "مطبخ خارجي",
          "Smart Home",
        ],
        paymentPlan: {
          paymentType: "both",
          minDownPaymentPercent: 25,
          maxInstallmentYears: 8,
          cashDiscount: 8,
        },
        status: i <= 35 ? "available" : i <= 43 ? "booked" : "sold",
        deliveryDate: new Date("2027-12-31"),
      });
    }

    await Unit.insertMany(gardenUnits);
    console.log(`  ✅ Created ${gardenUnits.length} units for ${gardenProject.projectName}`);

    // برج الماسة - 200 وحدة إدارية وتجارية
    const towerProject = createdProjects[2];
    const towerUnits = [];

    // 150 مكتب
    for (let i = 1; i <= 150; i++) {
      towerUnits.push({
        project: towerProject._id,
        unitNumber: `O-${i}`,
        unitType: "office",
        floor: Math.floor((i - 1) / 10) + 1,
        area: 50 + Math.floor(Math.random() * 100),
        bedrooms: 0,
        bathrooms: 1,
        price: 1000000 + Math.floor(Math.random() * 1500000),
        finishing: "fully_finished",
        view: i % 3 === 0 ? "city" : "main_facade",
        features: ["تكييف مركزي", "إنترنت", "كاميرات", "نظام إنذار"],
        paymentPlan: {
          paymentType: "both",
          minDownPaymentPercent: 20,
          maxInstallmentYears: 5,
          cashDiscount: 10,
        },
        status: i <= 100 ? "available" : i <= 130 ? "reserved" : "sold",
        deliveryDate: new Date("2025-06-30"),
        isReady: true,
      });
    }

    // 50 محل تجاري
    for (let i = 151; i <= 200; i++) {
      towerUnits.push({
        project: towerProject._id,
        unitNumber: `S-${i - 150}`,
        unitType: "shop",
        floor: 0,
        area: 30 + Math.floor(Math.random() * 70),
        bedrooms: 0,
        bathrooms: 1,
        price: 800000 + Math.floor(Math.random() * 1200000),
        finishing: "core_shell",
        view: "main_facade",
        features: ["واجهة زجاجية", "مدخل مستقل", "تكييف"],
        paymentPlan: {
          paymentType: "both",
          minDownPaymentPercent: 30,
          maxInstallmentYears: 5,
          cashDiscount: 15,
        },
        status: i <= 180 ? "available" : i <= 190 ? "booked" : "sold",
        deliveryDate: new Date("2025-03-31"),
        isReady: true,
      });
    }

    await Unit.insertMany(towerUnits);
    console.log(`  ✅ Created ${towerUnits.length} units for ${towerProject.projectName}`);

    // إحصائيات نهائية
    console.log("\n📊 Final Statistics:");
    console.log(`  • Total Projects: ${createdProjects.length}`);
    console.log(`  • Total Units: ${nilUnits.length + gardenUnits.length + towerUnits.length}`);
    console.log(`  • Developer: ${developer.name} (${developer.email})`);

    console.log("\n✨ Seeding completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error during seeding:", error);
    process.exit(1);
  }
};

// تشغيل السكريبت
seedDeveloperProjects();
