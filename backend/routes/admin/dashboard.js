const express = require("express");
const router = express.Router();
const DashboardController = require("../../controllers/admin/DashboardController");

// Define the POST /login route
router.post("/getusers", DashboardController.getusers);
router.post("/getinvoices", DashboardController.getinvoices);
router.post("/getsponserpayments", DashboardController.getsponpays);
router.post("/gethostpayments", DashboardController.gethostpayments);
router.post("/pay-to-host", DashboardController.paytohost);
 
module.exports = router;