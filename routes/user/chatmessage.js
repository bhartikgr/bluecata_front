// routes/user/chatmessage.js
const express = require("express");
const router = express.Router();
const chatmessageController = require("../../controllers/user/chatmessageController");
const uploadDocsMiddleware = require("../../middlewares/uploadDocsMiddleware");

// Chat Routes
router.post(
  "/get_or_create_conversation",
  chatmessageController.getOrCreateConversation,
);
router.post(
  "/get-user-conversations",
  chatmessageController.getUserConversations,
);
router.post("/get-messages", chatmessageController.getMessages);
router.post("/send-message", chatmessageController.sendMessage);
router.post("/delete-message", chatmessageController.deleteMessage);
router.post(
  "/upload-file",
  uploadDocsMiddleware.single("file"),
  chatmessageController.uploadFile,
);
router.post("/mark-read", chatmessageController.markMessageRead);
router.post("/star-conversation", chatmessageController.starConversation);
router.post(
  "/starred-conversations",
  chatmessageController.getStarredConversations,
);
router.post("/getInvestorCrmData", chatmessageController.getInvestorCrmData);
router.post("/addInvestorToCrm", chatmessageController.addInvestorToCrm);
router.post("/getInvestorData", chatmessageController.getInvestorData);
router.post("/getCompanyDetails", chatmessageController.getCompanyDetails);
module.exports = router;
