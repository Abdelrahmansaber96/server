require("dotenv").config();
const cors = require("cors");
const express = require("express");
const multer = require("multer");
const path = require("path");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const userRoute = require("./routes/userRoute");
const propertiesRoute = require("./routes/propertyRoute");
const dealsRoute = require("./routes/dealRoute");
const contractsRoute = require("./routes/contractRoute");
const paymentsRoute = require("./routes/paymentsRoute");
const editorProjectRoute = require("./routes/editorProjectRoute");
const onboardingRoute = require("./routes/onboardingRoute");
const matchingRoute = require("./routes/matchingRoute");
const negotiationRoute = require("./routes/negotiationRoute");
const dealDraftRoute = require("./routes/dealDraftRoute");
const aiRoutes = require("./ai/routes/ai.routes");
const aiFiltersRoutes = require("./routes/aiFiltersRoutes");
const adminRoutes = require("./routes/adminRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const notificationRoutes = require("./routes/notificationRoutes");
const unitRoutes = require("./routes/unitRoute");
const Notification = require("./models/notificationModel"); // استدعاء الموديل
const { initGridFS } = require("./config/gridfs");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// خلي io global
global.io = io;
io.on("connection", (socket) => {
  try {
    console.log("🟢 Socket connected:", socket.id);

    const token = socket.handshake.auth?.token;

    if (!token) {
      console.log("❌ Socket rejected: no token");
      socket.disconnect();
      return;
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id || decoded._id;

    if (!userId) {
      console.log("❌ Socket rejected: no userId");
      socket.disconnect();
      return;
    }

    socket.join(userId.toString());

    console.log(`✅ Socket authenticated, joined room: ${userId}`);

    socket.on("disconnect", () => {
      console.log(`🔴 Socket disconnected: user ${userId}`);
    });
  } catch (err) {
    console.log("❌ Socket auth error:", err.message);
    socket.disconnect();
  }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(cors()); // ✅ هنا

// Routes
app.use("/users", userRoute);
app.use("/properties", propertiesRoute);
app.use("/deals", dealsRoute);
app.use("/contracts", contractsRoute);
app.use("/payments", paymentsRoute);
app.use("/editor-projects", editorProjectRoute);
app.use("/onboarding", onboardingRoute);
app.use("/matching", matchingRoute);
app.use("/negotiations", negotiationRoute);
app.use("/deal-drafts", dealDraftRoute);
app.use("/api/ai", aiRoutes);
app.use("/api/ai-filters", aiFiltersRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/units", unitRoutes);
// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({ storage });

app.post("/upload", upload.single("myfile"), (req, res) => {
  res.json({ message: "File uploaded successfully", file: req.file });
});

app.use("/uploads", express.static("uploads"));

// MongoDB connection and server startup
async function main() {
  try {
    await mongoose.connect(process.env.MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(" MongoDB connected");

    initGridFS(mongoose);
    
    // Auto-generate embeddings on startup
    try {
      const { generateAllEmbeddings, vectorStore } = require("./ai/services/embeddings.service");
      console.log("🔄 Loading embeddings into memory...");
      await generateAllEmbeddings();
      console.log(`✅ Loaded ${vectorStore.embeddings.length} properties into vector store`);
    } catch (error) {
      console.warn("⚠️  Failed to load embeddings:", error.message);
    }
    
    // Start server AFTER everything is ready
    const PORT = process.env.PORT || 5000;
    server.listen(PORT, () => {
      console.log(`🚀 Server + Socket.IO running on port ${PORT}`);
      console.log(`🚀 Ready to handle requests!`);
    });
  } catch (err) {
    console.error(" DB connection error:", err.message);
    process.exit(1);
  }
}

// Add error handlers
process.on('unhandledRejection', (error) => {
  console.error('\n❌ ============ Unhandled Rejection ============');
  console.error('Error:', error);
  console.error('Stack:', error?.stack);
  console.error('==============================================\n');
  // Don't exit - let the app recover if possible
});

process.on('uncaughtException', (error) => {
  console.error('\n❌ ============ Uncaught Exception ============');
  console.error('Error:', error);
  console.error('Stack:', error?.stack);
  console.error('==============================================\n');
  // Exit on uncaught exceptions
  process.exit(1);
});

main();
//"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjY4ZTAxM2I0YjFjN2YwMTg3YzJmZjhlMCIsInJvbGUiOiJidXllciIsImVtYWlsIjoicnlhZEBleGFtcGxlLmNvbSIsImlhdCI6MTc1OTUxNjA1OCwiZXhwIjoxNzYwMTIwODU4fQ.0ueHs13m-Nt6z1tJfDSTi4cv7zf2VEg2XBe2WP62Ht0"
