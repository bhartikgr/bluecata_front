const express = require("express");
const router = express.Router();
const InvestorLoginController = require("../../controllers/user/InvestorLoginController");

// ─── Get Posts (visibility filtered) ─────────────────────────────────────────
router.post("/investorlogin", InvestorLoginController.investorlogin);
router.post(
  "/resetPasswordinvestor",
  InvestorLoginController.resetPasswordinvestor,
);
module.exports = router;
