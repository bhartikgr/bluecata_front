const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
require("dotenv").config();
const multer = require("multer");
const path = require("path");
const WebSocket = require("ws");
const slugify = require("slugify");
const moment = require("moment-timezone");
const express = require("express");
const http = require("http");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
app.use((req, res, next) => {
  req.wss = wss;
  next();
});

// Broadcast function to send messages to all connected clients
const broadcast = (data) => {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
};
//console.log(wss);
// WebSocket connection handling
wss.on("connection", (ws) => {
  console.log("New client connected");
  ws.send(JSON.stringify({ message: "Welcome to the WebSocket server!" }));

  ws.on("message", (message) => {
    // Handle incoming messages and broadcast them
    console.log(`Received message: ${message}`);
    broadcast(message);
  });

  ws.on("close", () => {
    console.log("Client disconnected");
  });
});
exports.getnotifications = async (req, res) => {
  const { user_id, filter = "default" } = req.body;

  try {
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    let limit = 30;
    let dateCondition = "";
    if (filter === "default") {
      limit = 4;
      // dateCondition = `AND g.date >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
      dateCondition = `AND g.date >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
    } else if (filter === "month") {
      limit = 30;
      dateCondition = `AND g.date >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
    }
    const query = `
      SELECT 
        g.*, 
        fr.status AS request_status,
        sender.username AS sender_name, 
        sender.profile_image AS sender_profile_image, 
        sender.profile_type AS sender_profile_type, 
        sender.gender AS sender_gender,
        CASE 
            WHEN g.to_id = 0 AND g.status = 'Admin' THEN 'Admin' 
            ELSE recipient.username 
        END AS recipient_name, 
        CASE 
            WHEN g.to_id = 0 AND g.status = 'Admin' THEN '' 
            ELSE recipient.profile_image 
        END AS recipient_profile_image
      FROM notification g
      JOIN users sender ON g.user_id = sender.id
      LEFT JOIN users recipient ON g.to_id = recipient.id
      LEFT JOIN friendRequest_accept fr ON g.post_id = fr.id
      WHERE g.user_id = ?
        ${dateCondition}
      ORDER BY g.id DESC
      LIMIT ?;
    `;
    db.query(query, [user_id, limit], (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results,
        pagination: {
          limit,
          fetchedItems: results.length,
          nextPage: results.length === limit ? 2 : null,
        },
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getnotificationstotal = async (req, res) => {
  const { user_id } = req.body; // Default page is 1

  try {
    // Ensure user_id is provided
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }
    dateCondition = `AND g.date >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
    // Prepare SQL query to fetch notifications with pagination
    const query = `
      SELECT 
        g.*, 
        fr.status AS request_status,
        sender.username AS sender_name, 
        sender.profile_image AS sender_profile_image, 
        sender.profile_type AS sender_profile_type, 
        sender.gender AS sender_gender,
        CASE 
            WHEN g.to_id = 0 AND g.status = 'Admin' THEN 'Admin' 
            ELSE recipient.username 
        END AS recipient_name, 
        CASE 
            WHEN g.to_id = 0 AND g.status = 'Admin' THEN '' 
            ELSE recipient.profile_image 
        END AS recipient_profile_image
      FROM notification g
      JOIN users sender ON g.user_id = sender.id
      LEFT JOIN users recipient ON g.to_id = recipient.id
      LEFT JOIN friendRequest_accept fr ON g.post_id = fr.id
      WHERE g.user_id = ?  ${dateCondition}
      ORDER BY g.id DESC
     
    `;

    // Query to get total count of notifications
    const countQuery = `SELECT COUNT(*) AS total FROM notification WHERE user_id = ?`;

    // Execute both queries
    db.query(query, [user_id], (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      db.query(countQuery, [user_id], (countErr, countResults) => {
        if (countErr) {
          return res
            .status(500)
            .json({ message: "Database count error", error: countErr });
        }

        const total = countResults[0].total;

        return res.status(200).json({
          results,
        });
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getnotificationsall = async (req, res) => {
  const { user_id } = req.body;

  try {
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const dateCondition = `AND g.date >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;

    const query = `
      SELECT 
        g.*, 
        sender.username AS sender_name, 
        sender.profile_image AS sender_profile_image, 
        sender.profile_type AS sender_profile_type, 
        sender.gender AS sender_gender,
        CASE 
            WHEN g.to_id = 0 AND g.status = 'Admin' THEN 'Admin' 
            ELSE recipient.username 
        END AS recipient_name, 
        CASE 
            WHEN g.to_id = 0 AND g.status = 'Admin' THEN '' 
            ELSE recipient.profile_image 
        END AS recipient_profile_image
      FROM notification g
      JOIN users sender ON g.user_id = sender.id
      LEFT JOIN users recipient ON g.to_id = recipient.id
      WHERE g.user_id = ?  ${dateCondition}
      ORDER BY g.id DESC
    `;

    const unreadNotificationsQuery = `
      SELECT COUNT(*) AS total 
      FROM notification 
      WHERE user_id = ? AND \`read\` = 'No'
    `;

    db.query(query, [user_id], (err, notifications) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      db.query(
        unreadNotificationsQuery,
        [user_id],
        (err, notificationCountResult) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Error counting notifications", error: err });
          }

          const unreadNotifications = notificationCountResult[0].total;

          return res.status(200).json({
            results: notifications,
            resultcount: unreadNotifications, // Only unread notifications count
          });
        }
      );
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getnotificationsallMessages = async (req, res) => {
  const { user_id } = req.body; // Default page is 1
  try {
    // Ensure user_id is provided
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Prepare SQL query to fetch notifications with pagination
    const query =
      "SELECT * FROM chatmessages WHERE to_id = ? AND `read` = 'No'";

    // Execute both queries
    db.query(query, [user_id], (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results,
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getnotificationsdashboard = async (req, res) => {
  const { user_id, user_ids } = req.body; // Expecting a string of user IDs
  try {
    // Ensure user_ids is provided
    if (!user_ids) {
      return res.status(400).json({ message: "User IDs are required" });
    }
    dateCondition = `AND g.date >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
    // Prepare SQL query to fetch galleries for multiple user IDs

    const query = `
      SELECT 
        g.*, 
        fr.status AS request_status,
        sender.username AS sender_name, 
        sender.profile_image AS sender_profile_image, 
        sender.profile_type AS sender_profile_type, 
        sender.gender AS sender_gender,
        CASE 
            WHEN g.to_id = 0 AND g.status = 'Admin' THEN 'Admin' 
            ELSE recipient.username 
        END AS recipient_name, 
        CASE 
            WHEN g.to_id = 0 AND g.status = 'Admin' THEN '' 
            ELSE recipient.profile_image 
        END AS recipient_profile_image
      FROM notification g
      JOIN users sender ON g.user_id = sender.id
      LEFT JOIN users recipient ON g.to_id = recipient.id
      LEFT JOIN friendRequest_accept fr ON g.post_id = fr.id
      WHERE g.user_id = ${user_id}  ${dateCondition}
      ORDER BY g.id DESC
      LIMIT 4;
    `;
    db.query(query, (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.updatenotifications = async (req, res) => {
  const { user_id, user_ids } = req.body; // Expecting a string of user IDs

  try {
    // Ensure user_ids is provided
    if (!user_ids) {
      return res.status(400).json({ message: "User IDs are required" });
    }

    // Prepare SQL query to update notifications for multiple user IDs
    const updateQuery = `
      UPDATE notification
      SET \`read\` = 'Yes'
      WHERE user_id = ?;
    `;

    // Usage with a parameterized query
    db.query(updateQuery, [user_id], (err, results) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      }
      return res
        .status(200)
        .json({ message: "Notifications updated successfully", results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.notificationfriend_request = async (req, res) => {
  const { user_id, check } = req.body; // Expecting user_id and check from the request body

  try {
    // Ensure user_id and check are provided
    if (user_id == null || check == null) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    // Determine the value to set for notification_friend_request
    const notificationValue = check;

    // Prepare SQL query to update the notification_friend_request field
    const updateQuery = `
      UPDATE users
      SET notification_friend_request = ?
      WHERE id = ?;
    `;

    // Execute the parameterized query
    db.query(updateQuery, [notificationValue, user_id], (err, results) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      }

      // Respond with success message
      return res
        .status(200)
        .json({ message: "Notification updated successfully", results });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.notificationnew_message = async (req, res) => {
  const { user_id, check } = req.body; // Expecting user_id and check from the request body

  try {
    // Ensure user_id and check are provided
    if (user_id == null || check == null) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    // Determine the value to set for notification_message
    const notificationValue = check;

    // Prepare SQL query to update the notification_message field
    const updateQuery = `
      UPDATE users
      SET notification_message = ?
      WHERE id = ?;
    `;

    // Execute the parameterized query
    db.query(updateQuery, [notificationValue, user_id], (err, results) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      }

      // Respond with success message
      return res
        .status(200)
        .json({ message: "Notification updated successfully", results });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.notificationevent_group = async (req, res) => {
  const { user_id, check } = req.body; // Expecting user_id and check from the request body

  try {
    // Ensure user_id and check are provided
    if (user_id == null || check == null) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    // Determine the value to set for notification_message
    const notificationValue = check;

    // Prepare SQL query to update the notification_message field
    const updateQuery = `
      UPDATE users
      SET notification_group_event = ?
      WHERE id = ?;
    `;

    // Execute the parameterized query
    db.query(updateQuery, [notificationValue, user_id], (err, results) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      }

      // Respond with success message
      return res
        .status(200)
        .json({ message: "Notification updated successfully", results });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.notificationnew_created = async (req, res) => {
  const { user_id, check } = req.body; // Expecting user_id and check from the request body

  try {
    // Ensure user_id and check are provided
    if (user_id == null || check == null) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    // Determine the value to set for notification_message
    const notificationValue = check;

    // Prepare SQL query to update the notification_message field
    const updateQuery = `
      UPDATE users
      SET notification_new_created = ?
      WHERE id = ?;
    `;

    // Execute the parameterized query
    db.query(updateQuery, [notificationValue, user_id], (err, results) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      }

      // Respond with success message
      return res
        .status(200)
        .json({ message: "Notification updated successfully", results });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.notificationnews_update = async (req, res) => {
  const { user_id, check } = req.body; // Expecting user_id and check from the request body

  try {
    // Ensure user_id and check are provided

    // Determine the value to set for notification_message
    const notificationValue = check;
    console.log(check);
    // Prepare SQL query to update the notification_message field
    const updateQuery = `
      UPDATE users
      SET notification_news_update = ?
      WHERE id = ?;
    `;

    // Execute the parameterized query
    db.query(updateQuery, [notificationValue, user_id], (err, results) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      }

      // Respond with success message
      return res
        .status(200)
        .json({ message: "Notification updated successfully", results });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.notificationnews_profile = async (req, res) => {
  const { user_id, check } = req.body; // Expecting user_id and check from the request body

  try {
    // Ensure user_id and check are provided
    if (user_id == null || check == null) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    // Determine the value to set for notification_message
    const notificationValue = check;

    // Prepare SQL query to update the notification_message field
    const updateQuery = `
      UPDATE users
      SET notification_news_profile = ?
      WHERE id = ?;
    `;

    // Execute the parameterized query
    db.query(updateQuery, [notificationValue, user_id], (err, results) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      }

      // Respond with success message
      return res
        .status(200)
        .json({ message: "Notification updated successfully", results });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.notificationspecial_offers = async (req, res) => {
  const { user_id, check } = req.body; // Expecting user_id and check from the request body

  try {
    // Ensure user_id and check are provided
    if (user_id == null || check == null) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    // Determine the value to set for notification_message
    const notificationValue = check;

    // Prepare SQL query to update the notification_message field
    const updateQuery = `
      UPDATE users
      SET notification_special_offers = ?
      WHERE id = ?;
    `;

    // Execute the parameterized query
    db.query(updateQuery, [notificationValue, user_id], (err, results) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      }

      // Respond with success message
      return res
        .status(200)
        .json({ message: "Notification updated successfully", results });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.notificationother_users = async (req, res) => {
  const { user_id, check } = req.body; // Expecting user_id and check from the request body

  try {
    // Ensure user_id and check are provided
    if (user_id == null || check == null) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    // Determine the value to set for notification_message
    const notificationValue = check;

    // Prepare SQL query to update the notification_message field
    const updateQuery = `
      UPDATE users
      SET notification_other_users = ?
      WHERE id = ?;
    `;

    // Execute the parameterized query
    db.query(updateQuery, [notificationValue, user_id], (err, results) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      }

      // Respond with success message
      return res
        .status(200)
        .json({ message: "Notification updated successfully", results });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.notificationactive_users = async (req, res) => {
  const { user_id, check } = req.body; // Expecting user_id and check from the request body

  try {
    // Ensure user_id and check are provided

    // Determine the value to set for notification_message
    const notificationValue = check;

    // Prepare SQL query to update the notification_message field
    const updateQuery = `
      UPDATE users
      SET notification_show_activity = ?
      WHERE id = ?;
    `;

    // Execute the parameterized query
    db.query(updateQuery, [notificationValue, user_id], (err, results) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      }

      // Respond with success message
      return res
        .status(200)
        .json({ message: "Notification updated successfully", results });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.album_statussave = async (req, res) => {
  const { user_id, check } = req.body; // Expecting user_id and check from the request body

  try {
    // Ensure user_id and check are provided

    // Determine the value to set for notification_message
    const notificationValue = check;

    // Prepare SQL query to update the notification_message field
    const updateQuery = `
      UPDATE users
      SET album_setting_status = ?
      WHERE id = ?;
    `;

    // Execute the parameterized query
    db.query(updateQuery, [notificationValue, user_id], (err, results) => {
      if (err) {
        console.error("Database update error:", err);
        return res
          .status(500)
          .json({ message: "Database update error", error: err });
      }

      // Respond with success message
      return res
        .status(200)
        .json({ message: "Album setting updated successfully", results });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.setgdprCookies = async (req, res) => {
  const { user_id, ip_address, consent_status } = req.body;

  try {
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Check if a record with the given user_id exists
    const checkQuery = `SELECT * FROM gdpr_cookies WHERE user_id = ?`;
    db.query(checkQuery, [user_id], (err, result) => {
      if (err) {
        console.error("Error checking consent:", err);
        return res.status(500).send("Error checking consent");
      }

      if (result.length > 0) {
        // If a record exists, update it
        const updateQuery = `
          UPDATE gdpr_cookies
          SET ip_address = ?, consent_status = ?, date = ?
          WHERE user_id = ?
        `;
        db.query(
          updateQuery,
          [ip_address, consent_status, date, user_id],
          (updateErr, updateResult) => {
            if (updateErr) {
              console.error("Error updating consent:", updateErr);
              return res.status(500).send("Error updating consent");
            }
            return res.send("Consent updated successfully");
          }
        );
      } else {
        // If no record exists, insert a new one
        const insertQuery = `
          INSERT INTO gdpr_cookies (ip_address, user_id, consent_status, date)
          VALUES (?, ?, ?, ?)
        `;
        db.query(
          insertQuery,
          [ip_address, user_id, consent_status, date],
          (insertErr, insertResult) => {
            if (insertErr) {
              console.error("Error saving consent:", insertErr);
              return res.status(500).send("Error saving consent");
            }
            return res.send("Consent saved successfully");
          }
        );
      }
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.notificationall_request = async (req, res) => {
  const { user_id, check } = req.body; // Expecting user_id and check from the request body
  console.log(check);
  try {
    // Ensure user_id and check are provided
    if (user_id == null || check == null) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    // Determine the value to set for notification_friend_request
    const notificationValue = check;

    // Prepare SQL query to update the notification_friend_request field
    const updateQuery = `
      UPDATE users
      SET notification_friend_request = ?,notification_message=?,notification_group_event=?,notification_new_profile=?,notification_new_created=?,notification_news_update=?,notification_news_profile=?,notification_special_offers=?,notification_show_activity=?,notification_other_users=?,all_notification=?
      WHERE id = ?;
    `;

    // Execute the parameterized query
    db.query(
      updateQuery,
      [
        notificationValue,
        notificationValue,
        notificationValue,
        notificationValue,
        notificationValue,
        notificationValue,
        notificationValue,
        notificationValue,
        notificationValue,
        notificationValue,
        notificationValue,
        user_id,
      ],
      (err, results) => {
        if (err) {
          console.error("Database update error:", err);
          return res
            .status(500)
            .json({ message: "Database update error", error: err });
        }

        // Respond with success message
        return res
          .status(200)
          .json({ message: "Notification updated successfully", results });
      }
    );
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};
