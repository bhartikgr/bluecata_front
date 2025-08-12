const express = require("express");
const router = express.Router();
const adminallController = require("../../controllers/admin/adminallController");
const upload = require("../../middlewares/uploadMiddleware");
// Define the POST /login route
router.post("/totalDocs", adminallController.totalDocs);
router.post("/checkUsersData", adminallController.checkUsersData);
router.post("/investorReports", adminallController.investorReports);
router.post("/sharedReports", adminallController.sharedReports);
router.post(
  "/investordocLatestVersion",
  adminallController.investordocLatestVersion
);
router.post(
  "/investordocprevVersion",
  adminallController.investordocprevVersion
);
router.post("/viewinvestorDetail", adminallController.viewinvestorDetail);
router.post(
  "/viewinvestordetailInthis",
  adminallController.viewinvestordetailInthis
);
router.post(
  "/getallInvestorReportViewed",
  adminallController.getallInvestorReportViewed
);

router.post("/getSharereportGrouped", adminallController.getSharereportGrouped);

module.exports = router;
