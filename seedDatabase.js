require("dotenv").config({ path: "./server/.env" });
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const User = require("./models/userModel");
const Property = require("./models/propertyModel");

const MONGO_URI = process.env.MONGO_URI;

// Connect to MongoDB
async function connectDB() {
  try {
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log("✅ MongoDB connected");
  } catch (error) {
    console.error("❌ MongoDB connection error:", error.message);
    process.exit(1);
  }
}

// Create users
async function createUsers() {
  try {
    console.log("\n📝 Creating users...");

    // 1. Seller User
    const sellerPassword = await bcrypt.hash("12356", 10);
    const sellerExists = await User.findOne({ email: "buyer1@test.com" });
    
    if (!sellerExists) {
      const seller = new User({
        name: "أحمد الحسن - بائع",
        email: "buyer1@test.com",
        password: sellerPassword,
        role: "seller",
        phone: "+201001234567",
      });
      await seller.save();
      console.log("✅ Seller created: buyer1@test.com / 12356");
    } else {
      console.log("⚠️  Seller already exists");
    }

    // 2. Developer User
    const developerPassword = await bcrypt.hash("dev12345", 10);
    const developerExists = await User.findOne({ email: "developer@realestate.com" });
    
    if (!developerExists) {
      const developer = new User({
        name: "شركة التطوير العقاري - مطور",
        email: "developer@realestate.com",
        password: developerPassword,
        role: "real_estate_developer",
        phone: "+201001234568",
      });
      await developer.save();
      console.log("✅ Developer created: developer@realestate.com / dev12345");
    } else {
      console.log("⚠️  Developer already exists");
    }

    // Get seller and developer for reference
    const seller = await User.findOne({ email: "buyer1@test.com" });
    const developer = await User.findOne({ email: "developer@realestate.com" });

    return { seller, developer };
  } catch (error) {
    console.error("❌ Error creating users:", error.message);
    throw error;
  }
}

// Create properties from seller
async function createSellerProperties(seller) {
  try {
    console.log("\n🏠 Creating seller properties...");

    const sellerProperties = [
      {
        title: "شقة فاخرة في الزمالك",
        type: "apartment",
        description: "شقة حديثة بتصميم عصري في قلب الزمالك، طابق عالي مع إطلالة على النيل",
        price: 3500000,
        area: 180,
        bedrooms: 3,
        bathrooms: 2,
        listingStatus: "sale",
        location: {
          city: "Cairo",
          area: "Zamalek",
          coordinates: { type: "Point", coordinates: [31.2226, 30.0626] },
          nearBy: ["Nile River", "Cairo Tower", "Shops & Restaurants"],
        },
        images: [
          "https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=800",
          "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800",
        ],
        features: ["Central AC", "Elevator", "Balcony", "City View"],
        seller: seller._id,
        addedBy: "seller",
        status: "available",
      },
      {
        title: "فيلا فاخرة في المعادي",
        type: "villa",
        description: "فيلا مستقلة بمساحة واسعة مع حديقة خاصة وحمام سباحة",
        price: 6000000,
        area: 400,
        bedrooms: 4,
        bathrooms: 3,
        listingStatus: "sale",
        location: {
          city: "Cairo",
          area: "Maadi",
          coordinates: { type: "Point", coordinates: [31.2654, 29.9602] },
          nearBy: ["Metro Station", "Restaurants", "Parks"],
        },
        images: [
          "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800",
          "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800",
        ],
        features: ["Swimming Pool", "Garden", "Parking", "Security System"],
        seller: seller._id,
        addedBy: "seller",
        status: "available",
      },
      {
        title: "شقة للإيجار في مدينة نصر",
        type: "apartment",
        description: "شقة بمواصفات عالية في موقع ممتاز بالقرب من جميع الخدمات",
        price: 250000,
        area: 150,
        bedrooms: 2,
        bathrooms: 2,
        listingStatus: "rent",
        location: {
          city: "Cairo",
          area: "Nasr City",
          coordinates: { type: "Point", coordinates: [31.3368, 30.0588] },
          nearBy: ["Shopping Malls", "Schools", "Hospitals"],
        },
        images: [
          "https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=800",
          "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800",
        ],
        features: ["Air Conditioning", "Furnished", "Balcony"],
        seller: seller._id,
        addedBy: "seller",
        status: "available",
      },
    ];

    for (const property of sellerProperties) {
      const exists = await Property.findOne({ title: property.title });
      if (!exists) {
        const newProperty = new Property(property);
        await newProperty.save();
        console.log(`✅ Created: ${property.title}`);
      } else {
        console.log(`⚠️  Already exists: ${property.title}`);
      }
    }
  } catch (error) {
    console.error("❌ Error creating seller properties:", error.message);
    throw error;
  }
}

// Generate bulk properties data
async function generateBulkProperties(seller, developer) {
  const properties = [];
  
  // محافظات وأماكن مصر والدول العربية
  const locations = [
    // مصر - القاهرة
    { city: "Cairo", area: "Zamalek", lat: 31.2226, lng: 30.0626 },
    { city: "Cairo", area: "Downtown", lat: 30.0444, lng: 31.2357 },
    { city: "Cairo", area: "Heliopolis", lat: 30.0862, lng: 31.3369 },
    { city: "Cairo", area: "New Cairo", lat: 30.0131, lng: 31.4913 },
    { city: "Cairo", area: "Maadi", lat: 29.9602, lng: 31.2654 },
    { city: "Cairo", area: "Nasr City", lat: 30.0588, lng: 31.3368 },
    { city: "Cairo", area: "Mohandessin", lat: 30.0403, lng: 31.1976 },
    { city: "Cairo", area: "Dokki", lat: 30.0361, lng: 31.2103 },
    { city: "Cairo", area: "Giza", lat: 30.0131, lng: 31.2089 },
    
    // مصر - الإسكندرية
    { city: "Alexandria", area: "Downtown", lat: 31.2965, lng: 29.9187 },
    { city: "Alexandria", area: "Sidi Bishr", lat: 31.2316, lng: 29.9606 },
    { city: "Alexandria", area: "Montaza", lat: 31.2774, lng: 30.0839 },
    { city: "Alexandria", area: "Mandara", lat: 31.2516, lng: 30.0678 },
    { city: "Alexandria", area: "Agami", lat: 31.1797, lng: 29.7686 },
    
    // مصر - أسوان
    { city: "Aswan", area: "Downtown", lat: 24.0934, lng: 32.8800 },
    { city: "Aswan", area: "Elephantine Island", lat: 24.0866, lng: 32.9004 },
    
    // مصر - الأقصر
    { city: "Luxor", area: "Downtown", lat: 25.7075, lng: 32.6405 },
    { city: "Luxor", area: "West Bank", lat: 25.7238, lng: 32.6026 },
    
    // مصر - الجيزة
    { city: "Giza", area: "Pyramids", lat: 29.9759, lng: 31.1317 },
    { city: "Giza", area: "Sheikh Zayed", lat: 30.0217, lng: 30.8606 },
    
    // السعودية
    { city: "Riyadh", area: "Al Nakheel", lat: 24.7641, lng: 46.6753 },
    { city: "Riyadh", area: "Al Malaz", lat: 24.7969, lng: 46.6753 },
    { city: "Riyadh", area: "Al Qirawan", lat: 24.7745, lng: 46.7404 },
    { city: "Jeddah", area: "Downtown", lat: 21.5433, lng: 39.1727 },
    { city: "Jeddah", area: "Al Safa", lat: 21.6188, lng: 39.1383 },
    
    // الإمارات
    { city: "Dubai", area: "Downtown Dubai", lat: 25.1972, lng: 55.2744 },
    { city: "Dubai", area: "Marina", lat: 25.0805, lng: 55.1398 },
    { city: "Dubai", area: "Palm Jumeirah", lat: 25.1209, lng: 55.1384 },
    { city: "Abu Dhabi", area: "Downtown", lat: 24.4539, lng: 54.3773 },
    
    // الكويت
    { city: "Kuwait City", area: "Downtown", lat: 29.3769, lng: 47.9774 },
    { city: "Kuwait City", area: "Salmiya", lat: 29.3577, lng: 47.7637 },
    
    // قطر
    { city: "Doha", area: "Downtown", lat: 25.2854, lng: 51.5310 },
    { city: "Doha", area: "The Pearl", lat: 25.1723, lng: 51.5409 },
    
    // البحرين
    { city: "Manama", area: "Downtown", lat: 26.2361, lng: 50.5832 },
    { city: "Manama", area: "Seef", lat: 26.1668, lng: 50.5041 },
    
    // عمّان - الأردن
    { city: "Amman", area: "Abdoun", lat: 31.9454, lng: 35.8288 },
    { city: "Amman", area: "Sweifieh", lat: 31.9524, lng: 35.7855 },
    
    // بيروت - لبنان
    { city: "Beirut", area: "Downtown", lat: 33.8886, lng: 35.4955 },
    { city: "Beirut", area: "Verdun", lat: 33.8234, lng: 35.5116 },
    
    // الدار البيضاء - المغرب
    { city: "Casablanca", area: "Downtown", lat: 33.5731, lng: -7.5898 },
    { city: "Casablanca", area: "Anfa", lat: 33.5731, lng: -7.6352 },
  ];

  const propertyTypes = ["apartment", "villa", "house", "condo", "townhouse"];
  const listingStatuses = ["sale", "rent", "both"];
  const features = [
    ["Swimming Pool", "Gym", "Parking", "City View"],
    ["Garden", "Central AC", "Elevator", "Balcony"],
    ["Security System", "Maid Room", "Kitchen", "Terrace"],
    ["Modern Kitchen", "Smart Home", "Furnished", "Unfurnished"],
    ["Pet Friendly", "Close to Schools", "Near Metro", "Close to Beach"],
  ];

  const imageUrls = [
    "https://images.unsplash.com/photo-1502672023488-70e25813eb80?w=800",
    "https://images.unsplash.com/photo-1493809842364-78817add7ffb?w=800",
    "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800",
    "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800",
    "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800",
    "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800",
  ];

  let counter = 0;
  
  // إنشاء عقارات البائعين
  for (let i = 0; i < 80; i++) {
    const location = locations[i % locations.length];
    const type = propertyTypes[i % propertyTypes.length];
    const price = Math.floor(Math.random() * 10000000) + 500000;
    const area = Math.floor(Math.random() * 300) + 50;
    const bedrooms = Math.floor(Math.random() * 5) + 1;
    const bathrooms = Math.floor(Math.random() * 3) + 1;

    properties.push({
      title: `${type === "villa" ? "فيلا" : type === "apartment" ? "شقة" : "منزل"} في ${location.area}`,
      type,
      description: `عقار فاخر بموقع ممتاز في ${location.area}، ${location.city} مع جميع الخدمات`,
      price,
      area,
      bedrooms,
      bathrooms,
      listingStatus: listingStatuses[i % listingStatuses.length],
      location: {
        city: location.city,
        area: location.area,
        coordinates: { type: "Point", coordinates: [location.lng, location.lat] },
        nearBy: ["Schools", "Hospitals", "Shopping", "Metro/Bus Station"],
      },
      images: imageUrls.slice(i % 2, (i % 2) + 2),
      features: features[i % features.length],
      seller: seller._id,
      addedBy: "seller",
      status: "available",
    });
  }

  // إنشاء مشاريع المطورين
  const projectStatuses = ["completed", "under-construction", "planned"];
  
  for (let i = 0; i < 25; i++) {
    const location = locations[(i + 80) % locations.length];
    const status = projectStatuses[i % projectStatuses.length];
    const price = Math.floor(Math.random() * 5000000) + 1000000;
    const units = Math.floor(Math.random() * 300) + 50;
    const completionPercentage = status === "completed" ? 100 : status === "under-construction" ? Math.floor(Math.random() * 50) + 50 : Math.floor(Math.random() * 30);

    properties.push({
      type: "project",
      projectName: `مشروع ${location.area} الفاخر - ${["الإسكندرية", "الذهبي", "الملكي", "البحري", "الحديث"][i % 5]}`,
      description: `مشروع سكني متكامل في ${location.area}، ${location.city} مع أحدث التسهيلات`,
      price,
      bedrooms: 0,
      bathrooms: 0,
      location: {
        city: location.city,
        area: location.area,
        coordinates: { type: "Point", coordinates: [location.lng, location.lat] },
        nearBy: ["Parks", "Schools", "Shopping Malls", "Transport"],
      },
      images: imageUrls.slice(i % 2, (i % 2) + 2),
      features: ["Swimming Pool", "Gym", "Parking", "Park", "Security", "Schools"],
      developer: developer._id,
      addedBy: "real_estate_developer",
      status,
      units,
      completionPercentage,
      termsAccepted: true,
    });
  }

  return properties;
}

// Create developer projects
async function createDeveloperProjects(developer) {
  try {
    console.log("\n🏗️  Creating developer projects...");

    const developerProjects = [
      {
        type: "project",
        projectName: "برج التطوير الذهبي - وسط القاهرة",
        description: "مشروع سكني متكامل بأبراج حديثة مع إطلالات بانورامية على المدينة",
        price: 2500000,
        bedrooms: 0,
        bathrooms: 0,
        location: {
          city: "Cairo",
          area: "Downtown",
          coordinates: { type: "Point", coordinates: [31.2357, 30.0444] },
          nearBy: ["Burj Khalifa", "Dubai Mall", "Business Bay"],
        },
        images: [
          "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800",
          "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800",
        ],
        features: ["Swimming Pool", "Gym", "Parking", "City View", "Smart Home"],
        developer: developer._id,
        addedBy: "real_estate_developer",
        status: "completed",
        units: 120,
        completionPercentage: 90,
        termsAccepted: true,
      },
      {
        type: "project",
        projectName: "مشروع مارينا باي - إطلالة بحرية",
        description: "مشروع فاخر على الواجهة البحرية مع وسائل راحة عالمية",
        price: 1800000,
        bedrooms: 0,
        bathrooms: 0,
        location: {
          city: "Alexandria",
          area: "Montaza",
          coordinates: { type: "Point", coordinates: [30.0839, 31.2774] },
          nearBy: ["Beach", "Metro", "Shopping Mall"],
        },
        images: [
          "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800",
          "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?w=800",
        ],
        features: ["Swimming Pool", "Gym", "Security", "Parking", "Beach Access"],
        developer: developer._id,
        addedBy: "real_estate_developer",
        status: "under-construction",
        units: 45,
        completionPercentage: 75,
        termsAccepted: true,
      },
      {
        type: "project",
        projectName: "مدينة الأحلام - مشروع سكني متكامل",
        description: "مشروع سكني شامل مع جميع الخدمات والمرافق الحديثة",
        price: 1500000,
        bedrooms: 0,
        bathrooms: 0,
        location: {
          city: "Cairo",
          area: "New Cairo",
          coordinates: { type: "Point", coordinates: [31.4913, 30.0131] },
          nearBy: ["Cairo Festival City", "American University", "Malls"],
        },
        images: [
          "https://images.unsplash.com/photo-1600596542815-ffad4c1539a9?w=800",
          "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=800",
        ],
        features: ["Parks", "Schools", "Hospitals", "Shopping Centers", "Security"],
        developer: developer._id,
        addedBy: "real_estate_developer",
        status: "planned",
        units: 250,
        completionPercentage: 30,
        termsAccepted: true,
      },
    ];

    for (const project of developerProjects) {
      const exists = await Property.findOne({ projectName: project.projectName });
      if (!exists) {
        const newProject = new Property(project);
        await newProject.save();
        console.log(`✅ Created: ${project.projectName}`);
      } else {
        console.log(`⚠️  Already exists: ${project.projectName}`);
      }
    }
  } catch (error) {
    console.error("❌ Error creating developer projects:", error.message);
    throw error;
  }
}

// Create bulk properties
async function createBulkProperties(seller, developer) {
  try {
    console.log("\n📦 Creating 105 bulk properties across Middle East and Egypt...");

    const bulkProperties = await generateBulkProperties(seller, developer);
    let createdCount = 0;

    for (const property of bulkProperties) {
      const exists = await Property.findOne({
        title: property.title,
        "location.area": property.location.area,
      });
      
      if (!exists) {
        const newProperty = new Property(property);
        await newProperty.save();
        createdCount++;
        
        if (createdCount % 20 === 0) {
          console.log(`  📊 ${createdCount} properties created...`);
        }
      }
    }

    console.log(`✅ Created ${createdCount} new properties`);
    return createdCount;
  } catch (error) {
    console.error("❌ Error creating bulk properties:", error.message);
    throw error;
  }
}

// Main seed function
async function seedDatabase() {
  try {
    await connectDB();

    // Create users
    const { seller, developer } = await createUsers();

    // Create seller properties (the original 3)
    if (seller) {
      await createSellerProperties(seller);
    }

    // Create bulk properties (80 seller + 25 developer)
    if (seller && developer) {
      await createBulkProperties(seller, developer);
    }

    // Create developer projects (the original 3)
    if (developer) {
      await createDeveloperProjects(developer);
    }

    // Count total properties
    const totalCount = await Property.countDocuments();

    console.log("\n✅ Database seeding completed successfully!");
    console.log("\n📊 Summary:");
    console.log("============================================");
    console.log(`📦 Total Properties in Database: ${totalCount}`);
    console.log("============================================");
    console.log("🔐 Seller Account:");
    console.log("   Email: buyer1@test.com");
    console.log("   Password: 12356");
    console.log("   Role: Seller");
    console.log("============================================");
    console.log("🏢 Developer Account:");
    console.log("   Email: developer@realestate.com");
    console.log("   Password: dev12345");
    console.log("   Role: Real Estate Developer");
    console.log("============================================");
    console.log("\n📍 Properties across:");
    console.log("   • Egypt: Cairo, Alexandria, Aswan, Luxor, Giza");
    console.log("   • Saudi Arabia: Riyadh, Jeddah");
    console.log("   • UAE: Dubai, Abu Dhabi");
    console.log("   • Kuwait, Qatar, Bahrain, Jordan, Lebanon, Morocco");
    console.log("============================================");

    mongoose.connection.close();
    console.log("\n✅ Database connection closed");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    mongoose.connection.close();
    process.exit(1);
  }
}

// Run seeding
seedDatabase();
