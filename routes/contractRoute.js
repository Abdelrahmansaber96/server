const express = require("express");
const contractController = require("../controllers/contractController");
const authMiddleware = require("../Middleware/authMiddleware");

const route = express.Router();

route.post("/contracts", authMiddleware, contractController.createContract);
route.get(
  "/contracts/user/:userId",
  authMiddleware,
  contractController.getContractsForUser
);
route.post(
  "/contracts/:id/sign",
  authMiddleware,
  contractController.signContract
);
route.patch(
  "/contracts/:contractId/payment-plan/:paymentIndex",
  authMiddleware,
  contractController.markPaymentPlanItemPaid
);


module.exports = route;
