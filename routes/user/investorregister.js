const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/uploadDocsMiddleware");
const InvestorregisterController = require("../../controllers/user/InvestorregisterController");

// Define the POST /login route
router.post("/checkinvestorCode", InvestorregisterController.checkinvestorCode);
router.post(
  "/getInvestorInfocheck",
  InvestorregisterController.getInvestorInfocheck,
);
router.post(
  "/investorInformation",
  InvestorregisterController.investorInformation,
);
router.post(
  "/getIndustryExpertise",
  InvestorregisterController.getIndustryExpertise,
);
router.post(
  "/getallcountrySymbolList",
  InvestorregisterController.getallcountrySymbolList,
);

module.exports = router;
