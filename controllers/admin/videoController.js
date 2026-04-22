const bcrypt = require("bcryptjs");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");

require("dotenv").config();

exports.getvideolist = (req, res) => {
  console.log("klkl");
  db.query(
    "SELECT * FROM videomanagement ORDER BY sort_order asc",
    async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      res.status(200).json({
        message: "Video list fetched successfully",
        status: "1",
        results: results, // <-- include the results here
      });
    }
  );
};
exports.savevideo = (req, res) => {
  console.log(req.file);

  if (!req.file) {
    return res.status(400).json({ message: "No video uploaded." });
  }

  const videoPath = req.file.filename;
  const maxLimit = req.body.max_limit;
  const description = req.body.description;

  // SQL query to insert video and max_limit into videomanagement table
  const query =
    "INSERT INTO videomanagement (description,video, max_limit) VALUES (?, ?, ?)";
  db.query(query, [description, videoPath, maxLimit], (err, result) => {
    if (err) {
      console.error("Error inserting data into database:", err.stack);
      return res.status(500).json({ message: err });
    }

    // Respond with success if insertion is successful
    res.status(200).json({
      message: "Video uploaded and saved to database successfully",
      videoPath: videoPath,
      maxLimit: maxLimit,
    });
  });
};
exports.videodelete = (req, res) => {
  const videoId = req.body.id; // ID to be deleted

  if (!videoId) {
    return res.status(400).json({ message: "No video ID provided." });
  }

  // MySQL query to delete the video
  const query = "DELETE FROM videomanagement WHERE id = ?";

  db.query(query, [videoId], (error, results) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    if (results.affectedRows > 0) {
      return res.status(200).json({ message: "Video deleted successfully." });
    } else {
      return res.status(404).json({ message: "Video not found." });
    }
  });
};
exports.getvideorecord = (req, res) => {
  const videoId = req.body.id; // ID to be deleted

  if (!videoId) {
    return res.status(400).json({ message: "No video ID provided." });
  }

  // MySQL query to delete the video
  const query = "SELECT *  FROM videomanagement WHERE id = ?";

  db.query(query, [videoId], (error, row) => {
    if (error) {
      console.error("Error deleting video:", error);
      return res.status(500).json({ message: "Error deleting video." });
    }

    return res
      .status(200)
      .json({ message: "Video deleted successfully.", results: row });
  });
};

exports.updatevideo = (req, res) => {
  console.log(req.file);

  if (!req.file) {
    return res.status(400).json({ message: "No video uploaded." });
  }

  const videoName = req.file.filename;
  const maxLimit = req.body.max_limit;
  const id = req.body.id;
  const description = req.body.description;
  const query =
    "UPDATE videomanagement SET description=?, video = ?, max_limit = ? WHERE id = ?";

  db.query(query, [description, videoName, maxLimit, id], (err, result) => {
    if (err) {
      console.error("Error updating data in database:", err.stack);
      return res.status(500).json({
        message: "Failed to update video details in database",
      });
    }

    res.status(200).json({
      message: "Video and max limit updated successfully",
      videoName: videoName,
      maxLimit: maxLimit,
      id: id,
    });
  });
};
exports.updatelimit = (req, res) => {
  const maxLimit = req.body.max_limit;
  const id = req.body.id;
  const description = req.body.description;
  const query =
    "UPDATE videomanagement SET description=?, max_limit = ? WHERE id = ?";

  db.query(query, [description, maxLimit, id], (err, result) => {
    if (err) {
      console.error("Error updating data in database:", err.stack);
      return res.status(500).json({
        message: "Failed to update video details in database",
      });
    }

    res.status(200).json({
      message: "Video and max limit updated successfully",
      maxLimit: maxLimit,
      id: id,
    });
  });
};
exports.reorder_videos = (req, res) => {
  const { orderedIds } = req.body;

  if (!Array.isArray(orderedIds)) {
    return res
      .status(400)
      .json({ error: "Invalid input. orderedIds must be an array." });
  }

  let completed = 0;
  const total = orderedIds.length;

  orderedIds.forEach((id, index) => {
    const sortOrder = index + 1;
    const query = "UPDATE videomanagement SET sort_order = ? WHERE id = ?";

    db.query(query, [sortOrder, id], (err, result) => {
      if (err) {
        console.error("Error updating sort_order:", err);
        return res.status(500).json({ error: "Database update failed." });
      }

      completed++;

      if (completed === total) {
        // Only send response once all updates are done
        return res
          .status(200)
          .json({ message: "Videos reordered successfully." });
      }
    });
  });
};
