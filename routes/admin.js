const express = require("express");
const router = express.Router();
const adminController = require("../controllers/admin/adminController");

router.post("/getusergallery", adminController.getusergallery);
router.post("/getallclient", adminController.getallclient);

module.exports = router; // Correct export
