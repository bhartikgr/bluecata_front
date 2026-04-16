const express = require("express");
const router = express.Router();
const socialPostController = require("../../controllers/user/socialPostController");

// ─── Create Post (with image upload middleware) ───────────────────────────────
router.post(
  "/create",
  socialPostController.uploadMiddleware,
  socialPostController.createPost,
);

// ─── Get Posts (visibility filtered) ─────────────────────────────────────────
router.post("/posts", socialPostController.getPosts);

// ─── Like / Unlike Post ───────────────────────────────────────────────────────
router.post("/posts/like", socialPostController.likePost);

// ─── Add Comment ─────────────────────────────────────────────────────────────
router.post("/posts/comment", socialPostController.addComment);

// ─── Get Comments for a Post ─────────────────────────────────────────────────
router.post("/posts/comments", socialPostController.getComments);
router.get("/post/:id", socialPostController.getPostById);

router.post("/follow", socialPostController.followUser);
router.post("/follow/status", socialPostController.checkFollowStatus);
router.post("/followers", socialPostController.getFollowers);
router.post("/following", socialPostController.getFollowing);
module.exports = router;
