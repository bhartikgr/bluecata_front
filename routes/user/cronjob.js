const express = require("express");
const router = express.Router();
const upload = require("../../middlewares/uploadDocsMiddleware");
const fs = require("fs");
const path = require("path");
const cronjobController = require("../../controllers/user/cronjobController");

router.post(
  "/getAllActiveSubscriptions",
  cronjobController.getAllActiveSubscriptions
);
module.exports = router;
