const express = require("express");
const router = express.Router();
const videoController = require("../../controllers/admin/videoController");
const upload = require("../../middlewares/uploadMiddleware");
// Define the POST /login route
router.post("/getvideolist", videoController.getvideolist);
router.post("/savevideo", upload.single("file"), videoController.savevideo);
router.post("/updatevideo", upload.single("file"), videoController.updatevideo);

router.post("/updatelimit", upload.single("file"), videoController.updatelimit);

router.post("/videodelete", videoController.videodelete);
router.post("/getvideorecord", videoController.getvideorecord);
router.post("/reorder_videos", videoController.reorder_videos);
module.exports = router;
