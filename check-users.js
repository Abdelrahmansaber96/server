require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/userModel');

const checkUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const users = await User.find(
      { email: { $in: ['abdo@gmail.com', 'hussien@gmail.com', 'ahmed@gmail.com'] } },
      'name email role'
    );

    console.log('\n📋 Found users:');
    users.forEach(user => {
      console.log(`- ${user.name} (${user.email}) - Role: ${user.role}`);
    });

    if (users.length === 0) {
      console.log('\n⚠️ No users found with these emails!');
    }

    mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

checkUsers();
