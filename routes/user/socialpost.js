const express = require("express");
const router = express.Router();
const socialPostController = require("../../controllers/user/socialPostController");

router.post(
  "/create",
  socialPostController.uploadMiddleware,
  socialPostController.createPost,
);
router.post("/posts", socialPostController.getPosts);
router.post("/posts/like", socialPostController.likePost);
router.post("/posts/comment", socialPostController.addComment);
router.post("/posts/comments", socialPostController.getComments);
router.get("/post/:id", socialPostController.getPostById);
router.post("/follow", socialPostController.followUser);
router.post("/follow/status", socialPostController.checkFollowStatus);
router.post("/followers", socialPostController.getFollowers);
router.post("/following", socialPostController.getFollowing);

// ─── Pin / Unpin Post ─────────────────────────────────────────────────────────
router.post("/pin", socialPostController.pinPost);
router.post("/company-location", socialPostController.getCompanyLocation);
module.exports = router;
