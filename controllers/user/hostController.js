const db = require("../../db");
const nodemailer = require("nodemailer");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const multer = require("multer");
const path = require("path");
const Stripe = require("stripe");
const stripe = new Stripe(
  "sk_test_51IGfuKAQc0Y9yYEo5Mg8S8VbRdNIcsLoVUXqLjV3Na9eHxGDY2P5C9Ww7faB3hihlMqYwiJ4TP8EQOW3vq1uJhc500j1Zynf0i"
);
require("dotenv").config();
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
exports.gethostDetails = async (req, res) => {
  var id = req.body.id;

  const query = `SELECT * FROM register WHERE id =?`;

  db.query(query, [id], (err, row) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    if (row.length > 0) {
      res.status(200).json({
        message: ``,
        results: row[0],
      });
    } else {
      res.status(200).json({
        message: ``,
        results: "",
      });
    }
  });
};
exports.chatThread = async (req, res) => {
  var data = req.body;

  const query = `SELECT * FROM chat_threads WHERE proposal_id =? And host_id = ? And sponsor_id =?`;

  db.query(
    query,
    [data.proposal_id, data.host_id, data.sponsor_id],
    (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }
      res.status(200).json({
        message: ``,
        results: results,
      });
    }
  );
};
exports.chatThreadCreate = async (req, res) => {
  const {
    proposal_id,
    host_id,
    sponsor_id,
    last_message,
    last_message_at,
    last_message_by,
  } = req.body;

  const insertQuery = `
    INSERT INTO chat_threads 
    (proposal_id, host_id, sponsor_id, last_message, last_message_at, last_message_by, created_at) 
    VALUES (?, ?, ?, ?, ?, ?, NOW())
  `;

  db.query(
    insertQuery,
    [
      proposal_id,
      host_id,
      sponsor_id,
      last_message,
      last_message_at,
      last_message_by,
    ],
    (insertErr, insertResult) => {
      if (insertErr) {
        return res.status(500).json({
          message: "Insert failed",
          error: insertErr,
        });
      }

      const insertedId = insertResult.insertId;

      const selectQuery = `SELECT * FROM chat_threads WHERE id = ?`;
      db.query(selectQuery, [insertedId], (selectErr, rows) => {
        if (selectErr) {
          return res.status(500).json({
            message: "Fetch after insert failed",
            error: selectErr,
          });
        }

        return res.status(201).json({
          message: "New chat thread created",
          result: rows[0],
        });
      });
    }
  );
};
exports.ChatMessagefilter = async (req, res) => {
  var data = req.body;

  const query = `SELECT * FROM chat_messages WHERE thread_id =? order by id desc`;

  db.query(query, [data.thread_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    res.status(200).json({
      message: ``,
      results: results,
    });
  });
};
exports.getUnreadMessages = async (req, res) => {
  const { thread_id, user_id } = req.body;

  if (!thread_id || !user_id) {
    return res.status(400).json({
      status: 0,
      message: "thread_id and user_id are required",
    });
  }

  const query = `
    SELECT * FROM chat_messages
    WHERE thread_id = ? AND sender_id != ?
  `;

  db.query(query, [thread_id, user_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        status: 0,
        message: "Database query error",
        error: err,
      });
    }

    return res.status(200).json({
      status: 1,
      message: "Unread messages fetched",
      results: results,
    });
  });
};
exports.updateMessage = (req, res) => {
  const { messageid, updateData } = req.body;
  console.log(req.body);
  if (!messageid || !updateData || typeof updateData !== "object") {
    return res.status(400).json({
      status: "error",
      message: "Missing or invalid data",
    });
  }

  const fields = Object.keys(updateData);
  const values = Object.values(updateData);

  const setClause = fields.map((field) => `${field} = ?`).join(", ");
  const sql = `UPDATE chat_messages SET ${setClause} WHERE id = ?`;

  // Append messageid at the end for WHERE clause
  db.query(sql, [...values, messageid], (err, result) => {
    if (err) {
      console.error("DB update error:", err);
      return res.status(500).json({
        status: "error",
        message: "Failed to update message",
        error: err.message,
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Message updated successfully",
    });
  });
};
exports.updateThread = (req, res) => {
  const { threadId, updateData } = req.body;

  if (!threadId || !updateData || typeof updateData !== "object") {
    return res.status(400).json({
      status: "error",
      message: "Missing or invalid data",
    });
  }

  const fields = Object.keys(updateData);
  const values = Object.values(updateData);

  // e.g., "last_message = ?, last_message_by = ?"
  const setClause = fields.map((field) => `${field} = ?`).join(", ");
  const sql = `UPDATE chat_threads SET ${setClause} WHERE id = ?`;

  db.query(sql, [...values, threadId], (err, result) => {
    if (err) {
      console.error("DB update error:", err);
      return res.status(500).json({
        status: "error",
        message: "Failed to update chat thread",
        error: err.message,
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Chat thread updated successfully",
    });
  });
};
exports.createChatMessage = (req, res) => {
  const {
    thread_id,
    sender_id,
    message,
    message_type = "text",
    read_by_host = false,
    read_by_sponsor = false,
  } = req.body;

  if (!thread_id || !sender_id || !message) {
    return res.status(400).json({
      status: "error",
      message: "Missing required fields",
    });
  }

  const insertSql = `
    INSERT INTO chat_messages 
    (thread_id, sender_id, message, message_type, read_by_host, read_by_sponsor, read_at,created_date) 
    VALUES (?, ?, ?, ?, ?, ?, NOW(),NOW())
  `;

  const insertValues = [
    thread_id,
    sender_id,
    message,
    message_type,
    read_by_host ? 1 : 0,
    read_by_sponsor ? 1 : 0,
  ];

  db.query(insertSql, insertValues, (err, result) => {
    if (err) {
      console.error("Insert message error:", err);
      return res.status(500).json({
        status: "error",
        message: "Failed to create chat message",
        error: err.message,
      });
    }

    const insertedId = result.insertId;

    const selectSql = `SELECT * FROM chat_messages WHERE id = ?`;

    db.query(selectSql, [insertedId], (selectErr, selectResult) => {
      if (selectErr) {
        console.error("Fetch message error:", selectErr);
        return res.status(500).json({
          status: "error",
          message: "Message inserted but failed to fetch",
          error: selectErr.message,
        });
      }

      return res.status(201).json({
        status: "success",
        message: "Chat message created",
        results: selectResult[0], // full row of inserted message
      });
    });
  });
};

// Node.js Express API
exports.updateChatThread = (req, res) => {
  const { threadId, updateData } = req.body;
  console.log("Request Body:", req.body);

  if (!threadId || !updateData || typeof updateData !== "object") {
    return res.status(400).json({
      status: "error",
      message: "Missing or invalid data",
    });
  }

  const fields = Object.keys(updateData);
  const values = Object.values(updateData);

  // Build dynamic SET clause: e.g., "last_message = ?, host_unread_count = ?"
  const setClause = fields.map((field) => `${field} = ?`).join(", ");
  const sql = `UPDATE chat_threads SET ${setClause} WHERE id = ?`;

  // Use db.query with a callback instead of await
  db.query(sql, [...values, threadId], (err, result) => {
    if (err) {
      console.error("DB update error:", err);
      return res.status(500).json({
        status: "error",
        message: "Update failed",
        error: err.message,
      });
    }

    return res.status(200).json({
      status: "success",
      message: "Thread updated successfully",
    });
  });
};
// GET user threads based on user ID (host or sponsor)
exports.getUserThreads = (req, res) => {
  const userId = req.body.userId;
  if (!userId) {
    return res.status(400).json({
      status: "error",
      message: "Missing userId in query parameters",
    });
  }

  const sql = `
    SELECT * FROM chat_threads
    WHERE host_id = ? 
    ORDER BY id DESC
    LIMIT 50
  `;

  db.query(sql, [userId], (err, results) => {
    if (err) {
      console.error("Error fetching user threads:", err);
      return res.status(500).json({
        status: "error",
        message: "Database query failed",
        error: err.message,
      });
    }

    return res.status(200).json({
      status: "success",
      threads: results,
    });
  });
};

exports.userfilter = (req, res) => {
  const userId = req.body.id;
  if (!userId) {
    return res.status(400).json({
      status: "error",
      message: "Missing userId in query parameters",
    });
  }

  const sql = `
    SELECT * FROM register
    WHERE id = ? 
  `;

  db.query(sql, [userId], (err, row) => {
    if (err) {
      console.error("Error fetching user threads:", err);
      return res.status(500).json({
        status: "error",
        message: "Database query failed",
        error: err.message,
      });
    }

    return res.status(200).json({
      status: "success",
      results: row,
    });
  });
};
exports.sponsorfilter = (req, res) => {
  const userId = req.body.id;

  if (!userId) {
    return res.status(400).json({
      status: "error",
      message: "Missing id in query parameters",
    });
  }

  const sql = `
    SELECT * FROM sponsorshipproposal_export
    WHERE id = ? 
  `;

  db.query(sql, [userId], (err, row) => {
    if (err) {
      console.error("Error fetching user threads:", err);
      return res.status(500).json({
        status: "error",
        message: "Database query failed",
        error: err.message,
      });
    }

    return res.status(200).json({
      status: "success",
      results: row[0],
    });
  });
};
