const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/uploadDocsMiddleware");
const fs = require("fs");
const path = require("path");
const paymentController = require("../../controllers/user/paymentController");

router.post("/access_token", paymentController.access_token);
router.post("/auth_code", paymentController.auth_code);
router.post(
  "/getAirwallexAccessToken",
  paymentController.getAirwallexAccessToken,
);
router.post("/create_payment_intent", paymentController.create_payment_intent);
router.post(
  "/create_redirect_payment_intent",
  paymentController.create_redirect_payment_intent,
);
router.post(
  "/CompanySubscriptionOneTimeDataRoomPlus",
  paymentController.CompanySubscriptionOneTimeDataRoomPlus,
);
router.post(
  "/CreateuserSubscriptionDataRoomPerinstance",
  paymentController.CreateuserSubscriptionDataRoomPerinstance,
);
router.post(
  "/checkSubscriptionExists",
  paymentController.checkSubscriptionExists,
);
module.exports = router;
