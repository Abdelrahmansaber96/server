const mongoose = require("mongoose");
require("dotenv").config();

const Property = require("./models/propertyModel");
const NegotiationSession = require("./models/negotiationSessionModel");
const User = require("./models/userModel");

async function main() {
  const uri = process.env.MONGO_URI || "mongodb://localhost:27017/dreamhome";
  await mongoose.connect(uri);
  console.log("Connected to Mongo", uri);

  const property = await Property.findOne({ title: /Cozy Apartment in Maadi/i }).lean();
  if (!property) {
    console.log("Property not found");
    return;
  }
  console.log("Property:", {
    id: property._id,
    title: property.title,
    seller: property.seller,
    developer: property.developer,
    addedBy: property.addedBy,
  });

  const sellerUser = property.seller ? await User.findById(property.seller).lean() : null;
  console.log("Seller user:", sellerUser ? { id: sellerUser._id, name: sellerUser.name, role: sellerUser.role } : null);

  const negotiations = await NegotiationSession.find({ property: property._id })
    .populate("buyer", "name email role")
    .populate("seller", "name email role")
    .lean();

  console.log(`Found ${negotiations.length} negotiation sessions for this property`);
  negotiations.forEach((session, idx) => {
    console.log(`\n#${idx + 1} Negotiation`);
    console.log({
      id: session._id,
      status: session.status,
      buyer: session.buyer,
      seller: session.seller,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    });
  });
}

main()
  .catch((err) => {
    console.error("Debug error", err);
  })
  .finally(() => mongoose.connection.close());
