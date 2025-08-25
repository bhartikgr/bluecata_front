const express = require("express");
const router = express.Router();
const DashboardController = require("../../controllers/admin/DashboardController");

// Define the POST /login route
router.post("/getusers", DashboardController.getusers);

module.exports = router;
