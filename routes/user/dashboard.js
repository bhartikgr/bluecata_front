const express = require("express");
const router = express.Router();
const dashboardController = require("../../controllers/user/dashboardController");

// Define the POST /login route
router.post(
  "/getCompanyTotalShares",
  dashboardController.getCompanyTotalShares
);
router.post("/getCompanystokes", dashboardController.getCompanystokes);
router.post("/getCompanyopenround", dashboardController.getCompanyopenround);
router.post(
  "/getCompanyopenroundUserLog",
  dashboardController.getCompanyopenroundUserLog
);

router.post("/getDilutionForecast", dashboardController.getDilutionForecast);
router.post("/getShareholder", dashboardController.getShareholder);
router.post("/getTotalinvestor", dashboardController.getTotalinvestor);
router.post(
  "/getinvestorreportLogs",
  dashboardController.getinvestorreportLogs
);
router.post(
  "/getinvestorDatarromreportLogs",
  dashboardController.getinvestorDatarromreportLogs
);
router.post(
  "/getTotalinvestorcontact",
  dashboardController.getTotalinvestorcontact
);
router.post("/getrecentuploadFile", dashboardController.getrecentuploadFile);
router.post("/getSignatoryActivity", dashboardController.getSignatoryActivity);
router.post("/getCompanyAccess", dashboardController.getCompanyAccess);
router.post(
  "/getInvestorRequestCompanyInvest",
  dashboardController.getInvestorRequestCompanyInvest
);
router.post(
  "/getCompanyOptionPoolLastestValuation",
  dashboardController.getCompanyOptionPoolLastestValuation
);
router.post("/getCompanyName", dashboardController.getCompanyName);
router.post(
  "/getBasicVsFullyDilutedOwnership",
  dashboardController.getBasicVsFullyDilutedOwnership
);
module.exports = router;
