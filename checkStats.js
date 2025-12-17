require("dotenv").config({ path: "./server/.env" });
const mongoose = require("mongoose");
const Property = require("./models/propertyModel");

async function checkStats() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    
    const total = await Property.countDocuments();
    const types = await Property.aggregate([
      { $group: { _id: "$type", count: { $sum: 1 } } }
    ]);
    
    const areas = await Property.find().distinct("location.area");
    const cities = await Property.find().distinct("location.city");
    
    console.log("📊 DATABASE STATISTICS");
    console.log("==============================================");
    console.log(`Total Properties: ${total}`);
    console.log(`\n📦 By Type:`);
    types.forEach(t => console.log(`  • ${t._id}: ${t.count}`));
    
    console.log(`\n🌍 Cities (${cities.length}):`);
    cities.forEach(c => console.log(`  • ${c}`));
    
    console.log(`\n📍 Areas (${areas.length}):`);
    areas.slice(0, 30).forEach(a => console.log(`  • ${a}`));
    
    const priceStats = await Property.aggregate([
      {
        $group: {
          _id: null,
          avgPrice: { $avg: "$price" },
          minPrice: { $min: "$price" },
          maxPrice: { $max: "$price" }
        }
      }
    ]);
    
    if (priceStats.length > 0) {
      const stats = priceStats[0];
      console.log(`\n💰 Price Statistics:`);
      console.log(`  • Average: $${Math.floor(stats.avgPrice).toLocaleString()}`);
      console.log(`  • Min: $${Math.floor(stats.minPrice).toLocaleString()}`);
      console.log(`  • Max: $${Math.floor(stats.maxPrice).toLocaleString()}`);
    }
    
    console.log("\n✅ All good!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error:", error.message);
    process.exit(1);
  }
}

checkStats();
