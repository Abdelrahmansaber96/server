require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/userModel");
const Property = require("./models/propertyModel");
const Deal = require("./models/dealModel");
const Contract = require("./models/contractModel");
const Payment = require("./models/paymentModel");

// 🎯 بيانات اختبارية كاملة
const seedDatabase = async () => {
  try {
    // الاتصال بقاعدة البيانات
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ Connected to MongoDB");

    // حذف البيانات القديمة
    console.log("🗑️  Clearing old data...");
    await User.deleteMany({});
    await Property.deleteMany({});
    await Deal.deleteMany({});
    await Contract.deleteMany({});
    await Payment.deleteMany({});
    console.log("✅ Old data cleared");

    // تشفير الباسورد
    const hashedPassword = await bcrypt.hash("123456", 10);

    // ==========================================
    // 1️⃣ إنشاء المستخدمين
    // ==========================================
    console.log("👥 Creating users...");
    const users = await User.create([
      {
        name: "Ahmed Mohamed",
        email: "buyer1@test.com",
        password: hashedPassword,
        role: "buyer",
        phone: "+201001234567",
      },
      {
        name: "Sara Ali",
        email: "buyer2@test.com",
        password: hashedPassword,
        role: "buyer",
        phone: "+201002345678",
      },
      {
        name: "Mohamed Hassan",
        email: "seller1@test.com",
        password: hashedPassword,
        role: "seller",
        phone: "+201003456789",
      },
      {
        name: "Fatima Ibrahim",
        email: "seller2@test.com",
        password: hashedPassword,
        role: "seller",
        phone: "+201004567890",
      },
      {
        name: "Elite Developments",
        email: "developer1@test.com",
        password: hashedPassword,
        role: "real_estate_developer",
        phone: "+201005678901",
      },
      {
        name: "Luxury Properties Co.",
        email: "developer2@test.com",
        password: hashedPassword,
        role: "real_estate_developer",
        phone: "+201006789012",
      },
    ]);

    const [buyer1, buyer2, seller1, seller2, developer1, developer2] = users;
    console.log("✅ Users created:", users.length);

    // ==========================================
    // 2️⃣ إنشاء عقارات للبائعين (Sellers)
    // ==========================================
    console.log("🏠 Creating seller properties...");
    const sellerProperties = await Property.create([
      {
        title: "Luxury Villa in New Cairo",
        type: "villa",
        description:
          "Beautiful 4-bedroom villa with private pool and garden in a gated community.",
        location: {
          city: "Cairo",
          area: "New Cairo",
          nearBy: ["Cairo Festival City", "American University", "Mall"],
          coordinates: { type: "Point", coordinates: [31.4913, 30.0131] },
        },
        price: 5500000,
        area: 350,
        bedrooms: 4,
        bathrooms: 3,
        listingStatus: "sale",
        images: [
          "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800",
          "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800",
          "https://images.unsplash.com/photo-1613977257363-707ba9348227?w=800",
          "https://images.unsplash.com/photo-1613490493576-7fde63acd811?w=800",
          "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800",
        ],
        features: [
          "Swimming Pool",
          "Garden",
          "Parking",
          "Security System",
          "Smart Home",
        ],
        isFeatured: true,
        seller: seller1._id,
        addedBy: "seller",
        termsAccepted: true,
        status: "available",
      },
      {
        title: "Modern Apartment in Zamalek",
        type: "apartment",
        description:
          "Stunning 3-bedroom apartment with Nile view in the heart of Zamalek.",
        location: {
          city: "Cairo",
          area: "Zamalek",
          nearBy: ["Nile River", "Cairo Tower", "Shops"],
          coordinates: { type: "Point", coordinates: [31.2226, 30.0626] },
        },
        price: 3200000,
        area: 180,
        bedrooms: 3,
        bathrooms: 2,
        listingStatus: "sale",
        images: [
          "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800",
          "https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800",
          "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800",
          "https://images.unsplash.com/photo-1484154218962-a197022b5858?w=800",
          "https://images.unsplash.com/photo-1556912173-46c336c7fd55?w=800",
        ],
        features: ["Central AC", "Elevator", "Balcony/Terrace", "City View"],
        seller: seller1._id,
        addedBy: "seller",
        termsAccepted: true,
        status: "available",
      },
      {
        title: "Spacious Villa in 6th October",
        type: "villa",
        description:
          "Large family villa with modern amenities in a quiet neighborhood.",
        location: {
          city: "Giza",
          area: "6th October City",
          nearBy: ["Mall of Arabia", "Schools", "Hospitals"],
          coordinates: { type: "Point", coordinates: [31.0522, 29.9668] },
        },
        price: 4800000,
        area: 400,
        bedrooms: 5,
        bathrooms: 4,
        listingStatus: "sale",
        images: [
          "https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=800",
          "https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?w=800",
          "https://images.unsplash.com/photo-1605276374104-dee2a0ed3cd6?w=800",
          "https://images.unsplash.com/photo-1600607687644-c7171b42498b?w=800",
          "https://images.unsplash.com/photo-1600566753086-00f18fb6b3ea?w=800",
        ],
        features: ["Garden", "Parking", "Gym/Fitness Center", "Security System"],
        seller: seller2._id,
        addedBy: "seller",
        termsAccepted: true,
        status: "available",
      },
      {
        title: "Cozy Apartment in Maadi",
        type: "apartment",
        description: "Charming 2-bedroom apartment in the green district of Maadi.",
        location: {
          city: "Cairo",
          area: "Maadi",
          nearBy: ["Metro Station", "Restaurants", "Parks"],
          coordinates: { type: "Point", coordinates: [31.2654, 29.9602] },
        },
        price: 2500000,
        area: 120,
        bedrooms: 2,
        bathrooms: 2,
        listingStatus: "rent",
        images: [
          "https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=800",
          "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800",
          "https://images.unsplash.com/photo-1501876991173-f9c47cd28268?w=800",
          "https://images.unsplash.com/photo-1560185127-6a7e6c4c3c15?w=800",
          "https://images.unsplash.com/photo-1484101403633-562f891dc89a?w=800",
        ],
        features: ["Balcony/Terrace", "Central AC", "Pet Friendly"],
        seller: seller2._id,
        addedBy: "seller",
        termsAccepted: true,
        status: "available",
      },
    ]);
    console.log("✅ Seller properties created:", sellerProperties.length);

    // ==========================================
    // 3️⃣ إنشاء مشاريع للمطورين (Developers)
    // ==========================================
    console.log("🏗️  Creating developer projects...");
    const developerProjects = await Property.create([
      {
        projectName: "Marina Bay Residences",
        type: "project",
        description:
          "Luxury waterfront living with stunning views and world-class amenities in Dubai Marina.",
        location: {
          city: "Dubai",
          area: "Dubai Marina",
          nearBy: ["Beach", "Metro", "Shopping Mall"],
          coordinates: { type: "Point", coordinates: [55.1398, 25.0805] },
        },
        price: 1800000,
        units: 45,
        completionPercentage: 75,
        status: "under-construction",
        images: [
          "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800",
          "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800",
          "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=800",
          "https://images.unsplash.com/photo-1554995207-c18c203602cb?w=800",
          "https://images.unsplash.com/photo-1534237710431-e2fc698436d0?w=800",
        ],
        features: ["Swimming Pool", "Gym", "Security", "Parking", "Beach Access"],
        developer: developer1._id,
        addedBy: "real_estate_developer",
        developerInfo: {
          logo: "https://via.placeholder.com/150",
          location: "Dubai, UAE",
          totalProjects: 15,
          phone: "+971501234567",
          email: "info@elitedevelopments.ae",
          website: "www.elitedevelopments.ae",
          description: "Leading real estate developer in UAE since 2010",
        },
        termsAccepted: true,
      },
      {
        projectName: "Downtown Luxury Towers",
        type: "project",
        description:
          "Modern residential towers in the heart of Downtown Dubai with panoramic city views.",
        location: {
          city: "Dubai",
          area: "Downtown Dubai",
          nearBy: ["Burj Khalifa", "Dubai Mall", "Business Bay"],
          coordinates: { type: "Point", coordinates: [55.2744, 25.1972] },
        },
        price: 2500000,
        units: 120,
        completionPercentage: 90,
        status: "completed",
        images: [
          "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800",
          "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800",
          "https://images.unsplash.com/photo-1582268611958-ebfd161ef9cf?w=800",
          "https://images.unsplash.com/photo-1565402170291-8491f14678db?w=800",
          "https://images.unsplash.com/photo-1567767292278-a4f21aa2d36e?w=800",
        ],
        features: [
          "Swimming Pool",
          "Gym",
          "Parking",
          "City View",
          "Smart Home",
        ],
        developer: developer2._id,
        addedBy: "real_estate_developer",
        developerInfo: {
          logo: "https://via.placeholder.com/150",
          location: "Dubai, UAE",
          totalProjects: 25,
          phone: "+971502345678",
          email: "contact@luxuryproperties.ae",
          website: "www.luxuryproperties.ae",
          description: "Premium luxury properties developer in Dubai",
        },
        termsAccepted: true,
      },
    ]);
    console.log("✅ Developer projects created:", developerProjects.length);

    // ==========================================
    // 4️⃣ إنشاء صفقات (Deals)
    // ==========================================
    console.log("💼 Creating deals...");
    const deals = await Deal.create([
      {
        property: sellerProperties[0]._id, // Luxury Villa
        buyer: buyer1._id,
        seller: seller1._id,
        offerPrice: 5300000,
        status: "pending",
        messages: [
          {
            sender: buyer1._id,
            text: "I'm interested in this villa. Can we negotiate the price?",
            sentAt: new Date("2024-11-01"),
          },
          {
            sender: seller1._id,
            text: "Thank you for your interest. The price is slightly negotiable. What's your offer?",
            sentAt: new Date("2024-11-01"),
          },
        ],
      },
      {
        property: sellerProperties[1]._id, // Modern Apartment
        buyer: buyer2._id,
        seller: seller1._id,
        offerPrice: 3200000,
        finalPrice: 3200000,
        status: "accepted",
        messages: [
          {
            sender: buyer2._id,
            text: "I would like to buy this apartment at the listed price.",
            sentAt: new Date("2024-10-28"),
          },
          {
            sender: seller1._id,
            text: "Great! I accept your offer. Let's proceed with the contract.",
            sentAt: new Date("2024-10-28"),
          },
        ],
      },
      {
        property: sellerProperties[2]._id, // Spacious Villa
        buyer: buyer1._id,
        seller: seller2._id,
        offerPrice: 4500000,
        status: "rejected",
        messages: [
          {
            sender: buyer1._id,
            text: "Can you accept 4.5M for this villa?",
            sentAt: new Date("2024-10-25"),
          },
          {
            sender: seller2._id,
            text: "Sorry, the price is firm at 4.8M.",
            sentAt: new Date("2024-10-25"),
          },
        ],
      },
    ]);
    console.log("✅ Deals created:", deals.length);

    // ==========================================
    // 5️⃣ إنشاء عقود (Contracts)
    // ==========================================
    console.log("📄 Creating contracts...");
    const contracts = await Contract.create([
      {
        contractNumber: "CT-2024-001",
        deal: deals[1]._id, // Accepted deal
        buyer: buyer2._id,
        seller: seller1._id,
        property: sellerProperties[1]._id,
        totalPrice: 3200000,
        status: "active",
        signed: true,
        paymentPlan: [
          {
            amount: 1000000,
            dueDate: new Date("2024-11-15"),
            status: "paid",
            paidAt: new Date("2024-11-10"),
            method: "Visa",
          },
          {
            amount: 1100000,
            dueDate: new Date("2024-12-15"),
            status: "pending",
          },
          {
            amount: 1100000,
            dueDate: new Date("2025-01-15"),
            status: "pending",
          },
        ],
      },
    ]);
    console.log("✅ Contracts created:", contracts.length);

    // ==========================================
    // 6️⃣ إنشاء مدفوعات (Payments)
    // ==========================================
    console.log("💰 Creating payments...");
    const payments = await Payment.create([
      {
        contract: contracts[0]._id,
        payer: buyer2._id,
        amount: 1000000,
        method: "Visa",
        status: "success",
        transactionId: "TXN-2024-001",
        paidAt: new Date("2024-11-10"),
      },
    ]);
    console.log("✅ Payments created:", payments.length);

    // ==========================================
    // ✅ ملخص البيانات
    // ==========================================
    console.log("\n🎉 ======== SEED COMPLETED ========");
    console.log(`👥 Users: ${users.length}`);
    console.log(`🏠 Seller Properties: ${sellerProperties.length}`);
    console.log(`🏗️  Developer Projects: ${developerProjects.length}`);
    console.log(`💼 Deals: ${deals.length}`);
    console.log(`📄 Contracts: ${contracts.length}`);
    console.log(`💰 Payments: ${payments.length}`);
    console.log("\n📧 Test Accounts:");
    console.log("Buyer 1: buyer1@test.com / 123456");
    console.log("Buyer 2: buyer2@test.com / 123456");
    console.log("Seller 1: seller1@test.com / 123456");
    console.log("Seller 2: seller2@test.com / 123456");
    console.log("Developer 1: developer1@test.com / 123456");
    console.log("Developer 2: developer2@test.com / 123456");
    console.log("===================================\n");

    mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    mongoose.connection.close();
    process.exit(1);
  }
};

// تشغيل الـ Seed
seedDatabase();
