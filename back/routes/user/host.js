const express = require("express");
const router = express.Router();
const hostController = require("../../controllers/user/hostController");

// Define the POST /login route

router.post("/gethostDetails", hostController.gethostDetails);
router.post("/chatThread", hostController.chatThread);
router.post("/chatThreadCreate", hostController.chatThreadCreate);
router.post("/ChatMessagefilter", hostController.ChatMessagefilter);
router.post("/getUnreadMessages", hostController.getUnreadMessages);
router.post("/updateMessage", hostController.updateMessage);
router.post("/updateThread", hostController.updateThread);
router.post("/createChatMessage", hostController.createChatMessage);

router.post("/updateChatThread", hostController.updateChatThread);
router.post("/getUserThreads", hostController.getUserThreads);
router.post("/userfilter", hostController.userfilter);
router.post("/sponsorfilter", hostController.sponsorfilter);

router.post("/createstripe", hostController.createstripe);

module.exports = router;
