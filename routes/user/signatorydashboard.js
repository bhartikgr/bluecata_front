const express = require("express");
const router = express.Router();
const signatorydashboardController = require("../../controllers/user/signatorydashboardController");

// Define the POST /login route
router.post(
  "/getSignatoryDetails",
  signatorydashboardController.getSignatoryDetails
);
router.post(
  "/getSignatoryCompanyList",
  signatorydashboardController.getSignatoryCompanyList
);
router.post(
  "/getInvestorreportList",
  signatorydashboardController.getInvestorreportList
);
router.post(
  "/getShareInvestorreport",
  signatorydashboardController.getShareInvestorreport
);
router.post(
  "/getRecordRoundList",
  signatorydashboardController.getRecordRoundList
);
router.post(
  "/getShareRecordreport",
  signatorydashboardController.getShareRecordreport
);
router.post(
  "/getSigantoryInformation",
  signatorydashboardController.getSigantoryInformation
);
router.post(
  "/getSignatoryActivity",
  signatorydashboardController.getSignatoryActivity
);
router.post(
  "/getCompanyRoundAccessLogs",
  signatorydashboardController.getCompanyRoundAccessLogs
);
router.post(
  "/getCompanyInvestorList",
  signatorydashboardController.getCompanyInvestorList
);
module.exports = router;
