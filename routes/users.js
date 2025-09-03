const express = require("express");
const router = express.Router();
const usersController = require("../controllers/users/usersController");

router.post("/checkusercoverage", usersController.checkusercoverage);

module.exports = router; // Correct export
