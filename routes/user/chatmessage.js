// routes/user/chatmessage.js
const express = require("express");
const router = express.Router();
const chatmessageController = require("../../controllers/user/chatmessageController");
const uploadDocsMiddleware = require("../../middlewares/uploadDocsMiddleware");

// Chat Routes
router.post(
  "/get-or-create-conversation",
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

module.exports = router;
