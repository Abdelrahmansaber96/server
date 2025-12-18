require('dotenv').config();
const mongoose = require('mongoose');
const Property = require('./models/propertyModel');
const User = require('./models/userModel');

const verifyProperties = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // جلب المستخدمين
    const users = await User.find(
      { email: { $in: ['abdo@gmail.com', 'hussien@gmail.com', 'ahmed@gmail.com'] } },
      '_id name email role'
    );

    for (const user of users) {
      console.log(`\n📋 Properties for ${user.name} (${user.email}):`);
      console.log(`Role: ${user.role}`);
      console.log('─'.repeat(60));

      let properties;
      if (user.role === 'real_estate_developer') {
        properties = await Property.find({ developer: user._id }, 'title type price area projectName status');
      } else {
        properties = await Property.find({ seller: user._id }, 'title type price area listingStatus');
      }

      if (properties.length === 0) {
        console.log('⚠️ No properties found');
      } else {
        properties.forEach((prop, index) => {
          console.log(`\n${index + 1}. ${prop.title}`);
          console.log(`   Type: ${prop.type}`);
          console.log(`   Price: ${prop.price.toLocaleString('en-US')} جنيه`);
          console.log(`   Area: ${prop.area} م²`);
          if (prop.projectName) {
            console.log(`   Project: ${prop.projectName}`);
            console.log(`   Status: ${prop.status}`);
          } else {
            console.log(`   Listing: ${prop.listingStatus}`);
          }
        });
      }
    }

    console.log('\n\n📊 Summary:');
    const totalProperties = await Property.countDocuments();
    const sellerProperties = await Property.countDocuments({ seller: { $exists: true, $ne: null } });
    const developerProjects = await Property.countDocuments({ developer: { $exists: true, $ne: null } });
    
    console.log(`Total Properties: ${totalProperties}`);
    console.log(`Seller Properties: ${sellerProperties}`);
    console.log(`Developer Projects: ${developerProjects}`);

    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

verifyProperties();
