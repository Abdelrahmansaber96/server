const express = require("express");
const dealController = require("../controllers/dealController");
const authMiddleware = require("../Middleware/authMiddleware");

const route = express.Router();

route.post("/deals", authMiddleware, dealController.createDeal);
route.get(
  "/deals/user/:userId",
  authMiddleware,
  dealController.getDealsForUser
);
route.get("/deals/:id", authMiddleware, dealController.getDealById);
route.post("/deals/:id/messages", authMiddleware, dealController.sendMessage);
route.patch(
  "/deals/:id/status",
  authMiddleware,
  dealController.updateDealStatus
);

module.exports = route;
