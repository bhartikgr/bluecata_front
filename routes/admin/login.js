const express = require("express");
const router = express.Router();
const loginController = require("../../controllers/admin/loginController");

// Define the POST /login route
router.post("/", loginController.login);

module.exports = router;
