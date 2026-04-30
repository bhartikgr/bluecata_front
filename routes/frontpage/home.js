const express = require("express");
const router = express.Router();
const HomeController = require("../../controllers/frontpage/HomeController");

// Define the POST /login route
router.post("/saveContact", HomeController.saveContact);
router.post("/getallcountrySymbolList", HomeController.getallcountrySymbolList);
router.post("/saveAcademypopup", HomeController.saveAcademypopup);
module.exports = router;
