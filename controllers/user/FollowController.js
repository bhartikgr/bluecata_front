// controllers/user/followController.js
const db = require("../../db");

// ── Follow a user ────────────────────────────────────────────────────────────
exports.followUser = async (req, res) => {
    const { follower_id, follower_type, following_id, following_type } = req.body;

    if (!follower_id || !following_id) {
        return res.status(400).json({ success: false, message: "Missing fields" });
    }

    try {
        db.query(
            `INSERT IGNORE INTO follows (follower_id, follower_type, following_id, following_type)
       VALUES (?, ?, ?, ?)`,
            [follower_id, follower_type, following_id, following_type],
            (err, result) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, message: "Followed successfully" });
            }
        );
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── Unfollow a user ───────────────────────────────────────────────────────────
exports.unfollowUser = async (req, res) => {
    const { follower_id, follower_type, following_id, following_type } = req.body;

    try {
        db.query(
            `DELETE FROM follows 
       WHERE follower_id = ? AND follower_type = ? AND following_id = ? AND following_type = ?`,
            [follower_id, follower_type, following_id, following_type],
            (err, result) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, message: "Unfollowed successfully" });
            }
        );
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── Check follow status ───────────────────────────────────────────────────────
exports.checkFollow = async (req, res) => {
    const { follower_id, follower_type, following_id, following_type } = req.body;

    try {
        db.query(
            `SELECT id FROM follows 
       WHERE follower_id = ? AND follower_type = ? AND following_id = ? AND following_type = ?`,
            [follower_id, follower_type, following_id, following_type],
            (err, results) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, isFollowing: results.length > 0 });
            }
        );
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};

// ── Get followers count ───────────────────────────────────────────────────────
exports.getFollowCounts = async (req, res) => {
    const { user_id, user_type } = req.body;

    try {
        db.query(
            `SELECT 
        (SELECT COUNT(*) FROM follows WHERE following_id = ? AND following_type = ?) as followers_count,
        (SELECT COUNT(*) FROM follows WHERE follower_id = ? AND follower_type = ?) as following_count`,
            [user_id, user_type, user_id, user_type],
            (err, results) => {
                if (err) return res.status(500).json({ success: false, error: err.message });
                res.json({ success: true, ...results[0] });
            }
        );
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
};