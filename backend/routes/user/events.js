const express = require("express");
const router = express.Router();
const EventsController = require("../../controllers/user/EventsController");

// Define the POST /login route
router.post("/createevent", EventsController.createevent);

module.exports = router;
