const express = require("express");
const router = express.Router();
const waitlistController = require("../../controllers/user/waitlistController");
const uploadDocsMiddleware = require("../../middlewares/uploadDocsMiddleware");

// Define the POST /login route
router.post("/saveJoinwaitlist", waitlistController.saveJoinwaitlist);
router.post("/getInvestorWaitList", waitlistController.getInvestorWaitList);

module.exports = router;
