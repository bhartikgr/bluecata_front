const express = require("express");
const router = express.Router();
const adminallController = require("../../controllers/admin/adminallController");
const upload = require("../../middlewares/uploadMiddleware");
// Define the POST /login route
//router.post("/getvideolist", adminallController.getvideolist);

module.exports = router;
