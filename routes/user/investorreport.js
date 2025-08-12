const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/uploadDocsMiddleware");
const fs = require("fs");
const path = require("path");
const inverstorReportController = require("../../controllers/user/inverstorReportController");
router.post(
  "/investorQuatarlyEmailSend",
  inverstorReportController.investorQuatarlyEmailSend
);

router.post("/getInvestorReport", inverstorReportController.getInvestorReport);
router.post(
  "/SendreportToinvestor",
  inverstorReportController.SendreportToinvestor
);

router.post(
  "/getInvestorReportprevious",
  inverstorReportController.getInvestorReportprevious
);
router.post("/checkinvestorCode", inverstorReportController.checkinvestorCode);
router.post(
  "/investorInformation",
  inverstorReportController.investorInformation
);
router.post(
  "/investorInformationUpdate",
  inverstorReportController.investorInformationUpdate
);
router.post(
  "/getreportForInvestor",
  inverstorReportController.getreportForInvestor
);
router.post("/viewReport", inverstorReportController.viewReport);
router.post(
  "/getInvestorReportViewed",
  inverstorReportController.getInvestorReportViewed
);
router.post(
  "/exportInvestorExcel",
  inverstorReportController.exportInvestorExcel
);
router.post(
  "/getInvestorInfocheck",
  inverstorReportController.getInvestorInfocheck
);
router.post("/investorlogin", inverstorReportController.investorlogin);
router.post(
  "/getreportForInvestorCompany",
  inverstorReportController.getreportForInvestorCompany
);
router.post(
  "/resetPasswordinvestor",
  inverstorReportController.resetPasswordinvestor
);
module.exports = router;
