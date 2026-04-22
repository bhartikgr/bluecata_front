// routes/user/follow.js
const express = require("express");
const router = express.Router();
const followController = require("../../controllers/user/FollowController");

router.post("/follow", followController.followUser);
router.post("/unfollow", followController.unfollowUser);
router.post("/check-follow", followController.checkFollow);
router.post("/follow-counts", followController.getFollowCounts);

module.exports = router;
