const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("../db");
require("dotenv").config();
const multer = require("multer");
const path = require("path");
const moment = require("moment-timezone");
const WebSocket = require("ws");
const express = require("express");
const http = require("http");
const nodemailer = require("nodemailer");
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const crypto = require("crypto");

const Stripe = require("stripe");
const stripe = new Stripe(
  "sk_test_51ODoJFAQYHZn8ah9WDYZSBSjs4pRWQshcZfYhaSBJNQnVzi6kbDisu9wIqlrdbmcTOmmG95HHujZ1PvEYLp6ORhe00K0D8eLz5"
);

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
exports.getAllMembers = async (req, res) => {
  var user_id = req.body.user_id;
  try {
    // Ensure the email is provided

    // Query the database to get the user's profile details
    db.query(
      `SELECT
    u.*,
    CASE
        WHEN fr.status = 'Yes' THEN true ELSE false
    END AS is_friend,
    fr.status AS friend_status,
    m.user_id AS membership_user_id,
    m.plan AS membership_plan,
    m.days AS membership_days
FROM users u
LEFT JOIN friendRequest_accept fr
    ON (u.id = fr.sent_to AND fr.user_id = ?)
    OR (u.id = fr.user_id AND fr.sent_to = ?)
LEFT JOIN membership m
    ON u.id = m.user_id
ORDER BY u.id DESC;
;
`,
      [user_id, user_id],
      (err, row) => {
        return res.status(200).json({ results: row });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};
exports.getAllMembersPage = async (req, res) => {
  const { user_id } = req.body;

  try {
    // Step 1: Get the current user
    const userQuery = `
      SELECT users.*, membership.plan AS membership_plan 
      FROM users 
      LEFT JOIN membership ON membership.user_id = users.id 
      WHERE users.id = ?
    `;
    db.query(userQuery, [user_id], (err, userResults) => {
      if (err || userResults.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      const currentUser = userResults[0];

      // Step 2: Normalize values
      const gender = (currentUser.gender || "").trim(); // "Male" | "Female"
      const orientation = currentUser.sexual_orientation || "";

      // Step 3: Who You Like (liked genders)
      const likedGenders = new Set();

      if (orientation === "Heterosexual") {
        if (gender === "Male") likedGenders.add("Female");
        else if (gender === "Female") likedGenders.add("Male");
      }

      if (orientation === "Homosexual") {
        if (gender === "Male") likedGenders.add("Male");
        else if (gender === "Female") likedGenders.add("Female");
      }

      if (orientation === "Bisexual" || orientation === "Pansexual") {
        likedGenders.add("Male");
        likedGenders.add("Female");
      }

      const likedGenderArray = [...likedGenders];

      // Step 4: Who Likes You (preferences check using LIKE)
      const prefKeywords = [];
      if (gender === "Male") {
        prefKeywords.push("%male%");
      } else if (gender === "Female") {
        prefKeywords.push("%female%");
      }

      // Step 5: Build SQL dynamically
      let sql = `SELECT * FROM users WHERE (`;
      const params = [];

      if (likedGenderArray.length > 0) {
        const genderPlaceholders = likedGenderArray.map(() => "?").join(", ");
        sql += `gender IN (${genderPlaceholders}) AND (looking_for IS NULL OR looking_for=''`;
        params.push(...likedGenderArray);

        if (prefKeywords.length > 0) {
          const keywordPlaceholders = prefKeywords
            .map(() => "LOWER(looking_for) LIKE ?")
            .join(" OR ");
          sql += ` OR ${keywordPlaceholders}`;
          params.push(...prefKeywords);
        }

        sql += `))`;
      } else {
        sql += `(looking_for IS NULL OR looking_for=''`;
        if (prefKeywords.length > 0) {
          const keywordPlaceholders = prefKeywords
            .map(() => "LOWER(looking_for) LIKE ?")
            .join(" OR ");
          sql += ` OR ${keywordPlaceholders}`;
          params.push(...prefKeywords);
        }
        sql += `)`;
      }

      // Always include current user (for profile page etc.)
      sql += ` OR id = ?`;
      params.push(user_id);

      // Execute the query
      db.query(sql, params, (err, results) => {
        if (err) {
          console.error("SQL error:", err);
          return res.status(500).json({ message: "Server error" });
        }

        res.status(200).json({ success: true, results });
      });
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.getAllMembersPageDashboard = (req, res) => {
  const userQuery = `SELECT * FROM users`;

  db.query(userQuery, (err, results) => {
    if (err) {
      console.error("Database query error:", err);
      return res
        .status(500)
        .json({ success: false, message: "Database error" });
    }

    return res.status(200).json({ success: true, results: results });
  });
};

exports.getcheckfriendss = async (req, res) => {
  var user_id = req.body.user_id;
  var to_id = req.body.to_id;
  console.log("Checking friendship between:", user_id, to_id); // Log user_id and to_id

  try {
    // Query the database to check if the users are friends
    db.query(
      `SELECT
        1 AS is_friend  -- If any row matches, they are friends
      FROM
        friendRequest_accept fr
      WHERE
        (
            (fr.user_id = ? AND fr.sent_to = ?)  -- Check if User X sent a request to User Y
            OR
            (fr.user_id = ? AND fr.sent_to = ?)  -- Check if User Y sent a request to User X
        )
        AND fr.status = 'Yes'  -- The status must be 'Yes' to be friends
      LIMIT 1;`,
      [user_id, to_id, to_id, user_id], // Pass parameters as an array
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Error executing query", error: err });
        }

        if (results.length > 0) {
          return res.status(200).json({ is_friend: true });
        } else {
          return res.status(200).json({ is_friend: false });
        }
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

// exports.getAllMembers = async (req, res) => {
//   var user_id = req.body.user_id;
//   try {
//     // Ensure the email is provided

//     // Query the database to get the user's profile details
//     db.query(
//       `SELECT
//         u.*,
//         CASE
//             WHEN fr.status = 'Yes' THEN true
//             ELSE false
//         END AS is_friend
//         FROM
//             users u
//         LEFT JOIN
//             friendRequest_accept fr
//         ON
//             (u.id = fr.sent_to AND fr.user_id = ?) OR
//             (u.id = fr.user_id AND fr.sent_to = ?) where u.id != ? And fr.status = 'Yes';`,
//       [user_id, user_id, user_id],
//       (err, results) => {
//         return res.status(200).json({ results: results });
//       }
//     );
//   } catch (error) {
//     res.status(500).json({ message: "Server error", error });
//   }
// };

exports.getUserDetailMember = async (req, res) => {
  var id = req.body.id;
  var user_id = req.body.user_id;
  var to_id = req.body.to_id;
  try {
    // Ensure the email is provided

    // Query the database to get the user's profile details
    db.query(
      `SELECT
        users.*,
        userphotoprivate.user_id,
        userphotoprivate.to_id,
        userphotoprivate.status As uStatus
    FROM
        users
    LEFT JOIN
        userphotoprivate ON userphotoprivate.to_id = users.id
        AND userphotoprivate.user_id = ?
    WHERE
        users.id = ?
        AND (userphotoprivate.status = 'Yes' OR userphotoprivate.status IS NULL OR userphotoprivate.status = 'No')
        AND (userphotoprivate.to_id = ? OR userphotoprivate.to_id IS NULL)
    ORDER BY
        users.id DESC;`,
      [user_id, id, to_id],
      (err, row) => {
        return res.status(200).json({ row: row });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

exports.getUserDetailMemberOther = async (req, res) => {
  var { id, user_id, to_id } = req.body;
  console.log(req.body, "nn");

  try {
    // Query the database to get the user's profile details including albums and private photo permissions
    const query = `
  SELECT
    usersalbum.*,
    COALESCE(userphotoprivate.status, 'No') AS uStatus,
    albums.name AS album_name,
    albums.id AS album_ID,
    coverphoto.image_url AS cover_image  -- get image_url from coverphoto
  FROM usersalbum
  LEFT JOIN userphotoprivate 
    ON usersalbum.id = userphotoprivate.albumid
    AND userphotoprivate.user_id = ?
    AND userphotoprivate.to_id = ? 
  LEFT JOIN albums 
    ON albums.id = usersalbum.album_id
  LEFT JOIN coverphoto 
    ON coverphoto.usersalbum_id = albums.id  -- new join for coverphoto
  WHERE usersalbum.visibility = 'Private_visible'
    AND usersalbum.user_id = ?
  ORDER BY usersalbum.id DESC;
`;

    db.query(query, [user_id, to_id, to_id], (err, results) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: "Database error", error: err });
      }
      return res.status(200).json({ results: results });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error });
  }
};

exports.getEvent_s = async (req, res) => {
  const { user_id } = req.body;
  // Validate required fields
  if (!user_id) {
    return res.status(400).json({ message: "User ID is required" });
  }

  try {
    // Fetch all events for the given user_id
    db.query(
      "SELECT * FROM events WHERE user_id = ? And makeImagePrivate = ? ORDER BY id DESC",
      [user_id, "0"],
      (err, results) => {
        if (err) {
          console.error("Database query error:", err); // Log error to console
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        // If events are found, return them; otherwise, return a message
        res.status(200).json({
          message: "Events retrieved successfully",
          results: results,
        });
      }
    );
  } catch (error) {
    console.error("Event retrieval error:", error); // Log error to console
    res.status(500).json({ message: "Event retrieval error", error });
  }
};

exports.getAllfriend_s = async (req, res) => {
  var user_id = req.body.user_id;

  //console.log(user_id);
  try {
    // Ensure the email is provided
    if (!user_id) {
      return res.status(400).json({ message: "User id  is required" });
    }

    // Query the database to get the user's profile details
    db.query(
      `SELECT DISTINCT
    u.*,
    fr.status
FROM
    users u
JOIN
    friendRequest_accept fr
    ON (u.id = fr.sent_to AND fr.user_id = ?)
    OR (u.id = fr.user_id AND fr.sent_to = ?)
WHERE
    fr.status = ? 
;
`,
      [user_id, user_id, "Yes"],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        res.status(200).json({
          message: "All friend",
          results: results, // Return the first event object
        });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};
exports.getAllfriend_viewmore = async (req, res) => {
  var user_id = req.body.user_id;
  var page = req.body.page;
  const limit = 10;
  const offset = (page - 1) * limit;
  try {
    // Ensure the email is provided
    if (!user_id) {
      return res.status(400).json({ message: "User id  is required" });
    }

    // Query the database to get the user's profile details
    db.query(
      `SELECT DISTINCT
    u.*,
    fr.status
FROM
    users u
JOIN
    friendRequest_accept fr
    ON (u.id = fr.sent_to AND fr.user_id = ?)
    OR (u.id = fr.user_id AND fr.sent_to = ?)
WHERE
    fr.status = ? LIMIT ? OFFSET ?
;
`,
      [user_id, user_id, "Yes", limit, offset],
      (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        res.status(200).json({
          message: "All friend",
          results: results, // Return the first event object
        });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

exports.getCheck_friend = async (req, res) => {
  const { id, user_id } = req.body;

  try {
    // Ensure user_id and id are provided
    if (!user_id || !id) {
      return res
        .status(400)
        .json({ message: "Both user_id and id are required" });
    }

    // Query to check if the user is a friend or not
    const query = `
      SELECT
      u.*,
      fr.status
      FROM
          users u
      JOIN
          friendRequest_accept fr
      ON
          (u.id = fr.sent_to AND fr.user_id = ?)
          OR (u.id = fr.user_id AND fr.sent_to = ?)
      WHERE  (fr.user_id = ? OR fr.sent_to = ?)
          AND u.id != ?;
;
    `;

    db.query(
      query,
      [user_id, id, user_id, id, user_id], // Added correct number of parameters
      (err, row) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }

        if (row.length === 0) {
          return res
            .status(200)
            .json({ message: "No friends found", results: row });
        }

        res.status(200).json({
          message: "Friendship status retrieved successfully",
          results: row, // Return the friend rows
        });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getCheck_friendUser = async (req, res) => {
  const { id, user_id } = req.body;

  try {
    // Ensure user_id and id are provided
    if (!user_id || !id) {
      return res
        .status(400)
        .json({ message: "Both user_id and id are required" });
    }

    // Query to check if the user is a friend or not
    const query = `
      SELECT
      u.*,
      fr.status
      FROM
          users u
      JOIN
          friendRequest_accept fr
      ON
          (u.id = fr.sent_to AND fr.user_id = ?)
          OR (u.id = fr.user_id AND fr.sent_to = ?)
      WHERE  (fr.user_id = ? OR fr.sent_to = ?)
          AND u.id != ? And fr.status='Yes';
;
    `;

    db.query(
      query,
      [user_id, user_id, id, id, user_id], // Added correct number of parameters
      (err, row) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }

        if (row.length === 0) {
          return res
            .status(200)
            .json({ message: "No friends found", results: row });
        }

        res.status(200).json({
          message: "Friendship status retrieved successfully",
          results: row, // Return the friend rows
        });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getCheckfriendAcceptornot = async (req, res) => {
  const { id, user_id } = req.body;

  try {
    if (!user_id || !id) {
      return res
        .status(400)
        .json({ message: "Both user_id and id are required" });
    }

    const query = `
      SELECT * FROM friendRequest_accept 
      WHERE 
        (user_id = ? AND sent_to = ?) 
        OR 
        (user_id = ? AND sent_to = ?)
    `;

    db.query(query, [user_id, id, id, user_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      if (results.length === 0) {
        return res.status(200).json({
          message: "Add Friend",
          status: "1",
        });
      }

      const request = results[0];

      if (request.status === "Yes") {
        return res.status(200).json({
          message: "Friends",
          status: "2",
          who_sent: request.user_id, // add who sent the request
          id: request.id,
        });
      } else if (request.status === "No") {
        if (request.user_id === user_id) {
          return res.status(200).json({
            message: "Request Sent",
            status: "3",
            who_sent: request.user_id,
            id: request.id,
          });
        } else if (request.sent_to === user_id) {
          return res.status(200).json({
            message: "Accept Request",
            status: "4",
            who_sent: request.user_id,
            id: request.id,
          });
        }
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

async function sendEmailFor_FriendRequestNotification(too, name, callback) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf",
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: too, // Recipient (Atul's email)
    subject: `${name} sent you a friend request on Amourette!`, // Personalized subject
    text: `Hello,\n\n${name} has sent you a friend request on Amourette.\n\nLogin now to accept or decline the request.\n\nBest regards,\nAmourette Team`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error:", error);
    } else {
      console.log("Email sent:", info.response);
    }
  });
}

exports.sendFriendRequest = async (req, res) => {
  const { user_id, sent_id } = req.body;
  const wss = req.wss; // Get the WebSocket server instance from the request
  try {
    // Ensure user_id and sent_to are provided
    if (!user_id || !sent_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and sent_id are required" });
    }
    var date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");
    // Insert friend request into the database
    const querychecks = `SELECT * FROM friendRequest_accept WHERE user_id = ? AND sent_to = ?`;
    db.query(querychecks, [user_id, sent_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }
      if (results.length > 0) {
        res.status(200).json({
          message: "Friend request already sent,Please check friend list",
        });
      } else {
        const querycheck = `SELECT * FROM friendRequest_accept WHERE (user_id = ? AND sent_to = ?) OR (user_id = ? AND sent_to = ?);`;
        db.query(
          querycheck,
          [user_id, sent_id, sent_id, user_id],
          (err, results) => {
            if (err) {
              return res.status(500).json({
                message: "Database query error",
                error: err,
              });
            }
            if (results.length > 0) {
              res.status(200).json({
                message: "Friend request already sent,Please check friend list",
              });
            } else {
              const query = `
          INSERT INTO friendRequest_accept (user_id, sent_to, status,date)
          VALUES (?, ?, ?,?);
        `;

              db.query(query, [user_id, sent_id, "No", date], (err, result) => {
                if (err) {
                  return res.status(500).json({
                    message: "Database insertion error",
                    error: err,
                  });
                }
                const broadcastMessage = JSON.stringify({
                  event: "sendfriendRequest",
                  user_id: sent_id,
                });
                var inserid = result.insertId;
                //console.log(wss);
                if (wss) {
                  wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                      // console.log(client.to_id);

                      client.send(broadcastMessage);
                    }
                  });
                }
                const queryy = `SELECT
                    MAX(CASE WHEN id = ? THEN email END) AS user1_email,
                    MAX(CASE WHEN id = ? THEN email END) AS user2_email,
                    MAX(CASE WHEN id = ? THEN username END) AS user1_username,
                    MAX(CASE WHEN id = ? THEN username END) AS user2_username,
                    MAX(CASE WHEN id = ? THEN notification_friend_request END) AS user1_notification_friend_request,
                    MAX(CASE WHEN id = ? THEN notification_friend_request END) AS user2_notification_friend_request
                FROM users`;
                db.query(
                  queryy,
                  [sent_id, user_id, sent_id, user_id, sent_id, user_id],
                  (err, row) => {
                    if (err) {
                      return res.status(500).json({
                        message: "Database query error",
                        error: err,
                      });
                    }
                    var name = row[0].user1_username;
                    var sentto_name = row[0].user2_username;
                    var email = row[0].user2_email;
                    var check1 = row[0].user1_notification_friend_request;

                    if (check1 === "Yes") {
                      sendEmailFor_FriendRequestNotification(
                        email,
                        sentto_name,
                        (info) => {
                          res.send(info);
                        }
                      );
                    }
                    var mesg = " sent " + name + " friend request";

                    logActivity(user_id, mesg);
                  }
                );
                const query = `
                        SELECT
                            * from users where id =?;`;
                db.query(query, [user_id], (err, row) => {
                  if (err) {
                    return res.status(500).json({
                      message: "Database query error",
                      error: err,
                    });
                  }
                  var name = row[0].username;
                  console.log(name);
                  var mesg = " sent you a friend request";

                  db.query(
                    "INSERT INTO notification (post_id,to_id,user_id, message, date,link_href) VALUES (?,?, ?, ?,?,?)",
                    [inserid, row[0].id, sent_id, mesg, date, "/friends"],
                    (err, result) => {
                      if (err) {
                        console.error(
                          "Database insertion error for user_id:",
                          user_id,
                          err
                        );
                      } else {
                      }
                    }
                  );
                });

                res.status(200).json({
                  message: "Friend request sent successfully",
                });
              });
            }
          }
        );
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getuserChatmessage = async (req, res) => {
  const { user_id, to_id, offset = 0 } = req.body;
  console.log(req.body);
  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and to_id are required" });
    }

    // Query to fetch chat messages with chatmessage_left check
    const query = `
      SELECT
        cm.*,
        cm.read,
        u1.profile_image AS user1_profile,
        u2.profile_image AS user2_profile,
        u1.id AS user1_id,
        u2.id AS user2_id,
        u1.makeImagePrivate AS user1_makeImagePrivate,
        u2.makeImagePrivate AS user2_makeImagePrivate
      FROM
        chatmessages cm
      JOIN
        users u1 ON cm.user_id = u1.id
      JOIN
        users u2 ON cm.to_id = u2.id
      LEFT JOIN
        chatmessage_left cl ON cl.chatmessages_id = cm.id AND cl.user_id = ?
      WHERE
        ((cm.user_id = ? AND cm.to_id = ?) OR (cm.user_id = ? AND cm.to_id = ?))
        AND (cl.chatmessages_id IS NULL OR cm.user_id = ?)
      ORDER BY  cm.date asc ;
    `;

    // Fetching the messages
    db.query(
      query,
      [user_id, user_id, to_id, to_id, user_id, user_id],
      (err, results) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }
        console.log(req.body, "offset");
        // Sending the chat messages in the response
        return res.status(200).json({ results });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getuserChatmessageTotalMessage = async (req, res) => {
  const { user_id, to_id } = req.body;

  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and to_id are required" });
    }

    // Query to fetch chat messages with chatmessage_left check
    const query = `
      SELECT
        cm.*,
        cm.read,
        u1.profile_image AS user1_profile,
        u2.profile_image AS user2_profile,
        u1.id AS user1_id,
        u2.id AS user2_id,
        u1.makeImagePrivate AS user1_makeImagePrivate,
        u2.makeImagePrivate AS user2_makeImagePrivate
      FROM
        chatmessages cm
      JOIN
        users u1 ON cm.user_id = u1.id
      JOIN
        users u2 ON cm.to_id = u2.id
      LEFT JOIN
        chatmessage_left cl ON cl.chatmessages_id = cm.id AND cl.user_id = ?
      WHERE
        ((cm.user_id = ? AND cm.to_id = ?) OR (cm.user_id = ? AND cm.to_id = ?))
        AND (cl.chatmessages_id IS NULL OR cm.user_id = ?)
      ;
    `;

    // Fetching the messages
    db.query(
      query,
      [user_id, user_id, to_id, to_id, user_id, user_id],
      (err, results) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }
        // Sending the chat messages in the response
        return res.status(200).json({ results });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

async function sendEmailFor_ReceivingNotification(
  too,
  name,
  message,
  callback
) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf",
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: too,
    subject: `You received a new message from ${name} on Amourette`, // Corrected grammar
    text: `Hello,\n\nYou have received a new message from ${name} on Amourette.\n\nMessage: "${message}"\n\nLog in now to view and reply.\n\nBest regards,\nAmourette Team`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error:", error);
    } else {
      console.log("Email sent:", info.response);
    }
  });
}

exports.saveUserChat = async (req, res) => {
  const { user_id, to_id, message } = req.body;
  const wss = req.wss; // Get the WebSocket server instance

  if (!user_id || !to_id) {
    return res
      .status(400)
      .json({ message: "Both user_id and to_id are required" });
  }

  try {
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");
    const fileUrls = req.files ? req.files.map((file) => file.location) : [];

    if (!message && fileUrls.length === 0) {
      return res
        .status(400)
        .json({ message: "Either message or file is required" });
    }

    const insertQueries = [];

    // Insert message if it exists
    if (message) {
      insertQueries.push({
        query:
          "INSERT INTO chatmessages (user_id, to_id, file, message, date) VALUES (?, ?, ?, ?, ?)",
        values: [user_id, to_id, "[]", message, date],
      });
    }

    // Insert files separately if they exist
    if (fileUrls.length > 0) {
      fileUrls.forEach((fileUrl) => {
        insertQueries.push({
          query:
            "INSERT INTO chatmessages (user_id, to_id, file, message, date) VALUES (?, ?, ?, ?, ?)",
          values: [user_id, to_id, JSON.stringify([fileUrl]), "", date],
        });
      });
    }

    // Execute all insert queries
    const insertPromises = insertQueries.map(({ query, values }) => {
      return new Promise((resolve, reject) => {
        db.query(query, values, (err, result) => {
          if (err) return reject(err);
          resolve(result.insertId);
        });
      });
    });

    const insertedIds = await Promise.all(insertPromises);
    console.log(insertedIds);
    // Broadcast messages via WebSocket
    insertedIds.forEach((lastInsertId, index) => {
      const isMessage = index === 0 && message; // First insert is a message if message exists
      const broadcastMessage = JSON.stringify({
        event: "ChatMessage",
        user_id,
        to_id,
        message: isMessage ? message : "",
        file: isMessage ? [] : [fileUrls[index - (message ? 1 : 0)]], // Adjust index if message exists
        date,
        lastInsertId,
      });

      if (wss) {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMessage);
          }
        });
      }
    });

    // ✅ Send success response
    res
      .status(200)
      .json({ message, user_id, to_id, files: fileUrls, status: "1" });

    // ✅ Proceed with notifications and emails asynchronously
    handleNotificationAndEmail(user_id, to_id, message, date);
  } catch (error) {
    console.error("Error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};

// **Handle notification insertion and email sending**
function handleNotificationAndEmail(user_id, to_id, message, date) {
  const notificationMessage = " sent you a message";

  db.query("SELECT slug FROM users WHERE id = ?", [user_id], (err, rows) => {
    if (err) {
      console.error("Error fetching slug:", err);
      return;
    }

    if (rows.length > 0) {
      const slug = rows[0].slug;
      const link_href = `/receivedchatmessage/${slug}`;

      db.query(
        "INSERT INTO notification (to_id, user_id, `read`, message, date, link_href) VALUES (?, ?, ?, ?, ?, ?)",
        [user_id, to_id, "Yes", notificationMessage, date, link_href],
        (insertErr) => {
          if (insertErr) {
            console.error("Error inserting notification:", insertErr);
          }
        }
      );
    } else {
      console.log("User not found with the given user_id");
    }
  });

  // **Fetch user details for email notification**
  const userQuery = `
    SELECT 
      MAX(CASE WHEN id = ? THEN email END) AS user1_email,
      MAX(CASE WHEN id = ? THEN email END) AS user2_email,
      MAX(CASE WHEN id = ? THEN username END) AS user1_username,
      MAX(CASE WHEN id = ? THEN username END) AS user2_username,
      MAX(CASE WHEN id = ? THEN notification_message END) AS user1_notification_message,
      MAX(CASE WHEN id = ? THEN notification_message END) AS user2_notification_message
    FROM users`;

  db.query(
    userQuery,
    [to_id, user_id, to_id, user_id, to_id, user_id],
    (err, row) => {
      if (err) {
        console.error("Database query error:", err);
        return;
      }

      if (row.length > 0) {
        const name = row[0].user1_username;
        const sentto_name = row[0].user2_username;
        const email = row[0].user2_email;
        const check1 = row[0].user1_notification_message;

        if (check1 === "Yes") {
          sendEmailFor_ReceivingNotification(
            email,
            sentto_name,
            message,
            (info) => {
              console.log("Email Sent:", info);
            }
          );
        }

        logActivity(user_id, `sent a message to user: ${sentto_name}`);
      }
    }
  );
}

exports.getSEndMessage = async (req, res) => {
  const { data } = req.body;
  console.log(data, "jjjj");
  try {
    // Ensure user_id and to_id are provided
    const { user_id, to_id } = data; // Destructure user_id and to_id

    // Query to fetch chat messages between user_id and to_id
    const query = `
          SELECT
              cm.*,
            u1.profile_image AS user1_profile,
            u1.id AS user1_id,
            u1.makeImagePrivate AS user1_makeImagePrivate,
            u2.profile_image AS user2_profile,
            u2.id AS user2_id,
            u2.makeImagePrivate AS user2_makeImagePrivate
          FROM
              chatmessages cm
          JOIN
              users u1 ON cm.user_id = u1.id
          JOIN
              users u2 ON cm.to_id = u2.id
          WHERE
              (cm.user_id = ? AND cm.to_id = ?) OR
              (cm.user_id = ? AND cm.to_id = ?)
          ORDER BY
              cm.date DESC LIMIT 1
      `;

    // Fetching the messages
    db.query(query, [user_id, to_id, to_id, user_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getSEndMessagequick = async (req, res) => {
  const { data } = req.body;
  console.log(data, "ch");
  try {
    // Ensure user_id and to_id are provided
    const { user_id, to_id, lastInsertId } = data; // Destructure user_id and to_id

    // Query to fetch chat messages between user_id and to_id
    const query = `
          SELECT
              cm.*,
            u1.profile_image AS user1_profile,
            u1.id AS user1_id,
            u1.makeImagePrivate AS user1_makeImagePrivate,
            u2.profile_image AS user2_profile,
            u2.id AS user2_id,
            u2.makeImagePrivate AS user2_makeImagePrivate
          FROM
              chatmessages cm
          JOIN
              users u1 ON cm.user_id = u1.id
          JOIN
              users u2 ON cm.to_id = u2.id
          WHERE
              cm.id = ?
          ORDER BY
              cm.date DESC LIMIT 1
      `;

    // Fetching the messages
    db.query(query, [lastInsertId], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getAllgallery = async (req, res) => {
  const { user_ids } = req.body; // Expecting a string of user IDs
  try {
    // Ensure user_ids is provided
    if (!user_ids) {
      return res.status(400).json({ message: "User IDs are required" });
    }

    // Prepare SQL query to fetch galleries for multiple user IDs
    const query = `
          SELECT g.*, u.username, u.profile_type, u.gender,u.birthday_date,u.birthday_date_her,u.location
          FROM gallery g
          JOIN users u ON g.user_id = u.id
          WHERE g.user_id IN (${user_ids})  -- Use IN clause to filter by multiple user IDs
          ORDER BY g.id DESC;
      `;

    // Fetching the galleries
    db.query(query, (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the gallery data in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getAllfriends = async (req, res) => {
  const { user_id } = req.body;
  try {
    // Ensure user_id and to_id are provided
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Query to fetch chat messages between user_id and to_id
    const query = `
     SELECT
    u.*,
    CASE
        WHEN fr.status = 'Yes' THEN true
        ELSE false
    END AS is_friend,
    CASE
        WHEN bu.user_id IS NOT NULL THEN true
        ELSE false
    END AS is_blocked
FROM
    users u
JOIN
    friendRequest_accept fr
    ON (u.id = fr.sent_to AND fr.user_id = ?)
    OR (u.id = fr.user_id AND fr.sent_to = ?)
LEFT JOIN
    blockuser bu
    ON (u.id = bu.user_id AND bu.to_id = ?)
    OR (u.id = bu.to_id AND bu.user_id = ?)
WHERE
    fr.status = 'Yes'
    AND (
        bu.user_id IS NULL
        AND bu.to_id IS NULL
    )`;

    // Fetching the messages
    db.query(query, [user_id, user_id, user_id, user_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }
      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getgallery = async (req, res) => {
  const { user_id } = req.body;
  try {
    // Ensure user_id and to_id are provided
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Query to fetch chat messages between user_id and to_id
    const query = `
      SELECT g.*, u.username,u.profile_type,u.gender,u.birthday_date,u.birthday_date_her,u.location
      FROM gallery g
      JOIN users u ON g.user_id = u.id
      WHERE g.user_id = ? And u.id = ?  ORDER BY g.id DESC; `;

    // Fetching the messages
    db.query(query, [user_id, user_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

function generateSlug(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // Remove invalid characters
    .trim()
    .replace(/\s+/g, "-") // Replace spaces with hyphens
    .replace(/--+/g, "-"); // Replace multiple hyphens with a single one
}

// Function to create a unique slug
function createUniqueSlug(title, callback) {
  const slug = generateSlug(title);

  // Check if the slug already exists
  db.query(
    "SELECT COUNT(*) as count FROM gallery WHERE slug = ?",
    [slug],
    (err, rows) => {
      if (err) {
        return callback(err); // Handle the error
      }

      // If the slug exists, add a number to the end and check again
      if (rows[0].count > 0) {
        let i = 1;
        const checkSlug = () => {
          const newSlug = `${slug}-${i}`;
          db.query(
            "SELECT COUNT(*) as count FROM gallery WHERE slug = ?",
            [newSlug],
            (err, newRows) => {
              if (err) {
                return callback(err); // Handle the error
              }
              if (newRows[0].count === 0) {
                return callback(null, newSlug); // Return the new unique slug
              }
              i++;
              checkSlug(); // Check again with the incremented slug
            }
          );
        };
        checkSlug(); // Start checking with the incremented slug
      } else {
        callback(null, slug); // Return the original slug if it's unique
      }
    }
  );
}
async function sendEmailFor_GalleryPostNotification(
  byname,
  to,
  message,
  slug,
  callback
) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf",
    },
  });

  const mailOptions = {
    from: "Amourette <amourette.no@gmail.com>",
    to: to,
    subject: "🎨 New Gallery Post on Amourette by " + byname,
    text: `Hello,

Exciting news! A new gallery post has been shared by ${message}.

Join the conversation, explore the latest creations, and share your thoughts.
Best regards,
The Amourette Team`,
    html: `
      <p>Hello,</p>
      <p>Exciting news! <strong>${message} by ${byname}</strong>.</p>
      <p>Join the conversation, explore the latest creations, and share your thoughts.</p>

      <p>Best regards,<br>The Amourette Team</p>
    `,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error:", error);
      if (callback) callback(error);
    } else {
      console.log("Email sent:", info.response);
      if (callback) callback(null, info);
    }
  });
}

exports.gallerysave = async (req, res) => {
  const {
    user_id,
    name,
    makeImageUse,
    description,
    image, // Optional, depending on your needs
    album_id,
  } = req.body;
  // Validate required fields
  if (!user_id || !name || !description) {
    return res.status(400).json({ message: "All fields are required" });
  }
  const wss = req.wss;
  try {
    // Create Date objects and validate

    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");
    var mp = req.body.makeImageUse;
    mp = mp === true || mp === "true" ? 1 : 0;
    if (makeImageUse === "true" || makeImageUse === true) {
      var galleryImage = req.file?.location || null; // Assuming `image` is passed as a URL or path
    } else if (req.file) {
      // If a new file is uploaded, use the file's location
      var galleryImage = req.file?.location || null;
    }
    let idd = "";
    if (album_id !== "") {
      db.query(
        "SELECT albums.*, usersalbum.images,usersalbum.id as idd FROM albums JOIN usersalbum ON usersalbum.album_id = albums.id WHERE albums.id = ?;",
        [album_id],
        (err, removeRows) => {
          if (removeRows.length > 0) {
            const row = removeRows[0];
            idd = row.idd;

            // Parse existing images array from JSON
            let targetImagesArray = [];
            try {
              targetImagesArray = row.images ? JSON.parse(row.images) : [];
            } catch (parseErr) {
              return res
                .status(400)
                .json({ message: "Invalid image data", error: parseErr });
            }

            // Add new image if not already present
            if (!targetImagesArray.includes(galleryImage)) {
              targetImagesArray.push(galleryImage);
            }

            // Check visibility before updating
            if (row.visibility === "Private_visible") {
              db.query(
                "UPDATE usersalbum SET images = ? WHERE user_id = ? AND id = ?",
                [JSON.stringify(targetImagesArray), user_id, idd],
                (finalErr) => {
                  if (finalErr) {
                    return res
                      .status(500)
                      .json({ message: "Update failed", error: finalErr });
                  }
                  return res
                    .status(200)
                    .json({ message: "File moved to album successfully" });
                }
              );
            } else {
              db.query(
                "UPDATE usersalbum SET images = ? WHERE user_id = ? AND id = ?",
                [JSON.stringify(targetImagesArray), user_id, idd],
                (finalErr) => {}
              );
              db.query(
                "INSERT INTO useralbum_file_datetime (user_id,image_url,useralbum_id,date) VALUES (?, ?, ?, ?)",
                [user_id, galleryImage, idd, date],
                (err, result) => {}
              );
              // Generate a unique slug for the event name
              createUniqueSlug(name, (err, slug) => {
                if (err) {
                  console.error("Slug generation error:", err); // Log error to console
                  return res
                    .status(500)
                    .json({ message: "Slug generation error", error: err });
                }

                if (mp === 1) {
                  db.query(
                    "INSERT INTO gallery (status,album_id,makeImageUse,slug, image, user_id, name, description, date) VALUES (?,?,?, ?, ?, ?, ?, ?, ?)",
                    [
                      "Profile",
                      idd,
                      mp,
                      slug,
                      galleryImage,
                      user_id,
                      name,
                      description,
                      date,
                    ],
                    (err, result) => {
                      if (err) {
                        console.error("Database insertion error:", err); // Log error to console
                        return res.status(500).json({
                          message: "Database insertion error",
                          error: err,
                        });
                      }
                      const gidd = result.insertId;
                      db.query(
                        "UPDATE users SET profile_image = ? WHERE id = ?",
                        [galleryImage, user_id],
                        (err, result) => {}
                      );

                      const query = `
            SELECT
                u.*,
                CASE
                    WHEN fr.status = 'Yes' THEN true
                    ELSE false
                END AS is_friend

            FROM
                users u
            JOIN
                friendRequest_accept fr ON
                    (u.id = fr.sent_to AND fr.user_id = ?) OR
                    (u.id = fr.user_id AND fr.sent_to = ?)

            WHERE
                fr.status = 'Yes'  -- Ensure that the friend request is accepted;;`;

                      // Fetching the messages
                      db.query(query, [user_id, user_id], (err, results) => {
                        if (err) {
                          return res.status(500).json({
                            message: "Database query error",
                            error: err,
                          });
                        }
                        // console.log("dddd");
                        // console.log(results);
                        const broadcastMessage = JSON.stringify({
                          event: "gallerynotification",
                          user_id: results,
                          LoginData: results,
                        });
                        // console.log(wss);
                        if (wss) {
                          wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                              // console.log(client.to_id);

                              client.send(broadcastMessage);
                            }
                          });
                        }
                        res.status(201).json({
                          message: "Gallery1 created successfully",
                          galleryId: result.insertId,
                          user_id: user_id,
                          slug: slug, // Return the generated slug
                        });
                        logActivity(
                          user_id,
                          `created a new gallery post successfully`
                        );

                        db.query(
                          `SELECT * FROM users WHERE id = ?`,
                          [user_id],
                          (err, gresults) => {
                            if (err) {
                              return res.status(500).json({
                                message: "Error fetching user data",
                                error: err,
                              });
                            }
                            const sentname = gresults[0].username;
                            const messages = `New gallery post by ` + sentname;
                            const to_id = user_id;

                            // Array to store all promises
                            const insertNotificationsPromises = results.map(
                              (item) => {
                                return new Promise((resolve, reject) => {
                                  const user_idd = item.id;

                                  const sentmail = item.email;
                                  const check = item.notification_news_update;
                                  var link_href = "/allgallery";
                                  // Insert notification into the database
                                  db.query(
                                    "INSERT INTO notification (to_id,user_id, message, date,link_href,post_id) VALUES (?, ?, ?, ?, ?, ?)",
                                    [
                                      to_id,
                                      user_idd,
                                      messages,
                                      date,
                                      link_href,
                                      gidd,
                                    ],
                                    (err, result) => {
                                      if (err) {
                                        console.error(
                                          "Database insertion error for user_id:",
                                          user_idd,
                                          err
                                        );
                                        return reject(err);
                                      }

                                      // Send email only if user has opted in
                                      if (check === "Yes") {
                                        sendEmailFor_GalleryPostNotification(
                                          sentname,
                                          sentmail,
                                          messages,
                                          slug,
                                          (info) => {
                                            resolve({
                                              success: true,
                                              emailInfo: info,
                                            });
                                          }
                                        );
                                      } else {
                                        resolve({
                                          success: true,
                                          emailSkipped: true,
                                        });
                                      }
                                    }
                                  );
                                });
                              }
                            );

                            // Wait for all database inserts & emails
                            Promise.allSettled(insertNotificationsPromises)
                              .then((results) => {
                                const errors = results.filter(
                                  (r) => r.status === "rejected"
                                );

                                if (errors.length > 0) {
                                  return res.status(500).json({
                                    message:
                                      "Some notifications failed to send",
                                    errors: errors.map((e) => e.reason),
                                  });
                                }

                                // res.status(200).json({
                                //   message: "All notifications sent successfully.",
                                // });
                              })
                              .catch((error) => {
                                res.status(500).json({
                                  message: "Error processing notifications",
                                  error: error,
                                });
                              });
                          }
                        );
                      });
                    }
                  );
                } else {
                  db.query(
                    "INSERT INTO gallery (album_id,makeImageUse,slug, image, user_id, name, description, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    [
                      album_id,
                      mp,
                      slug,
                      galleryImage,
                      user_id,
                      name,
                      description,
                      date,
                    ],
                    (err, result) => {
                      if (err) {
                        console.error("Database insertion error:", err); // Log error to console
                        return res.status(500).json({
                          message: "Database insertion error",
                          error: err,
                        });
                      }
                      const gidd = result.insertId;
                      const query = `
                    SELECT
                        u.*,
                        CASE
                            WHEN fr.status = 'Yes' THEN true
                            ELSE false
                        END AS is_friend

                    FROM
                        users u
                    JOIN
                        friendRequest_accept fr ON
                            (u.id = fr.sent_to AND fr.user_id = ?) OR
                            (u.id = fr.user_id AND fr.sent_to = ?)

                    WHERE
                        fr.status = 'Yes'  -- Ensure that the friend request is accepted;;`;

                      // Fetching the messages
                      db.query(query, [user_id, user_id], (err, results) => {
                        if (err) {
                          return res.status(500).json({
                            message: "Database query error",
                            error: err,
                          });
                        }
                        // console.log("dddd");
                        // console.log(results);
                        const broadcastMessage = JSON.stringify({
                          event: "gallerynotification",
                          user_id: results,
                          LoginData: results,
                        });
                        //console.log(wss);
                        if (wss) {
                          wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                              // console.log(client.to_id);

                              client.send(broadcastMessage);
                            }
                          });
                        }

                        logActivity(
                          user_id,
                          `created a new gallery post successfully`
                        );
                        db.query(
                          `SELECT * FROM users WHERE id = ?`,
                          [user_id],
                          (err, gresults) => {
                            if (err) {
                              return res.status(500).json({
                                message: "Error fetching user data",
                                error: err,
                              });
                            }

                            const messages = `New gallery post`;
                            const to_id = user_id;
                            const sentname = gresults[0].username;
                            // Array to store all promises
                            const insertNotificationsPromises = results.map(
                              (item) => {
                                return new Promise((resolve, reject) => {
                                  const user_idd = item.id;
                                  const sentmail = item.email;
                                  const check = item.notification_news_update;
                                  var link_href = "/allgallery";
                                  // Insert notification into the database
                                  db.query(
                                    "INSERT INTO notification (to_id,user_id, message, date,link_href,post_id) VALUES (?, ?, ?, ?, ?, ?)",
                                    [
                                      to_id,
                                      user_idd,
                                      messages,
                                      date,
                                      link_href,
                                      gidd,
                                    ],
                                    (err, result) => {
                                      if (err) {
                                        console.error(
                                          "Database insertion error for user_id:",
                                          user_idd,
                                          err
                                        );
                                        return reject(err);
                                      }

                                      // Send email only if user has opted in
                                      if (check === "Yes") {
                                        sendEmailFor_GalleryPostNotification(
                                          sentname,
                                          sentmail,
                                          messages,
                                          slug,
                                          (info) => {
                                            resolve({
                                              success: true,
                                              emailInfo: info,
                                            });
                                          }
                                        );
                                      } else {
                                        resolve({
                                          success: true,
                                          emailSkipped: true,
                                        });
                                      }
                                    }
                                  );
                                });
                              }
                            );

                            // Wait for all database inserts & emails
                            Promise.allSettled(insertNotificationsPromises)
                              .then((results) => {
                                const errors = results.filter(
                                  (r) => r.status === "rejected"
                                );

                                if (errors.length > 0) {
                                  return res.status(500).json({
                                    message:
                                      "Some notifications failed to send",
                                    errors: errors.map((e) => e.reason),
                                  });
                                }
                              })
                              .catch((error) => {
                                res.status(500).json({
                                  message: "Error processing notifications",
                                  error: error,
                                });
                              });
                          }
                        );
                        res.status(200).json({
                          message: "Gallery created successfully",
                          galleryId: result.insertId,
                          user_id: user_id,
                          slug: slug, // Return the generated slug
                        });
                      });
                    }
                  );
                }
                // Insert the event data including the slug
              });
            }
          }
        }
      );
    } else {
      // Generate a unique slug for the event name
      createUniqueSlug(name, (err, slug) => {
        if (err) {
          console.error("Slug generation error:", err); // Log error to console
          return res
            .status(500)
            .json({ message: "Slug generation error", error: err });
        }

        if (mp === 1) {
          db.query(
            "INSERT INTO gallery (status,album_id,makeImageUse,slug, image, user_id, name, description, date) VALUES (?,?, ?, ?, ?, ?, ?, ?, ?)",
            [
              "Profile",
              idd,
              mp,
              slug,
              galleryImage,
              user_id,
              name,
              description,
              date,
            ],
            (err, result) => {
              if (err) {
                console.error("Database insertion error:", err); // Log error to console
                return res.status(500).json({
                  message: "Database insertion error",
                  error: err,
                });
              }
              const gidd = result.insertId;
              console.log(galleryImage, user_id);
              db.query(
                "UPDATE users SET profile_image = ? WHERE id = ?",
                [galleryImage, user_id],
                (err, result) => {}
              );

              const query = `
            SELECT
                u.*,
                CASE
                    WHEN fr.status = 'Yes' THEN true
                    ELSE false
                END AS is_friend

            FROM
                users u
            JOIN
                friendRequest_accept fr ON
                    (u.id = fr.sent_to AND fr.user_id = ?) OR
                    (u.id = fr.user_id AND fr.sent_to = ?)

            WHERE
                fr.status = 'Yes'  -- Ensure that the friend request is accepted;;`;

              // Fetching the messages
              db.query(query, [user_id, user_id], (err, results) => {
                if (err) {
                  return res.status(500).json({
                    message: "Database query error",
                    error: err,
                  });
                }
                // console.log("dddd");
                // console.log(results);
                const broadcastMessage = JSON.stringify({
                  event: "gallerynotification",
                  user_id: results,
                  LoginData: results,
                });
                // console.log(wss);
                if (wss) {
                  wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                      // console.log(client.to_id);

                      client.send(broadcastMessage);
                    }
                  });
                }
                res.status(201).json({
                  message: "Gallery1 created successfully",
                  galleryId: result.insertId,
                  user_id: user_id,
                  slug: slug, // Return the generated slug
                });
                logActivity(user_id, `created a new gallery post successfully`);

                db.query(
                  `SELECT * FROM users WHERE id = ?`,
                  [user_id],
                  (err, gresults) => {
                    if (err) {
                      return res.status(500).json({
                        message: "Error fetching user data",
                        error: err,
                      });
                    }
                    const sentname = gresults[0].username;
                    const messages = `New gallery post by ` + sentname;
                    const to_id = user_id;

                    // Array to store all promises
                    const insertNotificationsPromises = results.map((item) => {
                      return new Promise((resolve, reject) => {
                        const user_idd = item.id;

                        const sentmail = item.email;
                        const check = item.notification_news_update;
                        var link_href = "/allgallery";
                        // Insert notification into the database
                        db.query(
                          "INSERT INTO notification (to_id,user_id, message, date,link_href,post_id) VALUES (?, ?, ?, ?, ?,?)",
                          [to_id, user_idd, messages, date, link_href, gidd],
                          (err, result) => {
                            if (err) {
                              console.error(
                                "Database insertion error for user_id:",
                                user_idd,
                                err
                              );
                              return reject(err);
                            }

                            // Send email only if user has opted in
                            if (check === "Yes") {
                              sendEmailFor_GalleryPostNotification(
                                sentname,
                                sentmail,
                                messages,
                                slug,
                                (info) => {
                                  resolve({ success: true, emailInfo: info });
                                }
                              );
                            } else {
                              resolve({ success: true, emailSkipped: true });
                            }
                          }
                        );
                      });
                    });

                    // Wait for all database inserts & emails
                    Promise.allSettled(insertNotificationsPromises)
                      .then((results) => {
                        const errors = results.filter(
                          (r) => r.status === "rejected"
                        );

                        if (errors.length > 0) {
                          return res.status(500).json({
                            message: "Some notifications failed to send",
                            errors: errors.map((e) => e.reason),
                          });
                        }

                        // res.status(200).json({
                        //   message: "All notifications sent successfully.",
                        // });
                      })
                      .catch((error) => {
                        res.status(500).json({
                          message: "Error processing notifications",
                          error: error,
                        });
                      });
                  }
                );
              });
            }
          );
        } else {
          db.query(
            "INSERT INTO gallery (album_id, makeImageUse,slug, image, user_id, name, description, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [idd, mp, slug, galleryImage, user_id, name, description, date],
            (err, result) => {
              if (err) {
                console.error("Database insertion error:", err); // Log error to console
                return res
                  .status(500)
                  .json({ message: "Database insertion error", error: err });
              }
              const gidd = result.insertId;
              const query = `
                    SELECT
                        u.*,
                        CASE
                            WHEN fr.status = 'Yes' THEN true
                            ELSE false
                        END AS is_friend

                    FROM
                        users u
                    JOIN
                        friendRequest_accept fr ON
                            (u.id = fr.sent_to AND fr.user_id = ?) OR
                            (u.id = fr.user_id AND fr.sent_to = ?)

                    WHERE
                        fr.status = 'Yes'  -- Ensure that the friend request is accepted;;`;

              // Fetching the messages
              db.query(query, [user_id, user_id], (err, results) => {
                if (err) {
                  return res.status(500).json({
                    message: "Database query error",
                    error: err,
                  });
                }
                // console.log("dddd");
                // console.log(results);
                const broadcastMessage = JSON.stringify({
                  event: "gallerynotification",
                  user_id: results,
                  LoginData: results,
                });
                //console.log(wss);
                if (wss) {
                  wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                      // console.log(client.to_id);

                      client.send(broadcastMessage);
                    }
                  });
                }

                logActivity(user_id, `created a new gallery post successfully`);
                db.query(
                  `SELECT * FROM users WHERE id = ?`,
                  [user_id],
                  (err, gresults) => {
                    if (err) {
                      return res.status(500).json({
                        message: "Error fetching user data",
                        error: err,
                      });
                    }

                    const messages = `New gallery post`;
                    const to_id = user_id;
                    const sentname = gresults[0].username;
                    // Array to store all promises
                    const insertNotificationsPromises = results.map((item) => {
                      return new Promise((resolve, reject) => {
                        const user_idd = item.id;
                        const sentmail = item.email;
                        const check = item.notification_news_update;
                        var link_href = "/allgallery";
                        console.log(gidd, "lll");
                        // Insert notification into the database
                        db.query(
                          "INSERT INTO notification (to_id,user_id, message, date,link_href,post_id) VALUES (?, ?, ?, ?, ?, ?)",
                          [to_id, user_idd, messages, date, link_href, gidd],
                          (err, result) => {
                            if (err) {
                              console.error(
                                "Database insertion error for user_id:",
                                user_idd,
                                err
                              );
                              return reject(err);
                            }

                            // Send email only if user has opted in
                            if (check === "Yes") {
                              sendEmailFor_GalleryPostNotification(
                                sentname,
                                sentmail,
                                messages,
                                slug,
                                (info) => {
                                  resolve({ success: true, emailInfo: info });
                                }
                              );
                            } else {
                              resolve({ success: true, emailSkipped: true });
                            }
                          }
                        );
                      });
                    });

                    // Wait for all database inserts & emails
                    Promise.allSettled(insertNotificationsPromises)
                      .then((results) => {
                        const errors = results.filter(
                          (r) => r.status === "rejected"
                        );

                        if (errors.length > 0) {
                          return res.status(500).json({
                            message: "Some notifications failed to send",
                            errors: errors.map((e) => e.reason),
                          });
                        }
                      })
                      .catch((error) => {
                        res.status(500).json({
                          message: "Error processing notifications",
                          error: error,
                        });
                      });
                  }
                );
                res.status(200).json({
                  message: "Gallery created successfully",
                  galleryId: result.insertId,
                  user_id: user_id,
                  slug: slug, // Return the generated slug
                });
              });
            }
          );
        }
        // Insert the event data including the slug
      });
    }
  } catch (error) {
    console.error("Event creation error:", error); // Log error to console
    res.status(500).json({ message: "Event creation error", error });
  }
};

exports.getGalleryDetail = async (req, res) => {
  const { id, user_id } = req.body;
  try {
    // Ensure user_id and to_id are provided
    if (!id) {
      return res.status(400).json({ message: "ID is required" });
    }

    // Query to fetch chat messages between user_id and to_id
    const query = `
     SELECT g.*,
       u.username,u.id as uid,
       u.profile_type,
       u.gender,
       u.profile_image,
       COUNT(gf.id) AS total_favourites,
       CASE
         WHEN EXISTS (
           SELECT 1
           FROM gallery_favourite gf2
           WHERE gf2.gallery_id = g.id AND gf2.user_id = ?
         ) THEN 1
         ELSE 0
       END AS user_favourited
      FROM gallery g
      JOIN users u ON g.user_id = u.id
      LEFT JOIN gallery_favourite gf ON g.id = gf.gallery_id
      WHERE g.id = ?
      GROUP BY g.id, u.username, u.profile_type, u.gender, u.profile_image;
;
      `;

    // Fetching the messages
    db.query(query, [user_id, id], (err, row) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ row });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getGalleryGroupforumDetail = async (req, res) => {
  const { id, user_id, post_type } = req.body;
  console.log(req.body);
  try {
    if (!id || !post_type) {
      return res.status(400).json({ message: "ID and post_type are required" });
    }

    let query = "";
    let queryParams = [];

    if (post_type === "gallery") {
      query = `
        SELECT g.*,gf.id as favid, 'gallery' AS pertype, u.username, u.id AS uid, u.profile_type, u.gender, u.profile_image,
          COUNT(gf.id) AS total_favourites,
          CASE
            WHEN EXISTS (
              SELECT 1 FROM gallery_favourite gf2 WHERE gf2.gallery_id = g.id
            ) THEN 1
            ELSE 0
          END AS user_favourited
        FROM gallery g
        JOIN users u ON g.user_id = u.id
        LEFT JOIN gallery_favourite gf ON g.id = gf.gallery_id
        WHERE g.id = ?
        GROUP BY g.id, u.username, u.profile_type, u.gender, u.profile_image
      `;
      queryParams = [id];
    } else if (post_type === "group") {
      query = `
        
SELECT 
  gp.*, 
  'group' AS pertype, gpf.id as favid,
  u.username, 
  u.id AS uid, 
  u.profile_type, 
  u.gender, 
  u.profile_image,
  COUNT(gpf.id) AS total_favourites,
  CASE
    WHEN EXISTS (
      SELECT 1 
      FROM group_post_favourite gpf2 
      WHERE gpf2.post_id = gp.id AND gpf2.user_id = ?
    ) THEN 1
    ELSE 0
  END AS user_favourited
FROM group_post gp
JOIN users u ON gp.user_id = u.id
LEFT JOIN group_post_favourite gpf ON gp.id = gpf.post_id
WHERE 
  gp.id = ? 
  OR gp.group_id IN (
    SELECT group_id 
    FROM groups_invite 
    WHERE sent_id = ? AND accept = 'Yes'
  )
GROUP BY 
  gp.id, u.username, u.id, u.profile_type, u.gender, u.profile_image ;

      `;
      queryParams = [user_id, id, user_id];
    } else if (post_type === "forum") {
      query = `
       SELECT f.*, 'forum' AS pertype, u.username,fpf.id as favid, u.id AS uid, u.profile_type, u.gender, u.profile_image,
        COUNT(fpf.id) AS total_favourites,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM form_post_favourite fpf2 WHERE fpf2.post_id = f.id
          ) THEN 1
          ELSE 0
        END AS user_favourited
      FROM forum f
      JOIN users u ON f.user_id = u.id
      LEFT JOIN form_post_favourite fpf ON f.id = fpf.post_id
      WHERE f.id = ?
      GROUP BY f.id, u.username, u.profile_type, u.gender, u.profile_image;


      `;
      queryParams = [id];
    } else {
      return res.status(400).json({ message: "Invalid post_type" });
    }

    // Execute the query
    db.query(query, queryParams, (err, row) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({ row });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getGalleryDetailnextprevious = async (req, res) => {
  const { id, user_id } = req.body;

  try {
    if (!id) {
      return res.status(400).json({ message: "ID is required" });
    }

    // Query to get current gallery details + previous and next gallery IDs
    const query = `
      SELECT g.*,
        u.username,
        u.profile_type,
        u.gender,
        u.profile_image,
        COUNT(gf.id) AS total_favourites,
        CASE
          WHEN EXISTS (
            SELECT 1 FROM gallery_favourite gf2
            WHERE gf2.gallery_id = g.id AND gf2.user_id = ?
          ) THEN 1 ELSE 0
        END AS user_favourited
      FROM gallery g
      JOIN users u ON g.user_id = u.id
      LEFT JOIN gallery_favourite gf ON g.id = gf.gallery_id
      WHERE g.id = ?
      GROUP BY g.id, u.username, u.profile_type, u.gender, u.profile_image;
    `;

    // Query to get previous and next gallery IDs
    const prevNextQuery = `
      SELECT 
        (SELECT id FROM gallery WHERE id < ? ORDER BY id DESC LIMIT 1) AS previous_gallery_id,
        (SELECT id FROM gallery WHERE id > ? ORDER BY id ASC LIMIT 1) AS next_gallery_id
    `;

    db.query(query, [user_id, id], (err, galleryData) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (galleryData.length === 0) {
        return res.status(404).json({ message: "Gallery not found" });
      }

      db.query(prevNextQuery, [id, id], (err, prevNextData) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        const result = {
          gallery: galleryData[0],
          previous_gallery_id: prevNextData[0].previous_gallery_id || null,
          next_gallery_id: prevNextData[0].next_gallery_id || null,
        };

        return res.status(200).json(result);
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getGalleryDetailnextpreviousspecificuser = async (req, res) => {
  const { id, user_id } = req.body;
  console.log(req.body);

  try {
    if (!id || !user_id) {
      return res
        .status(400)
        .json({ message: "Gallery ID and User ID are required" });
    }

    // Query to get current gallery details
    const query = `
      SELECT g.*,
             u.username,
             u.profile_type,
             u.gender,
             u.profile_image,
             COUNT(gf.id) AS total_favourites,
             CASE
               WHEN EXISTS (
                 SELECT 1 FROM gallery_favourite gf2
                 WHERE gf2.gallery_id = g.id AND gf2.user_id = ?
               ) THEN 1 ELSE 0
             END AS user_favourited
      FROM gallery g
      JOIN users u ON g.user_id = u.id
      LEFT JOIN gallery_favourite gf ON g.id = gf.gallery_id
      WHERE g.id = ? AND g.user_id = ?
      GROUP BY g.id
      LIMIT 1
    `;

    // Query to get previous and next gallery IDs of the same user
    const prevNextQuery = `
      SELECT 
        (SELECT id FROM gallery WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 1) AS previous_gallery_id,
        (SELECT id FROM gallery WHERE user_id = ? AND id > ? ORDER BY id ASC LIMIT 1) AS next_gallery_id
    `;

    db.query(query, [user_id, id, user_id], (err, galleryData) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (!galleryData.length) {
        return res.status(404).json({ message: "Gallery not found" });
      }

      db.query(
        prevNextQuery,
        [user_id, id, user_id, id],
        (err, prevNextData) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Navigation query error", error: err });
          }

          return res.status(200).json({
            gallery: galleryData[0],
            previous_gallery_id: prevNextData[0]?.previous_gallery_id || null,
            next_gallery_id: prevNextData[0]?.next_gallery_id || null,
          });
        }
      );
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getUserDetail = async (req, res) => {
  const { user_id } = req.body;
  try {
    // Ensure user_id and to_id are provided
    if (!user_id) {
      return res.status(400).json({ message: "ID is required" });
    }

    // Query to fetch chat messages between user_id and to_id
    const query = `
      SELECT * from users where id=?`;

    // Fetching the messages
    db.query(query, [user_id], (err, row) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ row });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.galleryPostLike = async (req, res) => {
  const { id, user_id } = req.body;
  const wss = req.wss;
  // Validate required fields
  if (!id || !user_id) {
    return res.status(400).json({ message: "ID and User ID are required." });
  }

  try {
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");
    db.query("SELECT * FROM gallery WHERE id = ?", [id], (err, galleryRows) => {
      if (galleryRows.length > 0) {
        const gallery = galleryRows[0];
        console.log(gallery, "kkk");
        const checkAlbum = gallery.album_id;

        if (checkAlbum !== 0) {
          db.query(
            "SELECT * FROM usersalbum WHERE album_id = ?",
            [checkAlbum],
            async (err, albumRows) => {
              if (!err && albumRows.length > 0) {
                var id = checkAlbum;
                var image_url = gallery.image;
                await UseralbumPostLike_dashboardEnd(
                  id,
                  user_id,
                  image_url,
                  wss,
                  res
                );
              }
            }
          );
        }
      }
    });
    // Check if the entry already exists
    const checkExistsQuery = `SELECT * FROM gallery_favourite WHERE user_id = ? AND gallery_id = ?`;
    db.query(checkExistsQuery, [user_id, id], (err, row) => {
      if (err) {
        console.error("Database query error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (row.length > 0) {
        // If exists, update the existing record by deleting it
        const deleteQuery = `DELETE FROM gallery_favourite WHERE user_id = ? AND gallery_id = ?`;
        db.query(deleteQuery, [user_id, id], (deleteErr) => {
          if (deleteErr) {
            console.error("Database delete error:", deleteErr);
            return res
              .status(500)
              .json({ message: "Database delete error", error: deleteErr });
          }
          // Broadcast the unliking event
          handleBroadcast(user_id, id, wss, date, res, "out");
        });
      } else {
        // If not exists, insert a new record
        const insertQuery = `INSERT INTO gallery_favourite (gallery_id, user_id, date) VALUES (?, ?, ?)`;
        db.query(insertQuery, [id, user_id, date], (insertErr) => {
          if (insertErr) {
            console.error("Database insert error:", insertErr);
            return res
              .status(500)
              .json({ message: "Database insert error", error: insertErr });
          }
          // Broadcast the liking event
          handleBroadcast(user_id, id, wss, date, res, "in");
        });
      }
    });
  } catch (error) {
    console.error("Event retrieval error:", error); // Log error to console
    res.status(500).json({ message: "Event retrieval error", error });
  }
};

exports.forumPostLike = async (req, res) => {
  const { id, user_id } = req.body;
  const wss = req.wss;
  // Validate required fields
  if (!id || !user_id) {
    return res.status(400).json({ message: "ID and User ID are required." });
  }

  try {
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Check if the entry already exists
    const checkExistsQuery = `SELECT * FROM gallery_favourite WHERE user_id = ? AND gallery_id = ?`;
    db.query(checkExistsQuery, [user_id, id], (err, row) => {
      if (err) {
        console.error("Database query error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (row.length > 0) {
        // If exists, update the existing record by deleting it
        const deleteQuery = `DELETE FROM gallery_favourite WHERE user_id = ? AND gallery_id = ?`;
        db.query(deleteQuery, [user_id, id], (deleteErr) => {
          if (deleteErr) {
            console.error("Database delete error:", deleteErr);
            return res
              .status(500)
              .json({ message: "Database delete error", error: deleteErr });
          }
          // Broadcast the unliking event
          handleBroadcast(user_id, id, wss, date, res, "out");
        });
      } else {
        // If not exists, insert a new record
        const insertQuery = `INSERT INTO gallery_favourite (gallery_id, user_id, date) VALUES (?, ?, ?)`;
        db.query(insertQuery, [id, user_id, date], (insertErr) => {
          if (insertErr) {
            console.error("Database insert error:", insertErr);
            return res
              .status(500)
              .json({ message: "Database insert error", error: insertErr });
          }
          // Broadcast the liking event
          handleBroadcast(user_id, id, wss, date, res, "in");
        });
      }
    });
  } catch (error) {
    console.error("Event retrieval error:", error); // Log error to console
    res.status(500).json({ message: "Event retrieval error", error });
  }
};

// Function to handle broadcasting of like/unlike events
function handleBroadcast(user_id, id, wss, date, res, ch) {
  const userQuery = `SELECT g.*,
    u.username,
    u.profile_image,
    COUNT(gf.id) AS total_favourites,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM gallery_favourite gf2
        WHERE gf2.gallery_id = g.id AND gf2.user_id = ?
      ) THEN 1
      ELSE 0
    END AS user_favourited
    FROM gallery g
    JOIN users u ON g.user_id = u.id
    LEFT JOIN gallery_favourite gf ON g.id = gf.gallery_id
    WHERE g.id = ?
    GROUP BY g.id, u.username, u.profile_image`;

  db.query(userQuery, [user_id, id], (err, userResult) => {
    if (err || userResult.length === 0) {
      return res
        .status(500)
        .json({ message: "User not found or query error", error: err });
    }

    const {
      username,
      profile_image,
      description,
      user_favourited,
      total_favourites,
    } = userResult[0];

    // Create the broadcast message
    const broadcastMessage = JSON.stringify({
      event: "GalleryLike",
      user_favourited: user_favourited,
      user_id: user_id,
      total_favourites: total_favourites,
      gallery_id: id,
      description: description,
      username: username, // Include username
      date: date, // Use the current date
      profile_image: profile_image, // Include profile image URL
    });
    if (ch === "in") {
      logActivity(user_id, ` Liked a photo `);
      var message = " liked your post by " + username;
      const query = `
  SELECT
    u.*,
    CASE WHEN fr.status = 'Yes' THEN true ELSE false END AS is_friend
  FROM
    users u
  JOIN
    friendRequest_accept fr
  ON
    (u.id = fr.sent_to AND fr.user_id = ?) OR
    (u.id = fr.user_id AND fr.sent_to = ?)
  WHERE
    fr.status = 'Yes';
`;

      db.query(query, [user_id, user_id], (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        // Send WebSocket notification
        const broadcastMessage = JSON.stringify({
          event: "eventrequest_acceptnotification",
          user_id: results,
          LoginData: results,
        });

        if (wss) {
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(broadcastMessage);
            }
          });
        }

        // Fetch sender details
        db.query(
          `SELECT username, email, notification_group_event FROM users WHERE id = ?`,
          [user_id],
          async (err, senderResult) => {
            if (err) {
              return res.status(500).json({
                message: "Error fetching username",
                error: err,
              });
            }

            const senderUsername = senderResult[0]?.username || "Unknown User";
            const senderEmail = senderResult[0]?.email || "";
            const notificationGroupEvent =
              senderResult[0]?.notification_news_update;
            const notificationMessage = message;
            const date = moment
              .tz(new Date(), "Europe/Oslo")
              .format("YYYY-MM-DD HH:mm:ss");
            var link_href = "/allgallery";

            // Insert notifications for each friend
            const insertNotificationsPromises = results.map((item) => {
              return new Promise((resolve, reject) => {
                db.query(
                  "INSERT INTO notification (post_id,user_id, to_id, message, date, link_href) VALUES (?, ?, ?, ?, ?, ?)",
                  [id, item.id, user_id, notificationMessage, date, link_href],
                  (err, result) => {
                    if (err) {
                      console.error("Database insertion error:", err);
                      reject(err);
                    } else {
                      resolve(result);
                    }
                  }
                );
              });
            });

            try {
              await Promise.all(insertNotificationsPromises);

              // Send email notification for each friend if group event setting is "Yes"

              const emailPromises = results.map(async (item) => {
                console.log(item.email);
                if (item.notification_news_update === "Yes") {
                  await sendEmailFor_postlikeNotification(
                    item.email,
                    item.username,
                    senderUsername
                  );
                }
                // Call the email function for each friend
              });

              await Promise.all(emailPromises);
              return res.status(200).json({
                message: "Successfully created.",
              });
            } catch (error) {}
          }
        );
      });
    }
    if (wss) {
      // Ensure that wss exists and is broadcasting
      try {
        console.log("Broadcasting message to clients...");
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMessage);
          }
        });
        console.log("Message broadcasted successfully.");
      } catch (error) {
        console.error("WebSocket broadcast error:", error);
      }
    } else {
      console.log("WebSocket Server not attached");
    }

    res.status(201).json({
      message: "Gallery Favourite created successfully.",
      status: "1",
    });
  });
}
function handleBroadcast_Useralbum(user_id, gallery_id, wss, date, ch) {
  const userQuery = `
    SELECT g.*, u.username, u.profile_image, COUNT(gf.id) AS total_favourites,
    CASE WHEN EXISTS (
      SELECT 1 FROM gallery_favourite gf2 WHERE gf2.gallery_id = g.id AND gf2.user_id = ?
    ) THEN 1 ELSE 0 END AS user_favourited
    FROM gallery g
    JOIN users u ON g.user_id = u.id
    LEFT JOIN gallery_favourite gf ON g.id = gf.gallery_id
    WHERE g.id = ?
    GROUP BY g.id, u.username, u.profile_image`;

  db.query(userQuery, [user_id, gallery_id], (err, userResult) => {
    if (err || userResult.length === 0) return;

    const {
      username,
      profile_image,
      description,
      user_favourited,
      total_favourites,
    } = userResult[0];

    const broadcastMessage = JSON.stringify({
      event: "GalleryLike",
      user_favourited,
      user_id,
      total_favourites,
      gallery_id,
      description,
      username,
      date,
      profile_image,
    });

    if (wss) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMessage);
        }
      });
    }

    if (ch === "in") {
      logActivity(user_id, "Liked a photo");
      const message = `liked your post by ${username}`;
      const dateNow = moment
        .tz(new Date(), "Europe/Oslo")
        .format("YYYY-MM-DD HH:mm:ss");

      const query = `
        SELECT u.*, CASE WHEN fr.status = 'Yes' THEN true ELSE false END AS is_friend
        FROM users u
        JOIN friendRequest_accept fr
        ON (u.id = fr.sent_to AND fr.user_id = ?) OR (u.id = fr.user_id AND fr.sent_to = ?)
        WHERE fr.status = 'Yes'`;

      db.query(query, [user_id, user_id], async (err, friends) => {
        if (err) return;

        const insertPromises = friends.map((friend) => {
          return new Promise((resolve, reject) => {
            db.query(
              `INSERT INTO notification (user_id, to_id, message, date, link_href) VALUES (?, ?, ?, ?, ?)`,
              [friend.id, user_id, message, dateNow, "/dashboard"],
              (err) => (err ? reject(err) : resolve())
            );
          });
        });

        try {
          await Promise.all(insertPromises);

          const emailPromises = friends.map(async (friend) => {
            if (friend.notification_news_update === "Yes") {
              await sendEmailFor_postlikeNotification(
                friend.email,
                friend.username,
                username
              );
            }
          });

          await Promise.all(emailPromises);
        } catch (e) {
          console.error("Notification or email error:", e);
        }
      });
    }
  });
}
async function sendEmailFor_postlikeNotification(too, name, byname) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf", // Use environment variables for sensitive data
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: too,
    subject: `Post was liked by ${byname}`, // Updated subject to reflect post like
    text: `Hello,\n\nWe are excited to inform you that your post has been liked by ${byname} on Amourette.\n\nKeep posting and stay connected!\n\nBest regards,\nThe Amourette Team`, // Updated text
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response);
  } catch (error) {
    console.error("Error sending email:", error);
  }
}
async function sendEmailFor_postcommentNotification(too, name, byname) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf", // Use environment variables for sensitive data
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: too,
    subject: `Commented on post by ${byname}`, // Updated subject to reflect comment
    text: `Hello,\n\nWe are excited to inform you that your post has received a comment from ${byname} on Amourette.\n\nStay active and keep engaging with the community!\n\nBest regards,\nThe Amourette Team`, // Updated text for comment
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response);
  } catch (error) {
    console.error("Error sending email:", error);
  }
}

exports.getGalleryComments = async (req, res) => {
  const { id, user_id } = req.body;
  // Validate required fields
  if (!id || !user_id) {
    return res.status(400).json({ message: "ID and User ID are required." });
  }

  try {
    // Check if the entry already exists

    const query = `
      SELECT gc.*,
       u.username,u.makeImagePrivate,
       u.profile_image
      FROM gallery_comment gc
      JOIN users u ON gc.user_id = u.id
      WHERE gc.gallery_id = ?;
    `;

    // Fetching the messages
    db.query(query, [id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    console.error("Event retrieval error:", error); // Log error to console
    res.status(500).json({ message: "Event retrieval error", error });
  }
};
exports.getGalleryCommentsDashboard = async (req, res) => {
  const { id, user_id, post_type } = req.body;

  if (!id || !user_id) {
    return res.status(400).json({ message: "ID and User ID are required." });
  }

  try {
    let query = "";
    let queryParams = [id];

    if (post_type === "gallery") {
      query = `
        SELECT gc.*, u.username, u.makeImagePrivate, u.profile_image
        FROM gallery_comment gc
        JOIN users u ON gc.user_id = u.id
        WHERE gc.gallery_id = ?;
      `;
    } else if (post_type === "group") {
      query = `
        SELECT gc.*, u.username, u.makeImagePrivate, u.profile_image
        FROM group_post_comment gc
        JOIN users u ON gc.user_id = u.id
        WHERE gc.group_post_id = ?;
      `;
    } else if (post_type === "forum") {
      query = `
        SELECT gc.*, u.username, u.makeImagePrivate, u.profile_image
        FROM forum_comment gc
        JOIN users u ON gc.user_id = u.id
        WHERE gc.forum_id = ?;
      `;
    } else {
      return res.status(400).json({ message: "Invalid post_type." });
    }

    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      return res.status(200).json({ results });
    });
  } catch (error) {
    console.error("Comment retrieval error:", error);
    return res.status(500).json({ message: "Comment retrieval error", error });
  }
};

exports.GalleryPostSave = async (req, res) => {
  const { description, gallery_id, user_id } = req.body;
  const wss = req.wss;

  if (!gallery_id || !user_id) {
    return res
      .status(400)
      .json({ message: "Gallery ID and User ID are required" });
  }

  const date = moment
    .tz(new Date(), "Europe/Oslo")
    .format("YYYY-MM-DD HH:mm:ss");

  try {
    db.query(
      "SELECT * FROM gallery WHERE id = ?",
      [gallery_id],
      (err, galleryRows) => {
        if (err || galleryRows.length === 0) {
          return res
            .status(500)
            .json({ message: "Gallery not found", error: err });
        }

        const gallery = galleryRows[0];
        const checkAlbum = gallery.album_id;

        if (checkAlbum !== 0) {
          db.query(
            "SELECT * FROM usersalbum WHERE album_id = ?",
            [checkAlbum],
            (err, albumRows) => {
              if (!err && albumRows.length > 0) {
                db.query(
                  `INSERT INTO usersalbumcomment (user_id, image_url, usersalbum_id, message, date)
              VALUES (?, ?, ?, ?, ?)`,
                  [user_id, gallery.image, albumRows[0].id, description, date],
                  (err, result) => {
                    const insertedCommentId = result.insertId;
                    if (wss) {
                      const broadcastMessage = JSON.stringify({
                        event: "UserAlbumComments",
                        comment_id: albumRows[0].id,
                        insertedCommentId: insertedCommentId,
                      });

                      wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                          client.send(broadcastMessage);
                        }
                      });
                    }
                  }
                );
              }
            }
          );
        }

        // Insert comment into gallery_comment
        db.query(
          `INSERT INTO gallery_comment (gallery_id, user_id, description, date)
        VALUES (?, ?, ?, ?)`,
          [gallery_id, user_id, description, date],
          (err, commentResult) => {
            if (err) {
              return res
                .status(500)
                .json({ message: "Failed to insert comment", error: err });
            }

            const commentId = commentResult.insertId;

            // Send initial response early to avoid "headers already sent"
            res
              .status(200)
              .json({ message: "Comment added successfully", commentId });

            // Continue rest of logic after response is sent
            db.query(
              `SELECT username, profile_image, makeImagePrivate FROM users WHERE id = ?`,
              [user_id],
              (err, userResult) => {
                if (err || userResult.length === 0) return;

                const { username, profile_image, makeImagePrivate } =
                  userResult[0];

                const broadcastMessage = JSON.stringify({
                  event: "GalleryPost",
                  user_id,
                  gallery_id,
                  username,
                  message: description,
                  makeImagePrivate,
                  date,
                  profile_image,
                  lastInsertId: commentId,
                });

                // Broadcast to WebSocket clients
                if (wss) {
                  wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                      client.send(broadcastMessage);
                    }
                  });
                }

                const gname = gallery.name;
                const byuser = gallery.user_id;

                db.query(
                  `SELECT username FROM users WHERE id = ?`,
                  [byuser],
                  (err, byUserResult) => {
                    if (err) return;
                    const byUsername =
                      byUserResult[0]?.username || "Unknown User";

                    logActivity(user_id, `commented on the gallery ${gname}`);

                    // Get friends
                    const friendQuery = `
                SELECT u.*, CASE WHEN fr.status = 'Yes' THEN true ELSE false END AS is_friend
                FROM users u
                JOIN friendRequest_accept fr ON
                  (u.id = fr.sent_to AND fr.user_id = ?) OR
                  (u.id = fr.user_id AND fr.sent_to = ?)
                WHERE fr.status = 'Yes';
              `;

                    db.query(
                      friendQuery,
                      [user_id, user_id],
                      async (err, friends) => {
                        if (err || friends.length === 0) return;

                        // Notify via WebSocket
                        const wsNotification = JSON.stringify({
                          event: "eventrequest_acceptnotification",
                          user_id: friends,
                          LoginData: friends,
                        });

                        if (wss) {
                          wss.clients.forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                              client.send(wsNotification);
                            }
                          });
                        }

                        // Fetch sender info
                        db.query(
                          `SELECT username, email, notification_news_update FROM users WHERE id = ?`,
                          [user_id],
                          async (err, senderResult) => {
                            if (err || senderResult.length === 0) return;

                            const senderUsername = senderResult[0].username;
                            const notificationMessage = `commented on the post by ${byUsername}`;
                            const link_href = "/allgallery";

                            const notificationInserts = friends.map(
                              (friend) => {
                                return new Promise((resolve, reject) => {
                                  db.query(
                                    `INSERT INTO notification (user_id, to_id, message, date, link_href, post_id)
                          VALUES (?, ?, ?, ?, ?, ?)`,
                                    [
                                      friend.id,
                                      user_id,
                                      notificationMessage,
                                      date,
                                      link_href,
                                      gallery_id,
                                    ],
                                    (err) => (err ? reject(err) : resolve())
                                  );
                                });
                              }
                            );

                            try {
                              await Promise.all(notificationInserts);

                              // Send email if enabled
                              const emailPromises = friends.map(
                                async (friend) => {
                                  if (
                                    friend.notification_news_update === "Yes"
                                  ) {
                                    await sendEmailFor_postcommentNotification(
                                      friend.email,
                                      friend.username,
                                      senderUsername
                                    );
                                  }
                                }
                              );

                              await Promise.all(emailPromises);
                            } catch (e) {
                              console.error("Notification or email error:", e);
                            }
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        );
      }
    );
  } catch (error) {
    console.error("GalleryPostSave Error:", error);
    return res.status(500).json({ message: "Internal server error", error });
  }
};

exports.getgallerySearch = async (req, res) => {
  const { user_id, search } = req.body;

  try {
    // Ensure user_id is provided
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Prepare search terms with wildcards for partial matching
    const searchTerm = search ? `%${search}%` : "%"; // If no search term is provided, match all

    // Query to fetch gallery items based on user_id and search terms
    const query = `
      SELECT g.*, u.username, u.profile_type, u.gender,u.birthday_date,u.birthday_date_her,u.location
      FROM gallery g
      JOIN users u ON g.user_id = u.id
      WHERE g.user_id = ?
      AND (g.name LIKE ? OR g.description LIKE ? OR u.username LIKE ?)
      ORDER BY g.id DESC;`;

    // Fetching the gallery items
    db.query(
      query,
      [user_id, searchTerm, searchTerm, searchTerm],
      (err, results) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }

        // Sending the results in the response
        return res.status(200).json({ results });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getAllgallerySearch = async (req, res) => {
  const { user_ids, search } = req.body; // Expecting a string of user IDs

  try {
    // Ensure user_ids is provided
    if (!user_ids) {
      return res.status(400).json({ message: "User IDs are required" });
    }

    // Prepare search term with wildcards for partial matching
    const searchTerm = search ? `%${search}%` : "%"; // Match all if no search term is provided

    // Prepare SQL query to fetch galleries for multiple user IDs
    const query = `
      SELECT g.*, u.username, u.profile_type, u.gender,u.birthday_date_her,u.birthday_date,u.location
      FROM gallery g
      JOIN users u ON g.user_id = u.id
      WHERE g.user_id IN (${user_ids})  -- Use IN clause to filter by multiple user IDs
      AND (g.name LIKE ? OR g.description LIKE ? OR u.username LIKE ?)  -- Search filter
      ORDER BY g.id DESC;
    `;

    // Fetching the galleries
    db.query(query, [searchTerm, searchTerm, searchTerm], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the gallery data in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.searchfilter = async (req, res) => {
  const { user_ids, search } = req.body;

  try {
    // Ensure user_ids is provided and is an array
    if (!user_ids || !Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ message: "Valid user IDs are required" });
    }

    // Prepare the search term (expecting an array or empty)
    const searchTerm = Array.isArray(search) ? search : [];

    // Initialize query parameters
    const queryParams = [user_ids]; // Add user_ids first for "IN (?)"

    // Dynamically build the WHERE clause for gender
    let whereClause = "";

    if (searchTerm.length > 0) {
      whereClause += " AND (";
      searchTerm.forEach((term, index) => {
        whereClause += "u.gender = ?";
        queryParams.push(term); // Add gender terms dynamically to queryParams

        if (index < searchTerm.length - 1) {
          whereClause += " OR ";
        }
      });
      whereClause += ")";
    }

    // Prepare the final SQL query

    const query = `
    SELECT g.*, u.username, u.gender, u.female, u.male, u.couple,u.birthday_date,u.birthday_date_her,u.location
      FROM gallery g
      JOIN users u ON g.user_id = u.id
      WHERE g.user_id IN (?) ${whereClause}
    `;

    // Execute the query
    db.query(query, queryParams, (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Send the results
      return res.status(200).json({ results });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.requestToview = async (req, res) => {
  const { user_id, to_id, albumid } = req.body;

  const wss = req.wss; // Get the WebSocket server instance from the request

  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and to_id are required" });
    }

    // Prepare the current date
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Insert the message along with file URLs into a single database row
    // First, check if the record exists
    db.query(
      "SELECT * FROM userphotoprivate WHERE user_id = ? AND to_id = ? And albumid = ?",
      [user_id, to_id, albumid],
      (selectErr, selectResults) => {
        if (selectErr) {
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
          });
        }
        // If the record exists, return status "2"
        if (selectResults.length > 0) {
          if (selectResults[0].status === "No") {
            return res.status(200).json({
              user_id: user_id,
              to_id: to_id,
              status: "2",
            });
          }
          if (selectResults[0].status === "Yes") {
            return res.status(200).json({
              user_id: user_id,
              to_id: to_id,
              status: "3",
            });
          }
        } else {
          // If no record exists, proceed to insert
          var date = moment
            .tz(new Date(), "Europe/Oslo")
            .format("YYYY-MM-DD HH:mm:ss"); // Ensure you set the date correctly
          db.query(
            "INSERT INTO userphotoprivate (albumid,user_id, to_id, status, date) VALUES (?, ?, ?, ?, ?)",
            [albumid, user_id, to_id, "No", date],
            (insertErr, result) => {
              if (insertErr) {
                return res.status(500).json({
                  message: "Database insert error",
                  error: insertErr,
                  status: "",
                });
              }

              const lastInsertId = result.insertId;

              // Broadcast the message to WebSocket clients
              const broadcastMessage = JSON.stringify({
                event: "Requestview",
                user_id: user_id,
                to_id: to_id,
                lastInsertId: lastInsertId,
              });

              if (wss) {
                wss.clients.forEach((client) => {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(broadcastMessage);
                  }
                });
              }
              const query =
                "SELECT usersalbum.*, albums.name AS album_name FROM usersalbum LEFT JOIN albums ON albums.id = usersalbum.album_id WHERE usersalbum.id = ?;";
              db.query(query, [albumid], (err, results) => {
                if (err) {
                  console.error("Error fetching album name:", err);
                  return;
                }

                if (results.length > 0) {
                  const albumName = results[0].album_name;
                  const querys = "SELECT * FROM users WHERE id = ?";
                  db.query(querys, [user_id], (err, results) => {
                    if (err) {
                      console.error("Error fetching album name:", err);
                      return;
                    }
                    var un = results[0].username;
                    const message = ` has requested permission to view your private album: ${albumName}`;
                    const messagenotification =
                      un +
                      ` has requested permission to view your private album: ${albumName}`;
                    var link_href = "/editprofile/viewrequest";
                    db.query(
                      "INSERT INTO notification (user_id,to_id, message, date,link_href) VALUES (?,?, ?, ?,?)",
                      [to_id, user_id, message, date, link_href],
                      (err, result) => {
                        if (err) {
                          console.error("Error inserting notification:", err);
                        }
                        const querys = "SELECT * FROM users WHERE id = ?";
                        db.query(querys, [to_id], (err, results) => {
                          sendEmailFor_AlbumRequestNotification(
                            results[0].email,
                            results[0].username,
                            messagenotification
                          );
                        });
                      }
                    );
                  });
                } else {
                  console.log("No album found with the given ID.");
                }
              });

              // Return success response
              res.status(200).json({
                user_id: user_id,
                to_id: to_id,
                status: "1",
              });
            }
          );
        }
      }
    );
  } catch (error) {
    console.error("Error:", error); // Log the error for debugging
    return res.status(500).json({ message: "Server error", error });
  }
};
async function sendEmailFor_AlbumRequestNotification(
  to,
  username,
  message,
  callback
) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf", // 🔐 Replace with env vars in production!
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: to,
    subject: `New Private Album Access Request`,
    text: `Hello ${username},\n\n${message}\n\nBest regards,\nThe Amourette Team`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response);
    if (callback) callback(null, info);
  } catch (error) {
    console.error("Error sending email:", error);
    if (callback) callback(error, null);
  }
}

exports.RequestConfirm = async (req, res) => {
  const { req_id, to_id, user_id } = req.body;
  //console.log(req.body);

  const wss = req.wss; // Get the WebSocket server instance from the request

  try {
    // Ensure user_id and to_id are provided
    if (!req_id) {
      return res.status(400).json({ message: "Both Id id required" });
    }

    // Prepare the current date

    db.query(
      "UPDATE userphotoprivate SET status = ? WHERE id = ?",
      ["Yes", req_id],
      (updateErr, result) => {
        if (updateErr) {
          return res.status(500).json({
            message: "Database update error",
            error: updateErr,
          });
        }

        // Check if any rows were affected (i.e., if the update was successful)
        if (result.affectedRows === 0) {
          return res
            .status(404)
            .json({ message: "No record found with this ID." });
        }

        const broadcastMessage = JSON.stringify({
          event: "Requestconfirm",
          to_id: to_id,
          user_id: user_id,
        });

        if (wss) {
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(broadcastMessage);
            }
          });
        }
        const query =
          "SELECT userphotoprivate.*, albums.name AS album_name FROM userphotoprivate LEFT JOIN usersalbum ON userphotoprivate.albumid = usersalbum.id LEFT JOIN albums ON albums.id = usersalbum.album_id WHERE userphotoprivate.id = ?";
        db.query(query, [req_id], (err, results) => {
          if (err) {
            console.error("Error fetching album name:", err);
            return;
          }

          if (results.length > 0) {
            const albumName = results[0].album_name;
            console.log(results);
            const querys = "SELECT * FROM users WHERE id = ?";
            db.query(querys, [user_id], (err, results) => {
              if (err) {
                console.error("Error fetching album name:", err);
                return;
              }
              var un = results[0].username;
              var checkk = results[0];
              const message =
                ` You have accepted ` +
                un +
                ` request to view your private album : ${albumName}`;
              var link_href = "/friend/" + user_id;
              var date = moment
                .tz(new Date(), "Europe/Oslo")
                .format("YYYY-MM-DD HH:mm:ss");
              db.query(
                "INSERT INTO notification (user_id,to_id, message, date,link_href) VALUES (?,?, ?, ?,?)",
                [to_id, user_id, message, date, link_href],
                (err, result) => {
                  if (err) {
                    console.error("Error inserting notification:", err);
                  } else {
                    console.log("Notification inserted successfully");
                  }
                  //if (checkk.notification_news_update === "Yes") {
                  const querys = "SELECT * FROM users WHERE id = ?";
                  db.query(querys, [to_id], (err, results) => {
                    sendEmailFor_AlbumConfirmNotification(
                      results[0].email,
                      results[0].username,
                      message
                    );
                  });
                  // }
                }
              );
            });
          } else {
            console.log("No album found with the given ID.");
          }
        });
        // Return success response
        res.status(200).json({
          message: "Record updated successfully.",
          to_id: to_id,
          user_id: user_id,
        });
      }
    );
  } catch (error) {
    console.error("Error:", error); // Log the error for debugging
    return res.status(500).json({ message: "Server error", error });
  }
};
async function sendEmailFor_AlbumConfirmNotification(
  to,
  username,
  message,
  callback
) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf", // 🔐 Use environment variables in production!
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: to,
    subject: `Private Album Request Accepted`,
    text: `Hello ${username},\n\n${message}\n\nBest regards,\nThe Amourette Team`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response);
    if (callback) callback(null, info);
  } catch (error) {
    console.error("Error sending email:", error);
    if (callback) callback(error, null);
  }
}

exports.Requestdelete = async (req, res) => {
  const { req_id, to_id, user_id } = req.body;
  //console.log(req.body);

  const wss = req.wss; // Get the WebSocket server instance from the request

  try {
    // Ensure user_id and to_id are provided
    if (!req_id) {
      return res.status(400).json({ message: "Both Id id required" });
    }

    // Prepare the current date

    db.query(
      "DELETE FROM userphotoprivate WHERE id = ?",
      [req_id],
      (deleteErr, result) => {
        if (deleteErr) {
          return res.status(500).json({
            message: "Database delete error",
            error: deleteErr,
          });
        }

        // Check if any rows were affected (i.e., if the delete was successful)
        if (result.affectedRows === 0) {
          return res
            .status(404)
            .json({ message: "No record found with this ID." });
        }
        const broadcastMessage = JSON.stringify({
          event: "Requestconfirm",
          to_id: to_id,
          user_id: user_id,
        });

        if (wss) {
          wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(broadcastMessage);
            }
          });
        }
        // Return success response
        res.status(200).json({
          message: "Record deleted successfully.",
          to_id: to_id,
          user_id: user_id,
        });
      }
    );
  } catch (error) {
    console.error("Error:", error); // Log the error for debugging
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.visitprofile = async (req, res) => {
  const { user_id, to_id } = req.body;
  //console.log(req.body);

  const wss = req.wss; // Get the WebSocket server instance from the request

  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and to_id are required" });
    }

    // Prepare the current date
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Insert the message along with file URLs into a single database row
    // First, check if the record exists
    db.query(
      "SELECT * FROM profile_visit WHERE user_id = ? AND to_id = ?",
      [user_id, to_id],
      (selectErr, selectResults) => {
        if (selectErr) {
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
          });
        }

        if (selectResults.length > 0) {
          res.status(200).json({
            message: "",
          });
        } else {
          // If no record exists, proceed to insert
          const date = new Date(); // Ensure you set the date correctly
          db.query(
            "INSERT INTO profile_visit (user_id, to_id, date) VALUES (?, ?, ?)",
            [user_id, to_id, date],
            (insertErr, result) => {
              if (insertErr) {
                return res.status(500).json({
                  message: "Database insert error",
                  error: insertErr,
                  status: "",
                });
              }

              // Return success response
              res.status(200).json({
                user_id: user_id,
                to_id: to_id,
                status: "1",
              });
            }
          );
        }
      }
    );
  } catch (error) {
    console.error("Error:", error); // Log the error for debugging
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.forumscommentSave = async (req, res) => {
  const { user_id, forum_id, description, message, name, slug } = req.body;
  //console.log(req.body);

  const wss = req.wss; // Get the WebSocket server instance from the request

  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !forum_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and forum_id are required" });
    }

    // Prepare the current date
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Prepare data to save into the database
    const data = {
      user_id: user_id,
      forum_id: forum_id,
      description: description, // Insert the message
      date: date,
    };

    // Insert the message along with file URLs into a single database row
    db.query(
      "INSERT INTO forum_comment (user_id, forum_id, description, date) VALUES (?, ?, ?, ?)",
      [data.user_id, data.forum_id, data.description, data.date],
      (insertErr, result) => {
        if (insertErr) {
          // console.error("Database insert error:", insertErr);
          return res.status(500).json({
            message: "Database insert error",
            error: insertErr,
            status: "",
          });
        }
        const lastInsertId = result.insertId;
        db.query(
          `SELECT fc.*, u.profile_image, u.username
            FROM forum_comment fc
            JOIN users u ON fc.user_id = u.id
            WHERE fc.id = ?`,
          [lastInsertId],
          (err, row) => {
            if (err) {
              console.error("Database query error:", err);
              return res.status(500).json({
                message: "Database query error",
                error: err,
                event: "",
              });
            }
            var rr = row[0];
            const broadcastMessage = JSON.stringify({
              event: "ForumComments",
              user_id: user_id,
              forum_id: forum_id,
              makeImagePrivate: rr.makeImagePrivate,
              profile_image: rr.profile_image,
              username: rr.username,
              description: rr.description,
              date: rr.date,
              id: lastInsertId,
            });

            if (wss) {
              wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(broadcastMessage);
                }
              });
            }
            logActivity(user_id, `commented on the forum post `);
            const queryy = `
          SELECT
            u.*,
            CASE
              WHEN fr.status = 'Yes' THEN true
              ELSE false
            END AS is_friend
          FROM
            users u
          JOIN
            friendRequest_accept fr ON
              (u.id = fr.sent_to AND fr.user_id = ?) OR
              (u.id = fr.user_id AND fr.sent_to = ?)
          WHERE
            fr.status = 'Yes';`;

            // Fetching the messages
            db.query(queryy, [user_id, user_id], (err, results) => {
              if (err) {
                return res
                  .status(500)
                  .json({ message: "Database query error", error: err });
              }

              const broadcastMessage = JSON.stringify({
                event: "grouprequest_acceptnotification",
                user_id: results,
                LoginData: results,
              });

              // Broadcast message to WebSocket clients if connected
              if (wss) {
                wss.clients.forEach((client) => {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(broadcastMessage);
                  }
                });
              }

              // Prepare notification message
              db.query(
                `SELECT username, email, notification_group_event FROM users WHERE id = ?`,
                [user_id], // Fetch the username and email of the user who sent the request
                async (err, senderResult) => {
                  if (err) {
                    return res.status(500).json({
                      message: "Error fetching user data for sender",
                      error: err,
                    });
                  }
                  const senderUsername = senderResult[0].username;
                  const notificationMessage =
                    ` commented on the forum post ` + name;
                  const date = moment
                    .tz(new Date(), "Europe/Oslo")
                    .format("YYYY-MM-DD HH:mm:ss");
                  const link_href = "/singleforums/" + slug;

                  // Insert notifications for each user
                  const insertNotificationsPromises = results.map((item) => {
                    return new Promise((resolve, reject) => {
                      db.query(
                        "INSERT INTO notification (user_id, to_id, message, date, link_href) VALUES (?, ?, ?, ?, ?)",
                        [
                          item.id,
                          user_id,
                          notificationMessage,
                          date,
                          link_href,
                        ],
                        (err, result) => {
                          if (err) {
                            console.error("Database insertion error:", err);
                            reject(err);
                          } else {
                            resolve(result);
                          }
                        }
                      );
                    });
                  });
                  try {
                    await Promise.all(insertNotificationsPromises);

                    // Send email notification for each friend if group event setting is "Yes"

                    const emailPromises = results.map(async (item) => {
                      console.log(item.email);
                      if (item.notification_news_update === "Yes") {
                        await sendEmailFor_ForumCommentNotification(
                          name,
                          item.email,
                          item.username,
                          senderUsername
                        );
                      }
                      // Call the email function for each friend
                    });

                    await Promise.all(emailPromises);
                    return res.status(200).json({
                      message: "Successfully created.",
                    });
                  } catch (error) {}

                  // After all notifications are inserted
                }
              );
            });
            // Return success response
            res.status(200).json({
              message: message,
              user_id: user_id,
              status: "1",
            });
          }
        );
        // Broadcast the message to WebSocket clients
      }
    );
  } catch (error) {
    console.error("Error:", error); // Log the error for debugging
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.forumscommentSaveDashboard = async (req, res) => {
  const { user_id, forum_id, description, message } = req.body;
  //console.log(req.body);

  const wss = req.wss; // Get the WebSocket server instance from the request

  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !forum_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and forum_id are required" });
    }

    // Prepare the current date
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Prepare data to save into the database

    const query = "SELECT * FROM forum WHERE id = ?";
    db.query(query, [forum_id], (err, row) => {
      if (err) {
        console.error("Error fetching album name:", err);
        return;
      }
      const data = {
        user_id: user_id,
        forum_id: forum_id,
        description: description, // Insert the message
        date: date,
      };
      const name = row[0].name;
      const slug = row[0].slug;
      // Insert the message along with file URLs into a single database row
      db.query(
        "INSERT INTO forum_comment (user_id, forum_id, description, date) VALUES (?, ?, ?, ?)",
        [data.user_id, data.forum_id, data.description, data.date],
        (insertErr, result) => {
          if (insertErr) {
            // console.error("Database insert error:", insertErr);
            return res.status(500).json({
              message: "Database insert error",
              error: insertErr,
              status: "",
            });
          }
          const lastInsertId = result.insertId;
          db.query(
            `SELECT fc.*, u.profile_image, u.username
            FROM forum_comment fc
            JOIN users u ON fc.user_id = u.id
            WHERE fc.id = ?`,
            [lastInsertId],
            (err, row) => {
              if (err) {
                console.error("Database query error:", err);
                return res.status(500).json({
                  message: "Database query error",
                  error: err,
                  event: "",
                });
              }
              var rr = row[0];
              const broadcastMessage = JSON.stringify({
                event: "ForumComments",
                user_id: user_id,
                forum_id: forum_id,
                makeImagePrivate: rr.makeImagePrivate,
                profile_image: rr.profile_image,
                username: rr.username,
                description: rr.description,
                date: rr.date,
                id: lastInsertId,
              });

              if (wss) {
                wss.clients.forEach((client) => {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(broadcastMessage);
                  }
                });
              }
              logActivity(user_id, `commented on the forum post `);
              const queryy = `
          SELECT
            u.*,
            CASE
              WHEN fr.status = 'Yes' THEN true
              ELSE false
            END AS is_friend
          FROM
            users u
          JOIN
            friendRequest_accept fr ON
              (u.id = fr.sent_to AND fr.user_id = ?) OR
              (u.id = fr.user_id AND fr.sent_to = ?)
          WHERE
            fr.status = 'Yes';`;

              // Fetching the messages
              db.query(queryy, [user_id, user_id], (err, results) => {
                if (err) {
                  return res
                    .status(500)
                    .json({ message: "Database query error", error: err });
                }

                const broadcastMessage = JSON.stringify({
                  event: "grouprequest_acceptnotification",
                  user_id: results,
                  LoginData: results,
                });

                // Broadcast message to WebSocket clients if connected
                if (wss) {
                  wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                      client.send(broadcastMessage);
                    }
                  });
                }

                // Prepare notification message
                db.query(
                  `SELECT username, email, notification_group_event FROM users WHERE id = ?`,
                  [user_id], // Fetch the username and email of the user who sent the request
                  async (err, senderResult) => {
                    if (err) {
                      return res.status(500).json({
                        message: "Error fetching user data for sender",
                        error: err,
                      });
                    }
                    const senderUsername = senderResult[0].username;
                    const notificationMessage =
                      ` commented on the forum post ` + name;
                    const date = moment
                      .tz(new Date(), "Europe/Oslo")
                      .format("YYYY-MM-DD HH:mm:ss");
                    const link_href = "/singleforums/" + slug;

                    // Insert notifications for each user
                    const insertNotificationsPromises = results.map((item) => {
                      return new Promise((resolve, reject) => {
                        db.query(
                          "INSERT INTO notification (user_id, to_id, message, date, link_href) VALUES (?, ?, ?, ?, ?)",
                          [
                            item.id,
                            user_id,
                            notificationMessage,
                            date,
                            link_href,
                          ],
                          (err, result) => {
                            if (err) {
                              console.error("Database insertion error:", err);
                              reject(err);
                            } else {
                              resolve(result);
                            }
                          }
                        );
                      });
                    });
                    try {
                      await Promise.all(insertNotificationsPromises);

                      // Send email notification for each friend if group event setting is "Yes"

                      const emailPromises = results.map(async (item) => {
                        console.log(item.email);
                        if (item.notification_news_update === "Yes") {
                          await sendEmailFor_ForumCommentNotification(
                            name,
                            item.email,
                            item.username,
                            senderUsername
                          );
                        }
                        // Call the email function for each friend
                      });

                      await Promise.all(emailPromises);
                      return res.status(200).json({
                        message: "Successfully created.",
                      });
                    } catch (error) {}

                    // After all notifications are inserted
                  }
                );
              });
              // Return success response
              res.status(200).json({
                message: message,
                user_id: user_id,
                status: "1",
              });
            }
          );
          // Broadcast the message to WebSocket clients
        }
      );
    });
  } catch (error) {
    console.error("Error:", error); // Log the error for debugging
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.speedcommentSave = async (req, res) => {
  const { user_id, speeddate_id, description, message, name, slug } = req.body;
  //console.log(req.body);

  const wss = req.wss; // Get the WebSocket server instance from the request

  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !speeddate_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and speeddate_id are required" });
    }

    // Prepare the current date
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Prepare data to save into the database
    const data = {
      user_id: user_id,
      speeddate_id: speeddate_id,
      description: description, // Insert the message
      date: date,
    };

    // Insert the message along with file URLs into a single database row
    db.query(
      "INSERT INTO speeddate_comment (user_id, speeddate_id, description, date) VALUES (?, ?, ?, ?)",
      [data.user_id, data.speeddate_id, data.description, data.date],
      (insertErr, result) => {
        if (insertErr) {
          // console.error("Database insert error:", insertErr);
          return res.status(500).json({
            message: "Database insert error",
            error: insertErr,
            status: "",
          });
        }
        const lastInsertId = result.insertId;
        db.query(
          `SELECT fc.*, u.profile_image, u.username
            FROM speeddate_comment fc
            JOIN users u ON fc.user_id = u.id
            WHERE fc.id = ?`,
          [lastInsertId],
          (err, row) => {
            if (err) {
              console.error("Database query error:", err);
              return res.status(500).json({
                message: "Database query error",
                error: err,
                event: "",
              });
            }
            var rr = row[0];
            const broadcastMessage = JSON.stringify({
              event: "SpeedComments",
              user_id: user_id,
              speeddate_id: speeddate_id,
              makeImagePrivate: rr.makeImagePrivate,
              profile_image: rr.profile_image,
              username: rr.username,
              description: rr.description,
              date: rr.date,
              id: lastInsertId,
            });

            if (wss) {
              wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(broadcastMessage);
                }
              });
            }
            logActivity(user_id, `commented on the forum post `);
            const queryy = `
          SELECT
            u.*,
            CASE
              WHEN fr.status = 'Yes' THEN true
              ELSE false
            END AS is_friend
          FROM
            users u
          JOIN
            friendRequest_accept fr ON
              (u.id = fr.sent_to AND fr.user_id = ?) OR
              (u.id = fr.user_id AND fr.sent_to = ?)
          WHERE
            fr.status = 'Yes';`;

            // Fetching the messages
            db.query(queryy, [user_id, user_id], (err, results) => {
              if (err) {
                return res
                  .status(500)
                  .json({ message: "Database query error", error: err });
              }

              const broadcastMessage = JSON.stringify({
                event: "grouprequest_acceptnotification",
                user_id: results,
                LoginData: results,
              });

              // Broadcast message to WebSocket clients if connected
              if (wss) {
                wss.clients.forEach((client) => {
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(broadcastMessage);
                  }
                });
              }

              // Prepare notification message
              db.query(
                `SELECT username, email, notification_group_event FROM users WHERE id = ?`,
                [user_id], // Fetch the username and email of the user who sent the request
                async (err, senderResult) => {
                  if (err) {
                    return res.status(500).json({
                      message: "Error fetching user data for sender",
                      error: err,
                    });
                  }
                  const senderUsername = senderResult[0].username;
                  const notificationMessage =
                    ` commented on the date post ` + name;
                  const date = moment
                    .tz(new Date(), "Europe/Oslo")
                    .format("YYYY-MM-DD HH:mm:ss");
                  const link_href = "/singledate/" + slug;

                  // Insert notifications for each user
                  const insertNotificationsPromises = results.map((item) => {
                    return new Promise((resolve, reject) => {
                      db.query(
                        "INSERT INTO notification (user_id, to_id, message, date, link_href) VALUES (?, ?, ?, ?, ?)",
                        [
                          item.id,
                          user_id,
                          notificationMessage,
                          date,
                          link_href,
                        ],
                        (err, result) => {
                          if (err) {
                            console.error("Database insertion error:", err);
                            reject(err);
                          } else {
                            resolve(result);
                          }
                        }
                      );
                    });
                  });
                  try {
                    await Promise.all(insertNotificationsPromises);

                    // Send email notification for each friend if group event setting is "Yes"

                    const emailPromises = results.map(async (item) => {
                      console.log(item.email);
                      if (item.notification_news_update === "Yes") {
                        await sendEmailFor_SpeedDateCommentNotification(
                          name,
                          item.email,
                          item.username,
                          senderUsername
                        );
                      }
                      // Call the email function for each friend
                    });

                    await Promise.all(emailPromises);
                    return res.status(200).json({
                      message: "Successfully created.",
                    });
                  } catch (error) {}

                  // After all notifications are inserted
                }
              );
            });
            // Return success response
            res.status(200).json({
              message: message,
              user_id: user_id,
              status: "1",
            });
          }
        );
        // Broadcast the message to WebSocket clients
      }
    );
  } catch (error) {
    console.error("Error:", error); // Log the error for debugging
    return res.status(500).json({ message: "Server error", error });
  }
};
async function sendEmailFor_SpeedDateCommentNotification(
  gname,
  too,
  name,
  byname,
  callback
) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf", // Use environment variables for sensitive data
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: too,
    subject: `New Comment on speed date Post: "${gname}" by ${byname}`, // More descriptive subject
    text: `Hello,\n\n${byname} has commented on the speed date post in the "${gname}" on Amourette.\n\nComment: "${name}"\n\nVisit the speed date to view the discussion.\n\nBest regards,\nThe Amourette Team`, // Improved email body
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response);
    if (callback) callback(null, info);
  } catch (error) {
    console.error("Error sending email:", error);
    if (callback) callback(error, null);
  }
}
async function sendEmailFor_ForumCommentNotification(
  gname,
  too,
  name,
  byname,
  callback
) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf", // Use environment variables for sensitive data
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: too,
    subject: `New Comment on Forum Post: "${gname}" by ${byname}`, // More descriptive subject
    text: `Hello,\n\n${byname} has commented on the forum post in the "${gname}" on Amourette.\n\nComment: "${name}"\n\nVisit the forum to view the discussion.\n\nBest regards,\nThe Amourette Team`, // Improved email body
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response);
    if (callback) callback(null, info);
  } catch (error) {
    console.error("Error sending email:", error);
    if (callback) callback(error, null);
  }
}

exports.getdashboardpost = async (req, res) => {
  const { user_ids, user_id, offset = 0 } = req.body;

  try {
    if (!user_ids || !user_id) {
      return res
        .status(400)
        .json({ message: "User IDs and User ID are required" });
    }

    const userIdsArray = Array.isArray(user_ids)
      ? user_ids
      : user_ids.split(",").map((id) => id.trim());

    const placeholders = userIdsArray.map(() => "?").join(",");

    const query = `
(
  SELECT 
    g.id,
    g.file AS image,
    g.user_id,
    u.profile_image AS uimage,
    u.username,
    'group' AS pertype,
    g.description,
    NULL AS title,
    g.date,
    COUNT(gpf.id) AS total_favourites,
    CASE
    WHEN EXISTS (
      SELECT 1 
      FROM group_post_favourite gpf2 
      WHERE gpf2.post_id = g.id AND gpf2.user_id = ${user_id}
    ) THEN 1
    ELSE 0
  END AS user_favourited
  FROM group_post g
  JOIN users u ON g.user_id = u.id
  LEFT JOIN group_post_favourite gpf ON g.id = gpf.post_id
  LEFT JOIN groups_invite gi 
    ON g.group_id = gi.group_id 
    AND gi.accept = 'Yes' 
    AND gi.sent_id = ?
  JOIN \`groups\` gr ON g.group_id = gr.id

  WHERE 
    (g.user_id = ? OR gi.id IS NOT NULL)
    AND (
      gr.makeImageUse != 1 OR 
      (gr.makeImageUse = 1 AND (gr.user_id = ${user_id} OR gi.sent_id = ${user_id}))
    )
  GROUP BY 
    g.id, g.file, g.user_id, u.profile_image, u.username, g.description, g.date
)
UNION ALL
(
  SELECT 
    f.id,
    f.image,
    f.user_id,
    u.profile_image AS uimage,
    u.username,
    'forum' AS pertype,
    f.description,
    f.name AS title,
    f.date,
    COUNT(fpf.id) AS total_favourites,
    CASE
          WHEN EXISTS (
            SELECT 1 FROM form_post_favourite fpf2 WHERE fpf2.post_id = f.id AND fpf2.user_id = ${user_id}
          ) THEN 1
          ELSE 0
        END AS user_favourited
  FROM forum f
  JOIN users u ON f.user_id = u.id
  LEFT JOIN form_post_favourite fpf ON f.id = fpf.post_id
  WHERE f.user_id IN (${placeholders})
  GROUP BY f.id, f.image, f.user_id, u.profile_image, u.username, f.description, f.name, f.date
)
UNION ALL
(
  SELECT 
    gl.id,
    gl.image,
    gl.user_id,
    u.profile_image AS uimage,
    u.username,
    'gallery' AS pertype,
    gl.description,
    NULL AS title,
    gl.date,
    COUNT(gf.id) AS total_favourites,
    CASE
    WHEN EXISTS (
      SELECT 1 
      FROM gallery_favourite gf2 
      WHERE gf2.gallery_id = gl.id 
        AND gf2.user_id = ${user_id}
    ) THEN 1
    ELSE 0
  END AS user_favourited
  FROM gallery gl
  JOIN users u ON gl.user_id = u.id
  LEFT JOIN gallery_favourite gf ON gl.id = gf.gallery_id
  WHERE gl.user_id IN (${placeholders})
  GROUP BY gl.id, gl.image, gl.user_id, u.profile_image, u.username, gl.description, gl.date
)
ORDER BY date DESC
LIMIT 10 OFFSET ?;
`;

    const queryParams = [
      user_id, // for gi.sent_id = ?
      user_id, // for g.user_id = ?
      ...userIdsArray, // for forum IN (?,?,...)
      ...userIdsArray, // for gallery IN (?,?,...)
      parseInt(offset), // for OFFSET
    ];

    db.query(query, queryParams, (err, results) => {
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

exports.getGallerlikedislike = async (req, res) => {
  const { id, user_id, type } = req.body;

  try {
    if (type === "forum") {
      const query = `SELECT 
                    f.id,
                    f.image,
                    f.user_id,
                    u.profile_image AS uimage,
                    u.username,
                    'forum' AS pertype,
                    f.description,
                    f.name AS title,
                    f.date,
                    COUNT(fpf.id) AS total_favourites,
                    CASE
                    WHEN EXISTS (
                      SELECT 1 FROM form_post_favourite fpf2 WHERE fpf2.post_id = f.id
                    ) THEN 1
                    ELSE 0
                  END AS user_favourited
                  FROM forum f
                  JOIN users u ON f.user_id = u.id
                  LEFT JOIN form_post_favourite fpf ON f.id = fpf.post_id
                  WHERE f.id = ${id}
                  GROUP BY f.id, f.image, f.user_id, u.profile_image, u.username, f.description, f.date`;
      db.query(query, (err, results) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }

        return res.status(200).json({ results });
      });
    }
    if (type === "group") {
      const query = `SELECT 
        g.id,
        g.file AS image,
        g.user_id,
        u.profile_image AS uimage,
        u.username,
        'group' AS pertype,
        g.description,
        NULL AS title,
        g.date,
        COUNT(gpf.id) AS total_favourites,
        CASE
    WHEN EXISTS (
      SELECT 1 
      FROM group_post_favourite gpf2 
      WHERE gpf2.post_id = g.id AND gpf2.user_id = ${user_id}
    ) THEN 1
    ELSE 0
  END AS user_favourited
      FROM group_post g
      JOIN users u ON g.user_id = u.id
      LEFT JOIN group_post_favourite gpf ON g.id = gpf.post_id
      WHERE g.id = ${id}
      GROUP BY g.id, g.file, g.user_id, u.profile_image, u.username, g.description, g.date`;
      db.query(query, (err, results) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }

        return res.status(200).json({ results });
      });
    }
    if (type === "gallery") {
      const query = `SELECT 
        gl.id,
        gl.image,
        gl.user_id,
        u.profile_image AS uimage,
        u.username,
        'gallery' AS pertype,
        gl.description,
        NULL AS title,
        gl.date,
        COUNT(gf.id) AS total_favourites,
        CASE
            WHEN EXISTS (
              SELECT 1 FROM gallery_favourite gf2 WHERE gf2.gallery_id = gl.id
            ) THEN 1
            ELSE 0
          END AS user_favourited
      FROM gallery gl
      JOIN users u ON gl.user_id = u.id
      LEFT JOIN gallery_favourite gf ON gl.id = gf.gallery_id
      WHERE gl.id = ${id}
      GROUP BY gl.id, gl.image, gl.user_id, u.profile_image, u.username, gl.description, gl.date`;
      db.query(query, (err, results) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }

        return res.status(200).json({ results });
      });
    }
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getGallerforumgroupcomment = async (req, res) => {
  const { id, type } = req.body;

  try {
    if (type === "forum") {
      const query = `SELECT 
                    f.id,
                    f.description,
                    f.user_id,
                    u.profile_image AS uimage,
                    u.username,
                    'forum' AS pertype,
                    f.date
                  FROM forum_comment f
                  JOIN users u ON f.user_id = u.id
                  WHERE f.forum_id = ${id}
                  order by f.id desc`;
      db.query(query, (err, results) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }

        return res.status(200).json({ results });
      });
    }
    if (type === "group") {
      const query = `SELECT 
        g.id,
        g.user_id,
        u.profile_image AS uimage,
        u.username,
        'group' AS pertype,
        g.description,
        NULL AS title,
        g.date
      FROM group_post_comment g
      JOIN users u ON g.user_id = u.id
      WHERE g.group_post_id = ${id} order by g.id desc`;
      db.query(query, (err, results) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }

        return res.status(200).json({ results });
      });
    }
    if (type === "gallery") {
      const query = `SELECT 
        gl.id,
        gl.user_id,
        u.profile_image AS uimage,
        u.username,
        'gallery' AS pertype,
        gl.description,
        NULL AS title,
        gl.date
      FROM gallery_comment gl
      JOIN users u ON gl.user_id = u.id
      WHERE gl.gallery_id = ${id}
      order by gl.id desc`;
      db.query(query, (err, results) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }

        return res.status(200).json({ results });
      });
    }
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getdashboardpostSearch = async (req, res) => {
  const { user_ids, user_id, search } = req.body; // Expecting an array or string of user IDs
  try {
    // Ensure user_ids is provided
    if (!user_ids) {
      return res.status(400).json({ message: "User IDs are required" });
    }

    // Prepare search term with wildcards for partial matching
    const searchTerm = search ? `%${search}%` : "%"; // Match all if no search term is provided

    // Prepare SQL query to fetch galleries for multiple user IDs
    const query = `
      SELECT g.*, u.username, u.makeImagePrivate, u.profile_type, u.gender, u.profile_image as uimage
    FROM gallery g
      JOIN users u ON g.user_id = u.id
      WHERE g.user_id IN (${user_ids})  -- Use IN clause to filter by multiple user IDs
      AND (g.name LIKE ? OR g.description LIKE ? OR u.username LIKE ?)  -- Search filter
      ORDER BY g.id DESC;
    `;

    // Fetching the galleries
    db.query(query, [searchTerm, searchTerm, searchTerm], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the gallery data in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.messageseen = async (req, res) => {
  const { to_id, user_id } = req.body; // Expecting message ID and user ID
  const wss = req.wss; // Get the WebSocket server instance from the request
  console.log(req.body, "up");
  try {
    // Ensure both ID and User ID are provided
    if (!user_id) {
      return res.status(400).json({ message: "ID and User ID are required" });
    }

    // First, check if the message with the provided ID exists and if the to_id matches the user_id
    db.query(
      "SELECT * FROM chatmessages WHERE user_id = ? AND to_id = ? ORDER BY id desc",
      [to_id, user_id],
      (selectErr, selectResults) => {
        if (selectErr) {
          console.error("Database select error:", selectErr); // Log select query error
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
            status: "2",
          });
        }

        // Check if the message exists
        if (selectResults.length === 0) {
          return res.status(404).json({
            message: "Message not found or incorrect user ID",
            status: "2",
          });
        }
        var idd = selectResults[0].id;
        // Message exists, proceed with the update
        db.query(
          "UPDATE chatmessages SET `read` = 'Yes' WHERE id = ? AND to_id = ?",
          [idd, user_id],
          (updateErr) => {
            if (updateErr) {
              console.error("Database update error:", updateErr); // Log update query error
              return res.status(500).json({
                message: "Database update error",
                error: updateErr,
                status: "2",
              });
            }
            const broadcastMessage = JSON.stringify({
              event: "MessageseenScroll",
              user_id: user_id,
              to_id: to_id,
            });

            if (wss) {
              wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(broadcastMessage);
                }
              });
            }
            return res.status(200).json({ status: "1" });
          }
        );
      }
    );
  } catch (error) {
    console.error("Server error:", error); // Log server-side errors
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.messageseenall = async (req, res) => {
  const { to_id, user_id } = req.body; // Expecting message ID and user ID
  const wss = req.wss; // Get the WebSocket server instance from the request
  console.log(req.body, "seen");
  try {
    // Ensure both ID and User ID are provided
    if (!user_id) {
      return res.status(400).json({ message: "ID and User ID are required" });
    }

    // First, check if the message with the provided ID exists and if the to_id matches the user_id
    db.query(
      `SELECT * FROM chatmessages WHERE user_id = ? AND to_id = ? AND \`read\`= 'No'`,
      [to_id, user_id],
      (selectErr, selectResults) => {
        if (selectErr) {
          console.error("Database select error:", selectErr);
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
            status: "2",
          });
        }

        if (selectResults.length === 0) {
          return res.status(200).json({
            message: "No unread messages found",
            status: "2",
          });
        }

        // Extract all message IDs
        const messageIds = selectResults.map((msg) => msg.id);
        console.log(messageIds);
        // Update all messages at once
        db.query(
          "UPDATE chatmessages SET `read` = 'Yes' WHERE id IN (?) AND to_id = ?",
          [messageIds, user_id],
          (updateErr) => {
            if (updateErr) {
              console.error("Database update error:", updateErr);
              return res.status(500).json({
                message: "Database update error",
                error: updateErr,
                status: "2",
              });
            }

            // Broadcast message update
            const broadcastMessage = JSON.stringify({
              event: "MessageseenScroll",
              user_id: user_id,
              to_id: to_id,
            });

            if (wss) {
              wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(broadcastMessage);
                }
              });
            }

            return res.status(200).json({ status: "1" });
          }
        );
      }
    );
  } catch (error) {
    console.error("Server error:", error); // Log server-side errors
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.membersearch = async (req, res) => {
  const { user_id, search } = req.body;
  let lookinfor = req.body.looking_forr; // ये हमेशा sexual_orientation filter है

  try {
    // Step 1: Get the current user from the database
    const searchTerm = `${search || ""}`;
    const userQuery = `
      SELECT u.*, m.plan AS membership_plan 
      FROM users u 
      LEFT JOIN membership m ON m.user_id = u.id 
      WHERE u.id = ?
    `;
    db.query(userQuery, [user_id], (err, userResults) => {
      if (err || userResults.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      const currentUser = userResults[0];

      // Step 2: Parse user's sexual_orientation safely
      let orientations = [];
      try {
        orientations = Array.isArray(currentUser.sexual_orientation)
          ? currentUser.sexual_orientation
          : JSON.parse(currentUser.sexual_orientation || "[]");
      } catch (e) {
        console.warn("Orientation parse error", e);
      }

      // Normalize gender
      const gender = (currentUser.gender || "").toLowerCase();

      // Step 3: Who You Like
      const likedGenders = new Set();
      if (orientations.includes("Heterosexual")) {
        if (gender.includes("male")) likedGenders.add("Male");
        else if (gender.includes("female")) likedGenders.add("Male");
        else if (gender.includes("mtf")) likedGenders.add("Female");
        else if (gender.includes("ftm")) likedGenders.add("Male");
      }
      if (orientations.includes("Homosexual")) {
        if (gender.includes("male")) likedGenders.add("Male");
        if (gender.includes("female")) likedGenders.add("Female");
        if (gender.includes("mtf")) likedGenders.add("Trans (MTF)");
        if (gender.includes("ftm")) likedGenders.add("Trans (FTM)");
        if (gender.includes("non-binary")) likedGenders.add("Non-binary");
      }
      if (
        orientations.includes("Bisexual") ||
        orientations.includes("Pansexual")
      ) {
        likedGenders.add("Male");
        likedGenders.add("Female");
        likedGenders.add("Trans");
        likedGenders.add("Trans (MTF)");
        likedGenders.add("Trans (FTM)");
        likedGenders.add("Non-binary");
        likedGenders.add("Couple");
      }
      const likedGenderArray = [...likedGenders];

      // Step 4: Who Likes You (preferences keywords)
      const prefKeywords = [];
      if (gender === "male") {
        prefKeywords.push("%male%", "%man%", "%boy%", "%guy%");
      } else if (gender === "female") {
        prefKeywords.push("%female%", "%woman%", "%girl%", "%lady%");
      } else if (gender === "trans (mtf)") {
        prefKeywords.push("%trans%", "%mtf%", "%trans woman%", "%trans (mtf)%");
      } else if (gender === "trans (ftm)") {
        prefKeywords.push("%trans%", "%ftm%", "%trans man%", "%trans (ftm)%");
      } else if (gender === "trans") {
        prefKeywords.push("%trans%");
      } else if (gender === "non-binary") {
        prefKeywords.push("%non-binary%", "%nb%", "%enby%");
      } else if (gender === "couple") {
        prefKeywords.push("%couple%");
      }

      // Step 5: Search conditions (common for both cases)
      let conditions = `
        (LOWER(u.email) LIKE LOWER(?) OR
        LOWER(u.location) LIKE LOWER(?) OR
        LOWER(u.town) LIKE LOWER(?) OR
        LOWER(u.birthday_date) LIKE LOWER(?) OR
        LOWER(u.username) LIKE LOWER(?) OR
        LOWER(u.nationality) LIKE LOWER(?) OR
        LOWER(u.relationship_status) LIKE LOWER(?) OR
        LOWER(u.degree) LIKE LOWER(?) OR
        LOWER(u.drinker) LIKE LOWER(?) OR
        LOWER(u.smoker) LIKE LOWER(?) OR
        LOWER(u.tattos) LIKE LOWER(?) OR
        LOWER(u.body_piercings) LIKE LOWER(?) OR
        LOWER(u.fetish) LIKE LOWER(?) OR
        LOWER(u.connectwith) LIKE LOWER(?))
      `;
      const paramss = Array(14).fill(`%${searchTerm.toLowerCase()}%`);

      // If sexual_orientation filter is applied from frontend
      if (lookinfor && Array.isArray(lookinfor) && lookinfor.length > 0) {
        const jsonSearchConditions = lookinfor
          .map(() => `JSON_SEARCH(u.sexual_orientation, 'one', ?) IS NOT NULL`)
          .join(" OR ");
        conditions += ` AND (${jsonSearchConditions})`;
        paramss.push(...lookinfor);
      }

      // Case 1: user has likedGenders
      if (likedGenderArray.length > 0) {
        const genderPlaceholders = likedGenderArray.map(() => "?").join(", ");
        const keywordPlaceholders = prefKeywords
          .map(() => "LOWER(u.looking_for) LIKE ?")
          .join(" OR ");

        const sql = `
          SELECT u.*, m.plan AS membership_plan
          FROM users u
          LEFT JOIN membership m ON m.user_id = u.id
          WHERE (
            u.gender IN (${genderPlaceholders})
            AND (u.looking_for IS NULL OR u.looking_for='' OR ${keywordPlaceholders})
            AND ${conditions}
          )
          
        `;
        const params = [...likedGenderArray, ...prefKeywords, ...paramss];
        db.query(sql, params, (err, results) => {
          if (err) {
            console.error("SQL error:", err);
            return res.status(500).json({ message: "Server error" });
          }
          res.status(200).json({ success: true, results });
        });
      } else {
        // Case 2: no likedGenders (just use preferences + conditions)
        const keywordPlaceholders = prefKeywords
          .map(() => "LOWER(u.looking_for) LIKE ?")
          .join(" OR ");

        const sql = `
          SELECT u.*, m.plan AS membership_plan
          FROM users u
          LEFT JOIN membership m ON m.user_id = u.id
          WHERE 
            (u.looking_for IS NULL OR u.looking_for='' OR ${keywordPlaceholders})
            AND ${conditions}
        `;
        const params = [...prefKeywords, ...paramss];
        db.query(sql, params, (err, results) => {
          if (err) {
            console.error("SQL error:", err);
            return res.status(500).json({ message: "Server error" });
          }
          res.status(200).json({ success: true, results });
        });
      }
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.membersearchleftsidebar = async (req, res) => {
  const { search } = req.body;

  try {
    // Prepare search term with wildcard for SQL LIKE
    const searchTerm = `%${search || ""}%`;

    let conditions = [
      `(LOWER(u.email) LIKE LOWER(?) OR
        LOWER(u.location) LIKE LOWER(?) OR
        LOWER(u.town) LIKE LOWER(?) OR
        LOWER(u.birthday_date) LIKE LOWER(?) OR
        LOWER(u.looking_for) LIKE LOWER(?) OR
        LOWER(u.username) LIKE LOWER(?) OR
        LOWER(u.nationality) LIKE LOWER(?) OR
        LOWER(u.relationship_status) LIKE LOWER(?) OR
        LOWER(u.search_looking_for) LIKE LOWER(?) OR
        LOWER(u.degree) LIKE LOWER(?) OR
        LOWER(u.drinker) LIKE LOWER(?) OR
        LOWER(u.smoker) LIKE LOWER(?) OR
        LOWER(u.tattos) LIKE LOWER(?) OR
        LOWER(u.body_piercings) LIKE LOWER(?) OR
        LOWER(u.fetish) LIKE LOWER(?) OR
        LOWER(u.connectwith) LIKE LOWER(?) OR
        LOWER(u.interstedin) LIKE LOWER(?) OR
        LOWER(u.male) LIKE LOWER(?) OR
        LOWER(u.couple) LIKE LOWER(?) OR
        LOWER(u.female) LIKE LOWER(?))`,
    ];

    let params = Array(20).fill(searchTerm);

    // Handle filtering by `sexual_orientation`

    // Final SQL query
    const query = `
      SELECT
        u.*,
        m.user_id AS membership_user_id,
        m.plan AS membership_plan,
        m.days AS membership_days
      FROM users u
      LEFT JOIN membership m ON u.id = m.user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY u.id DESC`;

    // Execute the SQL query
    db.query(query, params, (err, row) => {
      if (err) {
        return res.status(500).json({ message: "Database error", error: err });
      }
      return res.status(200).json({ results: row });
    });
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

exports.areafilter = async (req, res) => {
  var user_id = req.body.user_id;
  var fromage = req.body.fromage;
  var toage = req.body.toage;
  var startDate = `${fromage}-12-31`; // Convert to "2002-01-01"
  var endDate = `${toage}-01-01`;
  var selectedSubRegion = req.body.selectedSubRegion || [];
  var selectedTowns = req.body.selectedTowns || [];
  var lookinfor = req.body.looking_forr || [];

  if (!Array.isArray(lookinfor)) {
    lookinfor = []; // Ensure it's an array
  }
  try {
    // Step 1: Get the current user from the database
    var location = req.body.location || [];
    const sexual_orientation = req.body.sexual_orientation;
    if (
      sexual_orientation.length === 0 &&
      selectedTowns.length === 0 &&
      location.length === 0
    ) {
      const userQuery = `SELECT users.*, membership.plan AS membership_plan FROM users LEFT JOIN membership ON membership.user_id = users.id WHERE users.id = ?`;
      db.query(userQuery, [user_id], (err, userResults) => {
        if (err || userResults.length === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        const currentUser = userResults[0];

        // Step 2: Parse user's sexual_orientation safely
        let orientations = [];
        try {
          orientations = Array.isArray(currentUser.sexual_orientation)
            ? currentUser.sexual_orientation
            : JSON.parse(currentUser.sexual_orientation || "[]");
        } catch (e) {
          console.warn("Orientation parse error", e);
        }

        const gender = (currentUser.gender || "").toLowerCase();

        // Step 3: Who you like
        const likedGenders = new Set();
        if (orientations.includes("Heterosexual")) {
          if (gender.includes("male")) likedGenders.add("Female");
          else if (gender.includes("female")) likedGenders.add("Male");
          else if (gender.includes("mtf")) likedGenders.add("Female");
          else if (gender.includes("ftm")) likedGenders.add("Male");
        }
        if (orientations.includes("Homosexual")) {
          if (gender.includes("male")) likedGenders.add("Male");
          if (gender.includes("female")) likedGenders.add("Female");
          if (gender.includes("mtf")) likedGenders.add("Trans (MTF)");
          if (gender.includes("ftm")) likedGenders.add("Trans (FTM)");
          if (gender.includes("non-binary")) likedGenders.add("Non-binary");
        }
        if (
          orientations.includes("Bisexual") ||
          orientations.includes("Pansexual")
        ) {
          likedGenders.add("Male");
          likedGenders.add("Female");
          likedGenders.add("Trans");
          likedGenders.add("Trans (MTF)");
          likedGenders.add("Trans (FTM)");
          likedGenders.add("Non-binary");
          likedGenders.add("Couple");
        }

        const likedGenderArray = [...likedGenders];

        // Step 4: Who likes you
        const prefKeywords = [];
        if (gender === "male") {
          prefKeywords.push("%male%", "%man 4d43b0d8a3b3c3b8c7b7b8e4");
          prefKeywords.push("%male%", "%man%", "%boy%", "%guy%");
        } else if (gender === "female") {
          prefKeywords.push("%female%", "%woman%", "%girl%", "%lady%");
        } else if (gender === "trans (mtf)") {
          prefKeywords.push(
            "%trans%",
            "%mtf%",
            "%trans woman%",
            "%trans (mtf)%"
          );
        } else if (gender === "trans (ftm)") {
          prefKeywords.push("%trans%", "%ftm%", "%trans man%", "%trans (ftm)%");
        } else if (gender === "trans") {
          prefKeywords.push("%trans%");
        } else if (gender === "non-binary") {
          prefKeywords.push("%non-binary%", "%nb%", "%enby%");
        } else if (gender === "couple") {
          prefKeywords.push("%couple%");
        }

        const params = [];
        let conditions = [];

        // Gender filter
        if (likedGenderArray.length > 0) {
          const genderPlaceholders = likedGenderArray.map(() => "?").join(", ");
          conditions.push(`u.gender IN (${genderPlaceholders})`);
          params.push(...likedGenderArray);
        }

        // looking_for filter
        if (prefKeywords.length > 0) {
          const keywordPlaceholders = prefKeywords
            .map(() => "LOWER(u.looking_for) LIKE ?")
            .join(" OR ");
          conditions.push(
            `(u.looking_for IS NULL OR u.looking_for = '' OR ${keywordPlaceholders})`
          );
          params.push(...prefKeywords);
        } else {
          conditions.push(`(u.looking_for IS NULL OR u.looking_for = '')`);
        }

        // Date range and user ID condition
        conditions.push(`u.birthday_date BETWEEN ? AND ?`);
        params.push(endDate, startDate);

        // Additional condition for `lookinfor` (sexual_orientation)
        if (lookinfor.length > 0) {
          const lookinforConditions = lookinfor
            .map(
              () => `JSON_SEARCH(u.sexual_orientation, 'one', ?) IS NOT NULL`
            )
            .join(" OR ");
          conditions.push(`(${lookinforConditions})`);
          params.push(...lookinfor);
        }

        // Construct final query
        let sql = `
  SELECT u.*, m.plan AS membership_plan
  FROM users u
  LEFT JOIN membership m ON m.user_id = u.id
`;

        if (conditions.length > 0) {
          sql += ` WHERE ${conditions.join(" AND ")}`;
        }

        // Final query execution
        db.query(sql, params, (err, results) => {
          if (err) {
            console.error("SQL error:", err);
            return res.status(500).json({ message: "Server error" });
          }

          res.status(200).json({ success: true, results });
        });
      });
    } else {
      const userQuery = `SELECT users.*, membership.plan AS membership_plan FROM users LEFT JOIN membership ON membership.user_id = users.id WHERE users.id = ?`;
      db.query(userQuery, [user_id], (err, userResults) => {
        if (err || userResults.length === 0) {
          return res.status(404).json({ message: "User not found" });
        }

        const currentUser = userResults[0];

        // Step 2: Parse user's sexual_orientation safely
        let orientations = [];
        try {
          orientations = Array.isArray(currentUser.sexual_orientation)
            ? currentUser.sexual_orientation
            : JSON.parse(currentUser.sexual_orientation || "[]");
        } catch (e) {
          console.warn("Orientation parse error", e);
        }

        // Normalize gender to lowercase for comparison
        const gender = (currentUser.gender || "").toLowerCase();

        // Step 3: Determine which genders the user likes ("Who You Like")
        const likedGenders = new Set();
        if (orientations.includes("Heterosexual")) {
          if (gender.includes("male")) likedGenders.add("Female");
          else if (gender.includes("female")) likedGenders.add("Male");
          else if (gender.includes("mtf")) likedGenders.add("Female");
          else if (gender.includes("ftm")) likedGenders.add("Male");
        }

        if (orientations.includes("Homosexual")) {
          if (gender.includes("male")) likedGenders.add("Male");
          if (gender.includes("female")) likedGenders.add("Female");
          if (gender.includes("mtf")) likedGenders.add("Trans (MTF)");
          if (gender.includes("ftm")) likedGenders.add("Trans (FTM)");
          if (gender.includes("non-binary")) likedGenders.add("Non-binary");
        }

        if (
          orientations.includes("Bisexual") ||
          orientations.includes("Pansexual")
        ) {
          likedGenders.add("Male");
          likedGenders.add("Female");
          likedGenders.add("Trans");
          likedGenders.add("Trans (MTF)");
          likedGenders.add("Trans (FTM)");
          likedGenders.add("Non-binary");
          likedGenders.add("Couple");
        }

        const likedGenderArray = [...likedGenders]; // Convert set to array
        console.log(likedGenderArray);
        if (likedGenderArray.length > 0) {
          // Step 4: Build keywords based on the current user's gender
          // This represents "Who Likes You"
          const prefKeywords = [];

          if (gender === "male") {
            prefKeywords.push("%male%", "%man%", "%boy%", "%guy%");
          } else if (gender === "female") {
            prefKeywords.push("%female%", "%woman%", "%girl%", "%lady%");
          } else if (gender === "trans (mtf)") {
            prefKeywords.push(
              "%trans%",
              "%mtf%",
              "%trans woman%",
              "%trans (mtf)%"
            );
          } else if (gender === "trans (ftm)") {
            prefKeywords.push(
              "%trans%",
              "%ftm%",
              "%trans man%",
              "%trans (ftm)%"
            );
          } else if (gender === "trans") {
            prefKeywords.push("%trans%");
          } else if (gender === "non-binary") {
            prefKeywords.push("%non-binary%", "%nb%", "%enby%");
          } else if (gender === "couple") {
            prefKeywords.push("%couple%");
          }

          // Step 5: Construct SQL query to match both:
          // 1. Users whose gender matches who you like
          // 2. Users whose looking_for include someone like you
          const genderPlaceholders = likedGenderArray.map(() => "?").join(", ");
          const keywordPlaceholders = prefKeywords
            .map(() => "LOWER(looking_for) LIKE ?")
            .join(" OR ");

          // Create conditions for the other fields (email, location, etc.)
          let conditions = [];
          let dynamicParams = [];
          // Handle filtering by `sexual_orientation` if provided in `lookinfor`
          if (lookinfor && Array.isArray(lookinfor) && lookinfor.length > 0) {
            const jsonSearchConditions = lookinfor
              .map(
                () => `JSON_SEARCH(u.sexual_orientation, 'one', ?) IS NOT NULL`
              )
              .join(" OR ");

            conditions += ` AND (${jsonSearchConditions})`; // Append the sexual orientation conditions
          }

          // Age filter
          if (fromage && toage) {
            conditions.push(`u.birthday_date BETWEEN ? AND ?`);
            dynamicParams.push(endDate, startDate);
          }

          // Location filter
          if (location && location.length > 0) {
            const locationConditions = location
              .map(() => `u.location LIKE ?`)
              .join(" OR ");
            conditions.push(`(${locationConditions})`);
            dynamicParams.push(...location.map((loc) => `%${loc}%`));
          }

          // Subregion filter
          if (selectedSubRegion && selectedSubRegion.length > 0) {
            const subRegionConditions = selectedSubRegion
              .map(() => `u.subregion LIKE ?`)
              .join(" OR ");
            conditions.push(`(${subRegionConditions})`);
            dynamicParams.push(...selectedSubRegion.map((sub) => `%${sub}%`));
          }

          // Town filter
          if (selectedTowns && selectedTowns.length > 0) {
            const townConditions = selectedTowns
              .map(() => `JSON_SEARCH(u.town, 'one', ?) IS NOT NULL`)
              .join(" OR ");
            conditions.push(`(${townConditions})`);
            dynamicParams.push(...selectedTowns);
          }

          // Sexual Orientation & Lookinfor filter
          const allValues = [
            ...(sexual_orientation || []),
            ...(lookinfor || []),
          ];
          if (allValues.length > 0) {
            const orientationConditions = allValues
              .map(
                () =>
                  `u.sexual_orientation LIKE ? OR JSON_SEARCH(u.sexual_orientation, 'one', ?) IS NOT NULL`
              )
              .join(" OR ");
            conditions.push(`(${orientationConditions})`);
            dynamicParams.push(...allValues.flatMap((v) => [`%${v}%`, v]));
          }

          // Final SQL query
          let baseSQL = `
  SELECT u.*, m.plan AS membership_plan FROM users u LEFT JOIN membership m ON m.user_id = u.id WHERE u.gender IN (${genderPlaceholders}) AND ( u.looking_for IS NULL OR u.looking_for = '' OR ${keywordPlaceholders} )
`;

          // Append dynamic filters
          if (conditions.length > 0) {
            baseSQL += ` AND ${conditions.join(" AND ")}`;
          }

          // Merge params
          const finalParams = [
            ...likedGenderArray,
            ...prefKeywords,
            ...dynamicParams,
          ];

          db.query(baseSQL, finalParams, (err, results) => {
            if (err) {
              console.error("SQL error:", err);
              return res.status(500).json({ message: "Server error" });
            }

            res.status(200).json({ success: true, results: results });
          });
        } else {
          // Step 4: Build keywords based on the current user's gender
          // This represents "Who Likes You"
          const prefKeywords = [];

          if (gender === "male") {
            prefKeywords.push("%male%", "%man%", "%boy%", "%guy%");
          } else if (gender === "female") {
            prefKeywords.push("%female%", "%woman%", "%girl%", "%lady%");
          } else if (gender === "trans (mtf)") {
            prefKeywords.push(
              "%trans%",
              "%mtf%",
              "%trans woman%",
              "%trans (mtf)%"
            );
          } else if (gender === "trans (ftm)") {
            prefKeywords.push(
              "%trans%",
              "%ftm%",
              "%trans man%",
              "%trans (ftm)%"
            );
          } else if (gender === "trans") {
            prefKeywords.push("%trans%");
          } else if (gender === "non-binary") {
            prefKeywords.push("%non-binary%", "%nb%", "%enby%");
          } else if (gender === "couple") {
            prefKeywords.push("%couple%");
          }

          // Step 5: Construct SQL query to match both:
          // 1. Users whose gender matches who you like
          // 2. Users whose looking_for include someone like you
          const genderPlaceholders = likedGenderArray.map(() => "?").join(", ");
          const keywordPlaceholders = prefKeywords
            .map(() => "LOWER(looking_for) LIKE ?")
            .join(" OR ");

          // Create conditions for the other fields (email, location, etc.)
          let conditions = [];
          let dynamicParams = [];
          // Handle filtering by `sexual_orientation` if provided in `lookinfor`
          if (lookinfor && Array.isArray(lookinfor) && lookinfor.length > 0) {
            const jsonSearchConditions = lookinfor
              .map(
                () => `JSON_SEARCH(u.sexual_orientation, 'one', ?) IS NOT NULL`
              )
              .join(" OR ");

            conditions += ` AND (${jsonSearchConditions})`; // Append the sexual orientation conditions
          }

          // Age filter
          if (fromage && toage) {
            conditions.push(`u.birthday_date BETWEEN ? AND ?`);
            dynamicParams.push(endDate, startDate);
          }

          // Location filter
          if (location && location.length > 0) {
            const locationConditions = location
              .map(() => `u.location LIKE ?`)
              .join(" OR ");
            conditions.push(`(${locationConditions})`);
            dynamicParams.push(...location.map((loc) => `%${loc}%`));
          }

          // Subregion filter
          if (selectedSubRegion && selectedSubRegion.length > 0) {
            const subRegionConditions = selectedSubRegion
              .map(() => `u.subregion LIKE ?`)
              .join(" OR ");
            conditions.push(`(${subRegionConditions})`);
            dynamicParams.push(...selectedSubRegion.map((sub) => `%${sub}%`));
          }

          // Town filter
          if (selectedTowns && selectedTowns.length > 0) {
            const townConditions = selectedTowns
              .map(() => `JSON_SEARCH(u.town, 'one', ?) IS NOT NULL`)
              .join(" OR ");
            conditions.push(`(${townConditions})`);
            dynamicParams.push(...selectedTowns);
          }

          // Sexual Orientation & Lookinfor filter
          const allValues = [
            ...(sexual_orientation || []),
            ...(lookinfor || []),
          ];
          if (allValues.length > 0) {
            const orientationConditions = allValues
              .map(
                () =>
                  `u.sexual_orientation LIKE ? OR JSON_SEARCH(u.sexual_orientation, 'one', ?) IS NOT NULL`
              )
              .join(" OR ");
            conditions.push(`(${orientationConditions})`);
            dynamicParams.push(...allValues.flatMap((v) => [`%${v}%`, v]));
          }

          // Final SQL query
          let baseSQL = `
  SELECT u.*, m.plan AS membership_plan
  FROM users u
  LEFT JOIN membership m ON m.user_id = u.id
  WHERE (u.looking_for IS NULL OR u.looking_for = '' OR ${keywordPlaceholders})
`;

          // Append dynamic filters
          if (conditions.length > 0) {
            baseSQL += ` AND ${conditions.join(" AND ")}`;
          }

          // Merge params
          const finalParams = [
            ...likedGenderArray,
            ...prefKeywords,
            ...dynamicParams,
          ];

          db.query(baseSQL, finalParams, (err, results) => {
            if (err) {
              console.error("SQL error:", err);
              return res.status(500).json({ message: "Server error" });
            }

            res.status(200).json({ success: true, results: results });
          });
        }
      });
    }
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

exports.agefilter = async (req, res) => {
  var user_id = req.body.user_id;

  var fromage = req.body.fromage;
  var toage = req.body.toage;
  //console.log(req.body);
  var startDate = `${fromage}-12-31`; // Convert to "2002-01-01"
  var endDate = `${toage}-01-01`;

  try {
    const userQuery = `SELECT * FROM users WHERE id = ?`;
    db.query(userQuery, [user_id], (err, userResults) => {
      if (err || userResults.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      const currentUser = userResults[0];

      // Step 2: Parse user's sexual_orientation safely
      let orientations = [];
      try {
        orientations = Array.isArray(currentUser.sexual_orientation)
          ? currentUser.sexual_orientation
          : JSON.parse(currentUser.sexual_orientation || "[]");
      } catch (e) {
        console.warn("Orientation parse error", e);
      }

      // Normalize gender to lowercase for comparison
      const gender = (currentUser.gender || "").toLowerCase();

      // Step 3: Determine which genders the user likes ("Who You Like")
      const likedGenders = new Set();
      if (orientations.includes("Heterosexual")) {
        if (gender.includes("male")) likedGenders.add("Female");
        else if (gender.includes("female")) likedGenders.add("Male");
        else if (gender.includes("mtf")) likedGenders.add("Female");
        else if (gender.includes("ftm")) likedGenders.add("Male");
      }

      if (orientations.includes("Homosexual")) {
        if (gender.includes("male")) likedGenders.add("Male");
        if (gender.includes("female")) likedGenders.add("Female");
        if (gender.includes("mtf")) likedGenders.add("Trans (MTF)");
        if (gender.includes("ftm")) likedGenders.add("Trans (FTM)");
        if (gender.includes("non-binary")) likedGenders.add("Non-binary");
      }

      if (
        orientations.includes("Bisexual") ||
        orientations.includes("Pansexual")
      ) {
        likedGenders.add("Male");
        likedGenders.add("Female");
        likedGenders.add("Trans");
        likedGenders.add("Trans (MTF)");
        likedGenders.add("Trans (FTM)");
        likedGenders.add("Non-binary");
        likedGenders.add("Couple");
      }

      const likedGenderArray = [...likedGenders]; // Convert set to array

      // Step 4: Build keywords based on the current user's gender
      // This represents "Who Likes You"
      const prefKeywords = [];

      if (gender === "male") {
        prefKeywords.push("%male%", "%man%", "%boy%", "%guy%");
      } else if (gender === "female") {
        prefKeywords.push("%female%", "%woman%", "%girl%", "%lady%");
      } else if (gender === "trans (mtf)") {
        prefKeywords.push("%trans%", "%mtf%", "%trans woman%", "%trans (mtf)%");
      } else if (gender === "trans (ftm)") {
        prefKeywords.push("%trans%", "%ftm%", "%trans man%", "%trans (ftm)%");
      } else if (gender === "trans") {
        prefKeywords.push("%trans%");
      } else if (gender === "non-binary") {
        prefKeywords.push("%non-binary%", "%nb%", "%enby%");
      } else if (gender === "couple") {
        prefKeywords.push("%couple%");
      }

      // Step 5: Construct SQL query to match both:
      // 1. Users whose gender matches who you like
      // 2. Users whose preferences include someone like you
      const genderPlaceholders = likedGenderArray.map(() => "?").join(", ");
      const keywordPlaceholders = prefKeywords
        .map(() => "LOWER(preferences) LIKE ?")
        .join(" OR ");

      // Create conditions for the other fields (email, location, etc.)

      // Handle filtering by `sexual_orientation` if provided in `lookinfor`
      if (lookinfor && Array.isArray(lookinfor) && lookinfor.length > 0) {
        const jsonSearchConditions = lookinfor
          .map(() => `JSON_SEARCH(u.sexual_orientation, 'one', ?) IS NOT NULL`)
          .join(" OR ");

        conditions += ` AND (${jsonSearchConditions})`; // Append the sexual orientation conditions
      }

      // Final SQL query
      const sql = `
          SELECT * FROM users u
          WHERE gender IN (${genderPlaceholders})
            AND (preferences IS NULL OR preferences = '' OR ${keywordPlaceholders})
            birthday_date BETWEEN ? AND ?
        `;

      // Combine the parameters
      const params = [...likedGenderArray, ...prefKeywords, endDate, startDate];
      console.log(params);
      console.log(sql);
      // Execute the query
      db.query(sql, params, (err, results) => {
        if (err) {
          console.error("SQL error:", err);
          return res.status(500).json({ message: "Server error" });
        }
        res.status(200).json({ success: true, results: results });
      });
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};
exports.sexfilter = async (req, res) => {
  var sexual_orientation = [];
  if (req.body.sexual_orientation) {
    // Check if it's already an array
    if (Array.isArray(req.body.sexual_orientation)) {
      var sexual_orientation = req.body.sexual_orientation;
    } else {
      // Split a comma-separated string into an array
      var sexual_orientation = req.body.sexual_orientation.split(",");
    }
  }

  try {
    // Initialize conditions and parameters
    const user_id = req.body.user_id;
    const birthday = req.body.age;
    const location = req.body.location;
    let conditions = [];
    let params = [user_id, user_id]; // Start with user_id for exclusions and joins

    if (location.length === 0 && sexual_orientation.length === 0) {
      // Default query without additional filters
      const query = `
                SELECT
                    u.*,
                    CASE
                        WHEN fr.status = 'Yes' THEN true
                        ELSE false
                    END AS is_friend,
                    fr.status AS friend_status
                FROM
                    users u
                LEFT JOIN
                    friendRequest_accept fr
                ON
                    (u.id = fr.sent_to AND fr.user_id = ?)
                    OR (u.id = fr.user_id AND fr.sent_to = ?);
            `;
      db.query(query, [user_id, user_id], (err, row) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database error", error: err });
        }
        return res.status(200).json({ results: row });
      });
    } else {
      // Build dynamic conditions based on the provided filters

      // Build location condition
      if (Array.isArray(sexual_orientation) && sexual_orientation.length > 0) {
        const sexualOrientationConditions = sexual_orientation
          .map((so) => `u.sexual_orientation LIKE ?`)
          .join(" OR ");
        conditions.push(`(${sexualOrientationConditions})`);
        params.push(...sexual_orientation.map((so) => `%${so}%`));
      }

      if (Array.isArray(location) && location.length > 0) {
        const locationConditions = location
          .map((loc) => `u.location LIKE ?`)
          .join(" OR ");
        conditions.push(`(${locationConditions})`);
        params.push(...location.map((loc) => `%${loc}%`));
      }

      // Build birthday condition

      const escapeLike = (str) => str.replace(/[%_]/g, "\\$&");

      if (birthday) {
        const birthdayCondition = `u.birthday_date LIKE ?`;
        conditions.push(birthdayCondition);
        params.push(`%${escapeLike(birthday)}%`);
      }

      // Combine all conditions into the WHERE clause
      const whereClause =
        conditions.length > 0 ? `(${conditions.join(" AND ")})` : "";

      const query = `
                    SELECT
                        u.*,
                        CASE
                            WHEN fr.status = 'Yes' THEN true
                            ELSE false
                        END AS is_friend,
                        fr.status AS friend_status
                    FROM
                        users u
                    LEFT JOIN
                        friendRequest_accept fr
                    ON
                        (u.id = fr.sent_to AND fr.user_id = ?)
                        OR (u.id = fr.user_id AND fr.sent_to = ?)
                    WHERE
                        ${whereClause};
                `;

      db.query(query, params, (err, row) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database error", error: err });
        }
        return res.status(200).json({ results: row });
      });
    }
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

exports.checkmembership = async (req, res) => {
  const { user_id } = req.body; // Expecting an array or string of user IDs

  try {
    // Ensure user_ids and user_id are provided
    if (!user_id) {
      return res.status(400).json({ message: " User ID are required" });
    }

    const query = `
      SELECT membership.*, users.status
      FROM membership
      JOIN users ON users.id = membership.user_id
      WHERE membership.user_id = ?
      ;
    `;

    db.query(query, user_id, (err, row) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }
      var isExpired = true;
      if (row.length > 0) {
        const currentDate = moment
          .tz(new Date(), "Europe/Oslo")
          .format("YYYY-MM-DD");
        // Get the end_date from the row (assuming it's in a valid date format)
        const endDate = moment(row[0].end_date)
          .tz("Europe/Oslo")
          .format("YYYY-MM-DD");

        // Check if the current date is after the end_date
        var isExpired = moment(currentDate).isAfter(endDate);

        return res.status(200).json({ status: isExpired, result: row });
      } else {
        return res.status(200).json({ status: isExpired, result: row });
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.userblock = async (req, res) => {
  const { user_id, sent_id } = req.body; // Expecting an array or string of user IDs

  try {
    // Ensure user_ids and user_id are provided
    if (!user_id) {
      return res.status(400).json({ message: " User ID are required" });
    }

    const query = `
    INSERT INTO blockuser (user_id, to_id)
    VALUES (?, ?)
  `;

    // Assuming you're using a query function from a database library
    db.query(query, [user_id, sent_id]);

    return res.status(200).json({ message: "User successfully blocked" });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getcheckuserblock = async (req, res) => {
  const { user_id, to_id } = req.body; // Expecting user_id and to_id from the request body

  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and to_id are required" });
    }

    const query = `
      SELECT * FROM blockuser WHERE user_id = ? AND to_id = ?
    `;

    // Pass both user_id and to_id as an array to the query function
    db.query(query, [to_id, user_id], (err, row) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // If a block relationship exists, return the data
      return res.status(200).json({ message: "User is blocked", result: row });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getcheckuserblockend = async (req, res) => {
  const { user_id, to_id } = req.body; // Expecting user_id and to_id from the request body

  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and to_id are required" });
    }

    const query = `
      SELECT * FROM blockuser WHERE user_id = ? AND to_id = ?
    `;

    // Pass both user_id and to_id as an array to the query function
    db.query(query, [user_id, to_id], (err, row) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // If a block relationship exists, return the data
      return res.status(200).json({ message: "User is blocked", result: row });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.userunblock = async (req, res) => {
  const { user_id, to_id } = req.body; // Expecting user_id and to_id from the request body

  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and to_id are required" });
    }

    // Step 1: Check if a block relationship exists
    const queryCheckBlock = `
      SELECT * FROM blockuser WHERE user_id = ? AND to_id = ?
    `;

    // Pass both user_id and to_id as an array to the query function
    db.query(queryCheckBlock, [user_id, to_id], (err, rows) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // If no block exists, return a message saying so
      if (rows.length === 0) {
        return res.status(404).json({ message: "No block relationship found" });
      }

      // Step 2: If a block relationship exists, proceed to delete the record
      const queryDeleteBlock = `
        DELETE FROM blockuser WHERE user_id = ? AND to_id = ?
      `;

      db.query(queryDeleteBlock, [user_id, to_id], (err, result) => {
        if (err) {
          return res.status(500).json({
            message: "Failed to unblock user",
            error: err,
          });
        }
        logActivity(user_id, `Un block user with ID: ${to_id}`);
        // If deletion is successful, return a success message
        return res.status(200).json({ message: "User successfully unblocked" });
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.checkuserblock = async (req, res) => {
  const { user_id, to_id } = req.body; // Expecting user_id and to_id from the request body

  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "Both user_id and to_id are required" });
    }

    const query = `
      SELECT * FROM blockuser WHERE user_id = ? AND to_id = ? or user_id =? And to_id=?
    `;

    // Pass both user_id and to_id as an array to the query function
    db.query(query, [user_id, to_id, to_id, user_id], (err, row) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // If a block relationship exists, return the data
      return res.status(200).json({ message: "User is blocked", result: row });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.create_customer = async (req, res) => {
  try {
    const { email, name } = req.body;

    const customer = await stripe.customers.create({
      email,
      name,
    });

    res.json({ customer_id: customer.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
// exports.create_payment_intent = async (req, res) => {
//   console.log(req.body);
//   try {
//     const { amount, customerId } = req.body;

//     const paymentIntent = await stripe.paymentIntents.create({
//       amount,
//       currency: "usd",
//       payment_method_types: ["card"],
//     });
//     return res.status(200).json({ clientSecret: paymentIntent.client_secret });
//     res.send({ clientSecret: paymentIntent.client_secret });
//   } catch (error) {
//     return res.status(200).json({ error: error.message, clientSecret: "" });
//   }
// };
exports.create_payment_intent = async (req, res) => {
  try {
    const { customerId, productId } = req.body;

    // Step 1: Retrieve the customer's active subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "active", // Only look for active subscriptions
      limit: 1, // Only need one active subscription to update
    });

    // Step 2: Check if there's an active subscription
    if (subscriptions.data.length > 0) {
      // The user already has an active subscription, so update it
      const existingSubscription = subscriptions.data[0];

      // Fetch the new price associated with the selected product
      const prices = await stripe.prices.list({ product: productId });
      if (!prices.data.length) {
        return res
          .status(400)
          .json({ error: "No subscription price found for the product" });
      }
      const newPriceId = prices.data[0].id; // New subscription price ID

      // Step 3: Update the subscription with the new plan
      const updatedSubscription = await stripe.subscriptions.update(
        existingSubscription.id,
        {
          items: [
            {
              id: existingSubscription.items.data[0].id, // The subscription item ID to replace
              price: newPriceId, // The new price ID
            },
          ],
          proration_behavior: "create_prorations", // Handles prorating the charges for the switch
          expand: ["latest_invoice.payment_intent"], // Get payment intent details
        }
      );

      return res.status(200).json({
        subscriptionId: updatedSubscription.id,
        clientSecret:
          updatedSubscription.latest_invoice.payment_intent.client_secret,
      });
    } else {
      // The user does not have an active subscription, so create a new one

      // Fetch the price associated with the product
      const prices = await stripe.prices.list({ product: productId });
      if (!prices.data.length) {
        return res
          .status(400)
          .json({ error: "No subscription price found for the product" });
      }

      const priceId = prices.data[0].id; // Subscription price ID

      // Step 4: Create a new subscription
      const subscription = await stripe.subscriptions.create({
        customer: customerId,
        items: [{ price: priceId }],
        payment_behavior: "default_incomplete", // Allows front-end confirmation
        expand: ["latest_invoice.payment_intent"], // Get payment intent details
      });

      return res.status(200).json({
        subscriptionId: subscription.id,
        clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      });
    }
  } catch (error) {
    console.error(error);
    return res.status(500).json({ error: error.message });
  }
};
exports.galleryfilter = async (req, res) => {
  const { user_id, search } = req.body;

  try {
    // Ensure user_id is provided
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Prepare search term with wildcards for partial matching (search term can be for name, description, or username)
    const searchTerm = search ? `%${search}%` : "%"; // If no search term is provided, match all

    // Prepare gender filter condition and query parameters
    let genderCondition = "";
    const queryParams = [user_id]; // Params for search fields

    // Gender-based filtering for different fields (male, female, couple)
    if (search === "male") {
      genderCondition = "AND u.male != 1"; // Filter by male field
    } else if (search === "female") {
      genderCondition = "AND u.female = 1"; // Filter by female field
    } else if (search === "couple") {
      genderCondition = "AND u.couple = 1"; // Filter by couple field
    }

    // Query to fetch gallery items based on user_id, search terms, and optional gender filter
    const query = `
            SELECT g.*, u.username, u.profile_type, u.gender,u.birthday_date,u.birthday_date_her,u.location
            FROM gallery g
            JOIN users u ON g.user_id = u.id
            WHERE g.user_id = ?
            ${genderCondition}
            ORDER BY g.id DESC;
        `;

    // Fetching the gallery items
    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the results in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getonlineuser = async (req, res) => {
  const { user_ids, user_id } = req.body; // Expecting user IDs array and current user ID
  const wss = req.wss; // Get the WebSocket server instance from the request
  try {
    // Validate input
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return res
        .status(200)
        .json({ message: "Invalid user_ids. It must be a non-empty array." });
    }
    if (!user_id) {
      return res
        .status(200)
        .json({ message: "Missing user_id in request body." });
    }

    // Define the query
    const query = `
          SELECT * FROM users
          WHERE id IN (?)
          AND online_user = ?
          AND id != ?
        `;

    // Execute the query
    db.query(query, [user_ids, "Online", user_id], (err, results) => {
      if (err) {
        console.error("Database query error:", err); // Log the error
        return res.status(500).json({
          message: "Database query error",
          error: err.message || err,
        });
      }

      // Prepare the WebSocket broadcast message
      const broadcastMessage = JSON.stringify({
        event: "otherusercheckonline",
        users: results,
      });

      // Broadcast to all connected WebSocket clients
      if (wss && wss.clients) {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMessage);
          }
        });
      }

      // Respond with results
      return res.status(200).json({ results });
    });
  } catch (error) {
    console.error("Server error:", error); // Log the error
    return res
      .status(500)
      .json({ message: "Server error", error: error.message || error });
  }
};
exports.useractivity = async (req, res) => {
  const { user_id } = req.body; // User ID from the request body
  const wss = req.wss; // WebSocket server instance
  try {
    // Update the logged-in user's `last_activity` to the current time
    const updateLastActivityQuery = `
        UPDATE users
        SET last_activity = NOW(), online_user = 'Online'
        WHERE id = ?;
      `;

    db.query(updateLastActivityQuery, [user_id], (updateErr) => {
      if (updateErr) {
        console.error("Error updating user activity:", updateErr);
        return res
          .status(500)
          .json({ message: "Database error", error: updateErr });
      }

      // Check for inactive users who are still marked as 'Online'
      const findInactiveUsersQuery = `
        SELECT id
        FROM users
        WHERE last_activity < NOW() - INTERVAL 20 SECOND AND online_user = 'Online' AND id != ?;
        `;

      db.query(findInactiveUsersQuery, [user_id], (err, results) => {
        if (err) {
          console.error("Error detecting offline users:", err);
          return res
            .status(500)
            .json({ message: "Database error", error: err });
        }

        if (results.length === 0) {
          // No other users went inactive
          return res
            .status(200)
            .json({ message: "Activity updated. No users became inactive." });
        }

        const inactiveUserIds = results.map((user) => user.id);

        // Update inactive users to 'Offline'
        const updateOfflineQuery = `
            UPDATE users
            SET online_user = 'Offline'
            WHERE id IN (?);
          `;

        db.query(updateOfflineQuery, [inactiveUserIds], (offlineErr) => {
          if (offlineErr) {
            console.error("Error updating offline users:", offlineErr);
            return res
              .status(500)
              .json({ message: "Database error", error: offlineErr });
          }

          // Broadcast the offline status to all WebSocket clients
          const broadcastMessage = JSON.stringify({
            event: "Offline",
            users: inactiveUserIds,
          });

          if (wss && wss.clients) {
            wss.clients.forEach((client) => {
              if (client.readyState === WebSocket.OPEN) {
                client.send(broadcastMessage);
              }
            });
          }

          return res.status(200).json({
            message: "Activity updated.",
            offlineUsers: inactiveUserIds,
          });
        });
      });
    });
  } catch (error) {
    console.error("Server error:", error);
    return res
      .status(500)
      .json({ message: "Server error", error: error.message || error });
  }
};

exports.paymentdatasave = async (req, res) => {
  const { detail, user_id, paymentdetail, customerId, productId } = req.body;

  try {
    // Data validation
    if (!detail || !user_id || !paymentdetail) {
      return res.status(400).json({ message: "Missing required data" });
    }

    const dayss = paymentdetail.days;
    const start_date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");
    const end_date = moment
      .tz(new Date(), "Europe/Oslo")
      .add(dayss, "days")
      .format("YYYY-MM-DD HH:mm:ss");
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // First query: Insert into allmembership
    const insertQuery = `
        INSERT INTO allmembership (product_id,customerId,user_id, start_date, end_date, days, plan, amount, payment_id, currency, livemode, PaymentrefundDispute_status, date,PaymentrefundDispute_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
      `;

    await new Promise((resolve, reject) => {
      db.query(
        insertQuery,
        [
          productId,
          customerId,
          user_id,
          start_date,
          end_date,
          dayss,
          paymentdetail.plan,
          paymentdetail.amount,
          detail.id,
          paymentdetail.currency,
          detail.livemode,
          "History",
          date,
          date,
        ],
        (err, result) => {
          if (err) {
            console.error("Database insertion error:", err); // Log the error to the console
            return reject({ message: "Database insertion error", error: err });
          }
          resolve(result); // Resolve the promise if insertion is successful
        }
      );
    });

    const checkUserExistsQuery = `
    SELECT * FROM membership WHERE user_id = ?;
  `;

    const insertQueryy = `
    INSERT INTO membership
      (product_id,customerId, start_date, end_date, days, plan, amount, payment_id, currency, livemode, PaymentrefundDispute_status, date, user_id)
    VALUES (?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `;

    const updateQuery = `
    UPDATE membership
    SET
      product_id =?,
      customerId = ?,
      start_date = ?,
      end_date = ?,
      days = ?,
      plan = ?,
      amount = ?,
      payment_id = ?,
      currency = ?,
      livemode = ?,
      PaymentrefundDispute_status = ?,
      date = ?
    WHERE user_id = ?;
  `;

    await new Promise((resolve, reject) => {
      // First, check if user exists
      db.query(checkUserExistsQuery, [user_id], async (err, result) => {
        if (err) {
          console.error("Database check error:", err);
          return reject({ message: "Database check error", error: err });
        }

        if (result.length > 0) {
          // User exists, update the record
          db.query(
            updateQuery,
            [
              productId,
              customerId,
              start_date,
              end_date,
              dayss,
              paymentdetail.plan,
              paymentdetail.amount,
              detail.id,
              paymentdetail.currency,
              detail.livemode,
              "History",
              date,
              user_id,
            ],
            (err, result) => {
              if (err) {
                console.error("Database update error:", err);
                return reject({ message: "Database update error", error: err });
              }
              resolve(result); // Resolve if update is successful
            }
          );
        } else {
          // User does not exist, insert a new record
          db.query(
            insertQueryy,
            [
              productId,
              customerId,
              start_date,
              end_date,
              dayss,
              paymentdetail.plan,
              paymentdetail.amount,
              detail.id,
              paymentdetail.currency,
              detail.livemode,
              "History",
              date,
              user_id,
            ],
            (err, result) => {
              if (err) {
                console.error("Database insert error:", err);
                return reject({ message: "Database insert error", error: err });
              }
              resolve(result); // Resolve if insert is successful
            }
          );
        }
      });
    });

    // If both queries succeed, send the response
    res
      .status(200)
      .json({ message: "Membership data saved and updated successfully" });
  } catch (error) {
    console.error("Server error:", error); // Log the error to the console
    res
      .status(500)
      .json({ message: "Server error", error: error.message || error });
  }
};

exports.getallgallerySearchfilter = async (req, res) => {
  const { user_id, search } = req.body;

  try {
    // Ensure user_id is provided
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Prepare search terms with wildcards for partial matching
    const searchTerm = Array.isArray(search) ? search : [];
    let whereClause = "";

    // Dynamically build the WHERE clause for search terms
    if (searchTerm.length > 0) {
      whereClause += " AND (";
      searchTerm.forEach((term, index) => {
        whereClause += "u.gender = ?"; // Adjust this condition as needed for your actual column
        if (index < searchTerm.length - 1) {
          whereClause += " OR ";
        }
      });
      whereClause += ")";
    }

    // Query to fetch gallery items based on user_id and search terms
    const query = `
            SELECT g.*, u.username, u.profile_type, u.gender,u.birthday_date,u.birthday_date_her,u.location
            FROM gallery g
            JOIN users u ON g.user_id = u.id
            WHERE g.user_id = ?
            ${whereClause}
            ORDER BY g.id DESC;
        `;

    // Parameters for query, combining user_id and search terms
    const queryParams = [user_id, ...searchTerm];

    // Fetching the gallery items
    db.query(query, queryParams, (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the results in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.statusupdateUser = async (req, res) => {
  const { user_id, status } = req.body;
  const wss = req.wss;
  try {
    // Data validation
    const s = status === true ? "Yes" : "No"; // Simplified the conditional assignment

    // Second query: Update the membership table
    const updateQuery = `
          UPDATE users
          SET
            online_user_active = ?
          WHERE id = ?;
        `;

    await new Promise((resolve, reject) => {
      db.query(updateQuery, [s, user_id], (err, result) => {
        if (err) {
          console.error("Database update error:", err); // Log the error to the console
          return reject({ message: "Database update error", error: err });
        }
        resolve(result); // Resolve the promise if update is successful
      });
    });
    const broadcastMessage = JSON.stringify({
      event: "memberpageRefresh",
    });

    if (wss && wss.clients) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMessage);
        }
      });
    }
    // If both queries succeed, send the response
    res.status(200).json({ message: "Status updated successfully" });
  } catch (error) {
    console.error("Server error:", error); // Log the error to the console
    res
      .status(500)
      .json({ message: "Server error", error: error.message || error });
  }
};

exports.saveprivateAlbums = async (req, res) => {
  try {
    const { visibility, albumName, rightsConfirmed, addToAlbum, user_id } =
      req.body;
    var password = req.body.password.trim();

    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    // Get uploaded image/video URLs from S3
    const uploadedFiles = req.files.map((file) => file.location); // S3 URLs

    // Prepare the current date in Oslo timezone
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Check if user wants to add to an album
    if (addToAlbum === "Yes") {
      // **Check if the user already has 6 albums**
      const checkQuery = `SELECT COUNT(*) AS albumCount FROM albums WHERE user_id = ?`;

      db.query(checkQuery, [user_id], (err, result) => {
        if (err) {
          console.error("Database Query Error:", err);
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        // **If user has 6 or more albums, stop execution**
        if (result[0].albumCount >= 6) {
          return res
            .status(200)
            .json({ message: "Album limit reached (max 6)." });
        }

        // **Insert new album into 'albums' table first**
        const insertAlbumQuery = `
          INSERT INTO albums (user_id, name, visibility)
          VALUES (?, ?, ?)
        `;

        db.query(
          insertAlbumQuery,
          [user_id, albumName, visibility],
          (err, albumResult) => {
            if (err) {
              console.error("Error inserting into albums table:", err);
              return res.status(500).json({
                message: "Error inserting into albums table",
                error: err,
              });
            }

            // **Use the newly created album's ID**
            const album_id = albumResult.insertId;
            if (password !== "") {
              var pass = password;
              var pstatus = "Yes";
            } else {
              var pass = "";
              var pstatus = "No";
            }
            // **Now insert into 'usersalbum' table**
            const insertUserAlbumQuery = `
            INSERT INTO usersalbum (password_status,password,images, visibility, rightsConfirmed, addToAlbum, user_id, album_id, date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

            db.query(
              insertUserAlbumQuery,
              [
                pstatus,
                pass,
                JSON.stringify(uploadedFiles),
                visibility,
                rightsConfirmed,
                addToAlbum,
                user_id,
                album_id, // Foreign key reference to albums table
                date,
              ],
              (err, userAlbumResult) => {
                if (err) {
                  console.error("Database Insertion Error:", err);
                  return res
                    .status(500)
                    .json({ message: "Database insertion error", error: err });
                }
                var in_id = userAlbumResult.insertId;
                var converphoto = req.files[0].location;
                const insertQuery = `
          INSERT INTO coverphoto (usersalbum_id, user_id, image_url) VALUES (?, ?, ?);
        `;

                db.query(
                  insertQuery,
                  [in_id, user_id, converphoto],
                  (err, insertResult) => {
                    if (err) {
                      console.error("Insert error:", err);
                      return res
                        .status(500)
                        .json({ message: "Insert failed", error: err });
                    }
                  }
                );
                // Respond with success
                res.status(200).json({
                  message: "Album uploaded successfully",
                  files: uploadedFiles,
                  album_id: album_id, // Return album ID in response
                });
              }
            );
          }
        );
      });
    } else {
      // If `addToAlbum` is not "Yes", only insert into usersalbum
      const insertUserAlbumQuery = `
        INSERT INTO usersalbum (images, visibility, rightsConfirmed, addToAlbum, user_id, date)
        VALUES (?, ?, ?, ?, ?, ?)
      `;

      db.query(
        insertUserAlbumQuery,
        [
          JSON.stringify(uploadedFiles),
          visibility,
          rightsConfirmed,
          addToAlbum,
          user_id,
          date,
        ],
        (err, userAlbumResult) => {
          if (err) {
            console.error("Database Insertion Error:", err);
            return res
              .status(500)
              .json({ message: "Database insertion error", error: err });
          }

          // Respond with success
          res.status(200).json({
            message: "Album uploaded successfully",
            files: uploadedFiles,
          });
        }
      );
    }
  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ message: "Server error", error: err });
  }
};
exports.saveprivateAlbumGallery = async (req, res) => {
  try {
    const { visibility, albumName, rightsConfirmed, addToAlbum, user_id } =
      req.body;
    var password = req.body.password.trim();

    // Check if files were uploaded
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ message: "No files uploaded" });
    }

    // Get uploaded image/video URLs from S3
    const uploadedFiles = req.files.map((file) => file.location); // S3 URLs
    console.log(uploadedFiles);
    // Prepare the current date in Oslo timezone
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Check if user wants to add to an album
    if (addToAlbum === "Yes") {
      // **Check if the user already has 6 albums**
      const checkQuery = `SELECT COUNT(*) AS albumCount FROM albums WHERE user_id = ?`;

      db.query(checkQuery, [user_id], (err, result) => {
        if (err) {
          console.error("Database Query Error:", err);
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        // **If user has 6 or more albums, stop execution**
        if (result[0].albumCount >= 6) {
          return res
            .status(200)
            .json({ message: "Album limit reached (max 6)." });
        }

        // **Insert new album into 'albums' table first**
        const insertAlbumQuery = `
          INSERT INTO albums (user_id, name, visibility)
          VALUES (?, ?, ?)
        `;

        db.query(
          insertAlbumQuery,
          [user_id, albumName, visibility],
          (err, albumResult) => {
            if (err) {
              console.error("Error inserting into albums table:", err);
              return res.status(500).json({
                message: "Error inserting into albums table",
                error: err,
              });
            }

            // **Use the newly created album's ID**
            const album_id = albumResult.insertId;
            if (password !== "") {
              var pass = password;
              var pstatus = "Yes";
            } else {
              var pass = "";
              var pstatus = "No";
            }
            // **Now insert into 'usersalbum' table**
            const insertUserAlbumQuery = `
            INSERT INTO usersalbum (password_status,password,images, visibility, rightsConfirmed, addToAlbum, user_id, album_id, date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `;

            db.query(
              insertUserAlbumQuery,
              [
                pstatus,
                pass,
                JSON.stringify(uploadedFiles),
                visibility,
                rightsConfirmed,
                addToAlbum,
                user_id,
                album_id, // Foreign key reference to albums table
                date,
              ],
              (err, userAlbumResult) => {
                if (err) {
                  console.error("Database Insertion Error:", err);
                  return res
                    .status(500)
                    .json({ message: "Database insertion error", error: err });
                }
                const insertedId = userAlbumResult.insertId;
                const insertUserAlbumQuerygallery = `
            INSERT INTO gallery (image,user_id,status,album_id,  date)
            VALUES (?, ?, ?, ?, ?)
          `;

                uploadedFiles.forEach((image) => {
                  db.query(
                    insertUserAlbumQuerygallery,
                    [image, user_id, "Gallery", album_id, date],
                    (err, result) => {
                      if (err) {
                        console.error("Database Insertion Error:", err);
                        // Optional: You can accumulate and return a list of failed inserts
                        return;
                      }
                      // Optional: log or collect successful inserts
                    }
                  );
                  db.query(
                    "INSERT INTO useralbum_file_datetime (user_id,image_url,useralbum_id,date) VALUES (?, ?, ?, ?)",
                    [user_id, image, insertedId, date],
                    (err, result) => {}
                  );
                });
                res.status(200).json({
                  message: "Album uploaded successfully",
                  files: uploadedFiles,
                  album_id: album_id, // Return album ID in response
                });
              }
            );
          }
        );
      });
    } else {
      // If `addToAlbum` is not "Yes", only insert into usersalbum
      // const insertUserAlbumQuery = `
      //   INSERT INTO usersalbum (images, visibility, rightsConfirmed, addToAlbum, user_id, date)
      //   VALUES (?, ?, ?, ?, ?, ?)
      // `;
      // db.query(
      //   insertUserAlbumQuery,
      //   [
      //     JSON.stringify(uploadedFiles),
      //     visibility,
      //     rightsConfirmed,
      //     addToAlbum,
      //     user_id,
      //     date,
      //   ],
      //   (err, userAlbumResult) => {
      //     if (err) {
      //       console.error("Database Insertion Error:", err);
      //       return res
      //         .status(500)
      //         .json({ message: "Database insertion error", error: err });
      //     }
      //     // Respond with success
      //     res.status(200).json({
      //       message: "Album uploaded successfully",
      //       files: uploadedFiles,
      //     });
      //   }
      // );
    }
  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ message: "Server error", error: err });
  }
};

exports.getalbumStatus = async (req, res) => {
  const { user_id } = req.body;
  var status = req.body.status;
  if (status === "Private") {
    var status = "Private_visible";
  }
  if (status === "Friends_visible") {
    var status = "Friends_visible";
  }
  if (status === "Public_visible") {
    var status = "Public_visible";
  }

  try {
    db.query(
      `SELECT * from usersalbum where user_id = ? And album_id != ?`,
      [user_id, "0"],
      (err, results) => {
        return res.status(200).json({ results: results });
      }
    );
  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ message: "Server error", error: err });
  }
};
exports.getalbumStatusonly = async (req, res) => {
  const { user_id } = req.body; // Get user_id from request params

  if (!user_id) {
    return res.status(400).json({ message: "User ID is required" });
  }

  const query = `
    SELECT
        ua.id AS usersalbum_id,
        ua.user_id,
        ua.album_id,
        ua.images,
        ua.visibility,
        ua.rightsConfirmed,
        ua.addToAlbum,
        ua.date,
        a.name AS album_name,
        a.id AS albumID
    FROM usersalbum ua
    JOIN albums a ON ua.album_id = a.id
    WHERE a.visibility != ? And ua.user_id = ?;
  `;

  db.query(query, ["Friends_visible", user_id], (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }
    return res.status(200).json({ results });
  });
};
exports.get_albumStatusonlyfriend = async (req, res) => {
  const { user_id } = req.body; // Get user_id from request params

  if (!user_id) {
    return res.status(400).json({ message: "User ID is required" });
  }

  const query = `
    SELECT
        ua.id AS usersalbum_id,
        ua.user_id,
        ua.album_id,
        ua.images,
        ua.visibility,
        ua.rightsConfirmed,
        ua.addToAlbum,
        ua.date,
        a.name AS album_name,
        coverphoto.image_url AS cover_image
    FROM usersalbum ua
    JOIN albums a ON ua.album_id = a.id
    LEFT JOIN coverphoto ON coverphoto.usersalbum_id = a.id  
    WHERE a.visibility = ? And ua.user_id = ?`;

  db.query(query, ["Friends_visible", user_id], (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }
    return res.status(200).json({ results });
  });
};
exports.get_albumStatusonlyPublic = async (req, res) => {
  const { user_id } = req.body; // Get user_id from request params

  if (!user_id) {
    return res.status(400).json({ message: "User ID is required" });
  }

  const query = `
    SELECT
        ua.id AS usersalbum_id,
        ua.user_id,
        ua.album_id,
        ua.images,
        ua.visibility,
        ua.rightsConfirmed,
        ua.addToAlbum,
        ua.date,
        a.name AS album_name,
        coverphoto.image_url AS cover_image
    FROM usersalbum ua
    Left JOIN albums a ON ua.album_id = a.id
    LEFT JOIN coverphoto ON coverphoto.usersalbum_id = a.id  
    WHERE  ua.user_id = ?;
  `;

  db.query(query, [user_id], (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }
    return res.status(200).json({ results });
  });
};
async function sendEmailForOtp(too, otp, callback) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf",
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: too,
    subject: "Your One-Time OTP for Amourette", // Corrected and more descriptive subject
    text: `Dear User,\n\nYour one-time OTP for secure access is: ${otp}\n\nThis OTP is valid for a single use. Please do not share this code with anyone.\n\nThank you,\nAmourette Team`, // Improved text
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error:", error);
    } else {
      console.log("Email sent:", info.response); // Uncomment if you want to log successful sends
    }
  });
}

exports.checkOTP = async (req, res) => {
  const { id, otp } = req.body;

  // Ensure id and otp are provided
  if (!id || !otp) {
    return res.status(400).json({ message: "Missing id or otp" });
  }

  try {
    // First, check if the OTP is correct
    const [results] = await db
      .promise()
      .query(`SELECT * FROM users WHERE id = ? AND otp = ?`, [id, otp]);

    if (results.length > 0) {
      // OTP is valid, now update the user's two-factor authentication status
      const [updateResult] = await db
        .promise()
        .query("UPDATE users SET two_fA = ? WHERE id = ?", ["Yes", id]);
      if (results[0].two_fA === "Yes") {
        return res.status(200).json({
          status: "2",
          message: "OTP has already been used",
        });
      } else {
        if (updateResult.affectedRows > 0) {
          return res.status(200).json({
            status: "1",
            message: "OTP verified successfully",
          });
        } else {
          return res.status(200).json({
            status: "2",
            message: "Failed to update two-factor authentication status",
          });
        }
      }
    } else {
      return res.status(200).json({ status: "2", message: "Invalid OTP" });
    }
  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ message: "Server error", error: err });
  }
};
exports.checkprotectedpassword = async (req, res) => {
  const { idd, id, password } = req.body;

  // Ensure id and otp are provided

  try {
    // First, check if the OTP is correct
    const [results] = await db
      .promise()
      .query(`SELECT * FROM usersalbum WHERE id = ? AND password = ?`, [
        idd,
        password,
      ]);

    if (results.length > 0) {
      // OTP is valid, now update the user's two-factor authentication status
      return res.status(200).json({
        status: "1",
        message: "Password verified successfully",
      });
    } else {
      return res.status(200).json({
        status: "2",
        message: "Invalid password",
      });
    }
  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ message: "Server error", error: err });
  }
};
exports.checkpassword = async (req, res) => {
  const { id, password } = req.body;

  // Ensure id and otp are provided
  if (!id || !password) {
    return res.status(400).json({ message: "Missing id or password" });
  }

  db.query("SELECT * FROM users WHERE id = ?", [id], async (err, rows) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    if (rows.length > 0) {
      const user = rows[0];

      // Check if password matches
      const isPasswordValid = await bcrypt.compare(password, user.password);
      if (!isPasswordValid) {
        return res
          .status(200)
          .json({ status: "2", message: "Invalid password" });
      } else {
        return res.status(200).json({ status: "1", message: "" });
      }

      // Handle user status
    } else {
      res.status(200).json({ status: "2", message: "Something went wrong" });
    }
  });
};
const generateOTP = () => {
  // Generate a random 6-digit number
  return Math.floor(100000 + Math.random() * 900000); // Returns a 6-digit number
};

exports.sendOTP = async (req, res) => {
  const { id, two_fA } = req.body;

  // Ensure id is provided
  if (!id) {
    return res.status(400).json({ message: "Missing id" });
  }

  try {
    // First, check if the user exists in the database
    const [results] = await db
      .promise()
      .query(`SELECT * FROM users WHERE id = ?`, [id]);

    if (results.length > 0) {
      // Generate a 6-digit OTP
      if (two_fA === "Yes") {
        const otp = generateOTP();
        var email = results[0].email;
        sendEmailForOtp(email, otp, (info) => {
          res.send(info);
        });
        // Update the user's record with the generated OTP
        const [updateResult] = await db
          .promise()
          .query("UPDATE users SET otp = ?,two_fA = ? WHERE id = ?", [
            otp,
            "No",
            id,
          ]);
        if (updateResult.affectedRows > 0) {
          // Send the OTP via email or SMS here (you can implement that part as needed)

          return res.status(200).json({
            status: "1",
            message: "OTP send successfully, please check your email",
          });
        } else {
          return res.status(200).json({
            status: "2",
            message: "Failed to update OTP",
          });
        }
      } else {
        var email = results[0].email;

        // Update the user's record with the generated OTP
        const [updateResult] = await db
          .promise()
          .query("UPDATE users SET otp = ?,two_fA = ? WHERE id = ?", [
            "",
            "No",
            id,
          ]);
        if (updateResult.affectedRows > 0) {
          // Send the OTP via email or SMS here (you can implement that part as needed)

          return res.status(200).json({
            status: "1",
            message: "Successfully updated",
          });
        } else {
          return res.status(200).json({
            status: "2",
            message: "Failed to update",
          });
        }
      }
    } else {
      return res.status(200).json({ status: "2", message: "Invalid user ID" });
    }
  } catch (err) {
    console.error("Server Error:", err);
    return res.status(500).json({ message: "Server error", error: err });
  }
};

const logActivity = (userId, description) => {
  const query = `
    INSERT INTO logsactivity (user_id, description, date)
    VALUES (?, ?, NOW())
  `;
  db.query(query, [userId, description], (err, result) => {
    if (err) {
      console.error("Error inserting log activity:", err);
    }
  });
};
exports.checkoutpayy = async (req, res) => {
  const { plan } = req.body;
  try {
    let productId;
    let priceId;

    switch (plan) {
      case "BASIC":
        productId = "prod_RgE3FhSl8b2bBA";
        priceId = "price_1QmrbLAQYHZn8ah9URQGm8Kq";
        break;
      case "PRO":
        productId = "prod_RgE3ZRKXk0zYld";
        priceId = "price_1QmrbpAQYHZn8ah96ak9boc6";
        break;
      case "VIP":
        productId = "prod_RlRrbAwNk5W6zU";
        priceId = "price_1QruxjAQYHZn8ah9fXAdlqHy";
        break;
      default:
        return res.status(400).json({ error: "Invalid plan selected" });
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      success_url: `https://amourette.no/setting?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://amourette.no/setting?canceled=true`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("Error creating checkout session", err);
    res.status(500).json({ error: err.message });
  }
};

// Webhook to handle Stripe events like subscription updates, trial ending, etc.
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  let event = req.body;
  const endpointSecret = "whsec_12345"; // Replace with your webhook secret

  if (endpointSecret) {
    const signature = req.headers["stripe-signature"];

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        endpointSecret
      );
    } catch (err) {
      console.log(`⚠️ Webhook signature verification failed.`, err.message);
      return res.sendStatus(400);
    }
  }

  let subscription;
  let status;

  switch (event.type) {
    case "customer.subscription.created":
      subscription = event.data.object;
      status = subscription.status;
      console.log(`Subscription created: ${status}`);
      break;
    case "customer.subscription.updated":
      subscription = event.data.object;
      status = subscription.status;
      console.log(`Subscription updated: ${status}`);
      break;
    case "customer.subscription.deleted":
      subscription = event.data.object;
      status = subscription.status;
      console.log(`Subscription deleted: ${status}`);
      break;
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  res.send(); // Respond with a 200 status to acknowledge receipt of the event
});

exports.paymentdatasaveafterpay = async (req, res) => {
  const { session_id, user_id, productId, amount, days } = req.body; // session_id sent from the client-side

  try {
    const session = await stripe.checkout.sessions.retrieve(session_id);
    const customer = await stripe.customers.retrieve(session.customer); // Get the customer info
    const subscription = await stripe.subscriptions.retrieve(
      session.subscription
    );
    const invoice = await stripe.invoices.retrieve(subscription.latest_invoice);
    var status = session.status;
    const dayss = req.body.days;
    var dt = req.body;
    var customerId = customer.id;
    var payment_id = invoice.payment_intent;
    const start_date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");
    const end_date = moment
      .tz(new Date(), "Europe/Oslo")
      .add(dayss, "days")
      .format("YYYY-MM-DD HH:mm:ss");
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");
    const uniqueCode = crypto.randomBytes(4).toString("hex");
    // First, check if session_id exists in the allmembership table
    const checkSessionExistsQuery = `
SELECT * FROM allmembership WHERE session_id = ?;
`;

    await new Promise((resolve, reject) => {
      db.query(checkSessionExistsQuery, [session_id], (err, result) => {
        if (err) {
          console.error("Database check error:", err);
          return reject({ message: "Database check error", error: err });
        }

        // If session_id exists, reject the request and do not proceed with the insert/update
        if (result.length > 0) {
          console.log("Session ID already exists, no further action taken.");
          return reject({
            message: "Session ID already exists, no further action taken.",
          });
        }

        // Session ID does not exist, proceed with insertion into allmembership table
        const insertQuery = `
  INSERT INTO allmembership (unique_code,status,
    session_id, product_id, customerId, user_id,
    start_date, end_date, days, plan, amount,
    payment_id, currency, PaymentrefundDispute_status,
    PaymentrefundDispute_date, date
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

        db.query(
          insertQuery,
          [
            uniqueCode,
            status,
            session_id,
            productId,
            customerId,
            user_id,
            start_date,
            end_date,
            dayss, // Ensure this variable is correctly declared
            dt.plan,
            dt.amount,
            payment_id,
            dt.currency,
            "History", // Now correctly placed under PaymentrefundDispute_status
            date, // PaymentrefundDispute_date
            date, // date (ensure it's correctly formatted)
          ],
          (err, result) => {
            if (err) {
              console.error("Database insertion error:", err);
              return reject({
                message: "Database insertion error",
                error: err,
              });
            }
            resolve(result); // Resolve the promise if insertion is successful
          }
        );
      });
    });

    // Now check if the user exists in the membership table
    const checkUserExistsQuery = `
SELECT * FROM membership WHERE user_id = ?;
`;

    const insertQueryy = `
INSERT INTO membership
  (status,session_id, product_id, customerId, start_date, end_date, days, plan, amount, payment_id, currency, date, PaymentrefundDispute_status,user_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?);
`;

    const updateQuery = `
UPDATE membership
SET
unique_code=?,
status = ?,
  session_id = ?,
  product_id = ?,
  customerId = ?,
  start_date = ?,
  end_date = ?,
  days = ?,
  plan = ?,
  amount = ?,
  payment_id = ?,
  currency = ?,
  date = ?,
  PaymentrefundDispute_status=?
WHERE user_id = ?;
`;

    await new Promise((resolve, reject) => {
      // Check if user exists
      db.query(checkUserExistsQuery, [user_id], (err, result) => {
        if (err) {
          console.error("Database check error:", err);
          return reject({ message: "Database check error", error: err });
        }

        if (result.length > 0) {
          // User exists, update the record
          db.query(
            updateQuery,
            [
              uniqueCode,
              status,
              session_id,
              productId,
              customerId,
              start_date,
              end_date,
              dayss,
              dt.plan,
              dt.amount,
              payment_id,
              dt.currency,
              date,
              "History",
              user_id,
            ],
            (err, result) => {
              if (err) {
                console.error("Database update error:", err);
                return reject({ message: "Database update error", error: err });
              }
              resolve(result); // Resolve if update is successful
            }
          );
        } else {
          // User does not exist, insert a new record
          db.query(
            insertQueryy,
            [
              status,
              session_id,
              productId,
              customerId,
              start_date,
              end_date,
              dayss,
              dt.plan,
              dt.amount,
              payment_id,
              dt.currency,
              date,
              "History",
              user_id,
            ],
            (err, result) => {
              if (err) {
                console.error("Database insert error:", err);
                return reject({ message: "Database insert error", error: err });
              }
              resolve(result); // Resolve if insert is successful
            }
          );
        }
      });
    });

    // If both queries succeed, send the response
    res
      .status(200)
      .json({ message: "Membership data saved and updated successfully" });
  } catch (err) {
    console.error("Error verifying session", err);
    res.status(500).json({ error: err.message });
  }
};

exports.getUserMediaDetails = async (req, res) => {
  const { user_id } = req.body;
  try {
    // Ensure user_id and to_id are provided
    if (!user_id) {
      return res.status(400).json({ message: "ID is required" });
    }

    // Query to fetch chat messages between user_id and to_id
    const query = `
      SELECT * from usersalbum where user_id=? And album_id =?`;

    // Fetching the messages
    db.query(query, [user_id, "0"], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getUserMediaAlbumDetails = async (req, res) => {
  const { user_id } = req.body;
  try {
    // Ensure user_id is provided
    if (!user_id) {
      return res.status(400).json({ message: "ID is required" });
    }

    // Query to fetch albums along with the total number of media files in each album
    const query = `
      SELECT albums.name AS album_name,
       SUM(JSON_LENGTH(usersalbum.images)) AS media_count,
       albums.id AS album_id,usersalbum.images AS img
      FROM albums
      LEFT JOIN usersalbum ON usersalbum.album_id = albums.id
      WHERE usersalbum.user_id = ?
      GROUP BY albums.id;


     `;

    // Fetching albums and media count
    db.query(query, [user_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the results (albums with media count)
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getallmediaa = async (req, res) => {
  const { album_id } = req.body;
  try {
    // Ensure user_id is provided
    if (!album_id) {
      return res.status(400).json({ message: "ID is required" });
    }

    // Query to fetch albums along with the total number of media files in each album
    const query = `SELECT * from usersalbum where album_id = ?`;

    // Fetching albums and media count
    db.query(query, [album_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the results (albums with media count)
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.get_gallerySearch = async (req, res) => {
  try {
    const search = req.body.search?.trim() || "";
    let user_ids = req.body.user_ids;

    // Ensure user_ids is an array
    if (typeof user_ids === "string") {
      user_ids = user_ids.split(",").map((id) => id.trim());
    }

    // Validation: Check if search and user_ids are provided

    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ message: "User IDs are required" });
    }

    // Ensure all user_ids are valid numbers (to prevent SQL injection risk)
    if (!user_ids.every((id) => /^\d+$/.test(id))) {
      return res.status(400).json({ message: "Invalid user IDs provided" });
    }

    // Generate placeholders for user IDs dynamically
    const userPlaceholders = user_ids.map(() => "?").join(", ");

    const query = `SELECT
        g.id AS gallery_id,
        g.slug AS gallery_slug,
        g.name AS gname,
        g.description AS gdescription,
        g.image AS gimage,
        g.date as gdate,
        u.username AS gallery_owner_username,
        u.id AS uid,
        u.profile_image AS gallery_owner_profile_image,
        u.makeImagePrivate,

        -- Count total comments in the gallery
        COUNT(DISTINCT gc.id) AS total_comments,

        -- Count total likes (favourites) for the gallery
        COUNT(DISTINCT gf.id) AS total_likes

    FROM gallery g
    JOIN users u ON g.user_id = u.id  -- Get gallery owner details
    LEFT JOIN gallery_comment gc ON g.id = gc.gallery_id  -- Get comments in the gallery
    LEFT JOIN gallery_favourite gf ON g.id = gf.gallery_id  -- Get likes on gallery

    WHERE
        g.user_id IN (${userPlaceholders})  -- Dynamically generate placeholders for user IDs
        AND (
            LOWER(COALESCE(gc.description, '')) LIKE ? OR
            LOWER(COALESCE(u.username, '')) LIKE ? OR
            LOWER(COALESCE(g.name, '')) LIKE ? OR
            LOWER(COALESCE(g.description, '')) LIKE ?
        )

    GROUP BY g.id, u.id
    ORDER BY g.id DESC;`;

    // Prepare query parameters safely
    const searchPattern = `%${search}%`;
    const queryParams = [
      ...user_ids,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
    ];

    // Execute the query using MySQL2
    db.query(query, queryParams, (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        message: "Filtered gallery and related data retrieved successfully",
        results,
      });
    });
  } catch (error) {
    console.error("Gallery retrieval error:", error);
    res.status(500).json({ message: "Gallery retrieval error", error });
  }
};

exports.get_forumSearch = async (req, res) => {
  try {
    const search = req.body.search?.trim() || "";
    let user_ids = req.body.user_ids;

    // Ensure user_ids is an array
    if (typeof user_ids === "string") {
      user_ids = user_ids.split(",").map((id) => id.trim());
    }

    // Validation: Check if search and user_ids are provided

    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ message: "User IDs are required" });
    }

    // Ensure all user_ids are valid numbers (to prevent SQL injection risk)
    if (!user_ids.every((id) => /^\d+$/.test(id))) {
      return res.status(400).json({ message: "Invalid user IDs provided" });
    }

    // Generate placeholders for user IDs dynamically
    const userPlaceholders = user_ids.map(() => "?").join(", ");

    const query = `SELECT
        f.id AS forum_id,
        f.slug AS forum_slug,
        f.name AS fname,
        f.description AS fdescription,
        f.image AS fimage,
        f.date AS fdate,
        u.username AS forum_owner_username,
        u.profile_image AS forum_owner_profile_image,
        u.id AS uid,
        u.makeImagePrivate,

        -- Count total comments in the forum
        COUNT(fc.id) AS total_comments

    FROM forum f
    JOIN users u ON f.user_id = u.id  -- Get forum owner details
    LEFT JOIN forum_comment fc ON f.id = fc.forum_id  -- Get comments in the forum

    WHERE
        f.user_id IN (${userPlaceholders})  -- Dynamically generate placeholders for user IDs
        AND (
            LOWER(COALESCE(fc.description, '')) LIKE ? OR
            LOWER(COALESCE(u.username, '')) LIKE ? OR
            LOWER(COALESCE(f.name, '')) LIKE ? OR
            LOWER(COALESCE(f.description, '')) LIKE ?
        )

    GROUP BY f.id, u.id
    ORDER BY f.id DESC;`;

    const searchPattern = `%${search}%`;
    const queryParams = [
      ...user_ids,
      searchPattern,
      searchPattern,
      searchPattern,
      searchPattern,
    ];

    // Execute the query using MySQL2
    db.query(query, queryParams, (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        message: "Filtered gallery and related data retrieved successfully",
        results,
      });
    });
  } catch (error) {
    console.error("Gallery retrieval error:", error);
    res.status(500).json({ message: "Gallery retrieval error", error });
  }
};
exports.get_friendsearch = async (req, res) => {
  var user_id = req.body.user_id;
  try {
    const search = req.body.search?.trim() || "";

    // Generate the search pattern with `%`
    const searchPattern = `%${search}%`;

    // SQL query to search both username and email
    const query = `
     SELECT u.*,fr.status as fr_status,fr.id as fr_id,fr.user_id,fr.sent_to
      FROM users u
      LEFT JOIN friendRequest_accept fr
          ON (fr.user_id = ? AND fr.sent_to = u.id)
          OR (fr.sent_to = ? AND fr.user_id = u.id)
      WHERE
          (fr.id IS NULL OR fr.status = 'No')
          AND u.id != ?
      AND (u.username LIKE ?);
    `;

    const queryParams = [user_id, user_id, user_id, searchPattern];

    // Execute the query using MySQL2
    db.query(query, queryParams, (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        message: "Filtered users retrieved successfully",
        results,
      });
    });
  } catch (error) {
    console.error("Error during friend search:", error);
    res.status(500).json({ message: "Error during friend search", error });
  }
};

exports.handlerequestcancel = async (req, res) => {
  var id = req.body.id;
  try {
    const deleteQuery = `DELETE FROM friendRequest_accept WHERE id  = ?`;
    db.query(deleteQuery, [id], (deleteErr) => {
      if (deleteErr) {
        console.error("Database delete error:", deleteErr);
        return res
          .status(500)
          .json({ message: "Database delete error", error: deleteErr });
      }
      return res
        .status(200)
        .json({ message: "Database delete error", status: "1" });
    });
    const deleteQueryy = `DELETE FROM notification WHERE post_id  = ?`;
    db.query(deleteQueryy, [id], (deleteErr) => {
      if (deleteErr) {
        console.error("Database delete error:", deleteErr);
        return res
          .status(500)
          .json({ message: "Database delete error", error: deleteErr });
      }
    });
  } catch (error) {
    console.error("Error during friend search:", error);
    res.status(500).json({ message: "Error during friend search", error });
  }
};

exports.handlerequestadd = async (req, res) => {
  const { user_id, sent_to } = req.body;

  if (!user_id || !sent_to) {
    return res
      .status(400)
      .json({ message: "Both user_id and sent_to are required" });
  }

  try {
    var date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    db.query(
      "INSERT INTO friendRequest_accept (user_id, sent_to, status, date) VALUES (?, ?, ?, ?)",
      [user_id, sent_to, "No", date],
      (err, result) => {
        if (err) {
          console.error("Database insertion error for user_id:", user_id, err);
        }

        res.status(200).json({
          message: "Friend request sent successfully",
        });
      }
    );
  } catch (error) {
    console.error("Error during friend request insert:", error);
    res
      .status(500)
      .json({ message: "Error during friend request insert", error });
  }
};
exports.getprivatemediaalbum = async (req, res) => {
  const { user_id, album_id } = req.body;

  try {
    db.query(
      `SELECT a.*, ua.images, ua.id AS m_id, cp.image_url AS cover_image FROM albums a JOIN usersalbum ua ON a.id = ua.album_id LEFT JOIN coverphoto cp ON cp.usersalbum_id = a.id WHERE a.user_id = ? AND a.id = ?`,
      [user_id, album_id],
      (err, results) => {
        if (err) {
          console.error("Database insertion error for user_id:", user_id, err);
        }

        res.status(200).json({
          message: "Friend request sent successfully",
          results: results,
        });
      }
    );
  } catch (error) {
    console.error("Error during friend request insert:", error);
    res
      .status(500)
      .json({ message: "Error during friend request insert", error });
  }
};
exports.getpreviewtemediaalbum = async (req, res) => {
  const { user_id, album_id } = req.body;
  try {
    db.query(
      `SELECT a.*, ua.images, ua.id as m_id,cp.image_url AS cover_image
      FROM albums a
      JOIN usersalbum ua ON ua.album_id = a.id
      LEFT JOIN coverphoto cp ON cp.usersalbum_id = a.id
      WHERE  a.id = ?;
    `,
      [album_id],
      (err, results) => {
        if (err) {
          console.error("Database insertion error for user_id:", user_id, err);
        }

        res.status(200).json({
          message: "Friend request sent successfully",
          results: results,
        });
      }
    );
  } catch (error) {
    console.error("Error during friend request insert:", error);
    res
      .status(500)
      .json({ message: "Error during friend request insert", error });
  }
};
exports.privatealbumdelete = async (req, res) => {
  const { user_id, image, id } = req.body;
  console.log();
  try {
    // Step 1: Fetch the current images array
    db.query(
      "SELECT images FROM usersalbum WHERE user_id = ? AND id = ?",
      [user_id, id],
      (err, results) => {
        if (err) {
          console.error("Database query error:", err);
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        if (results.length === 0) {
          return res.status(404).json({ message: "Album not found" });
        }

        let imagesArray = JSON.parse(results[0].images); // Parse JSON
        imagesArray = imagesArray.filter((img) => img !== image); // Remove specific image
        const updatedImages = JSON.stringify(imagesArray); // Convert back to JSON string

        // Step 2: Update the database with the new images array
        db.query(
          "UPDATE usersalbum SET images = ? WHERE user_id = ? AND id = ?",
          [updatedImages, user_id, id],
          (updateErr) => {
            if (updateErr) {
              console.error("Error updating images:", updateErr);
              return res
                .status(500)
                .json({ message: "Error updating images", error: updateErr });
            }
            db.query(
              "DELETE FROM usersalbumcomment WHERE user_id = ? AND image_url = ?",
              [user_id, image],
              (deleteErr, result) => {
                if (deleteErr) {
                  console.error("Error deleting comment:", deleteErr);
                  return res.status(500).json({
                    message: "Error deleting comment",
                    error: deleteErr,
                  });
                }
                db.query(
                  "DELETE FROM usersalbumfavourite WHERE user_id = ? AND image_url = ?",
                  [user_id, image],
                  (deleteErr, result) => {
                    if (deleteErr) {
                      console.error("Error deleting comment:", deleteErr);
                      return res.status(500).json({
                        message: "Error deleting comment",
                        error: deleteErr,
                      });
                    }
                  }
                );
              }
            );

            res.status(200).json({
              message: "Image successfully removed",
              status: "1",
            });
          }
        );
      }
    );
  } catch (error) {
    console.error("Error in privatealbumdelete:", error);
    res.status(500).json({ message: "Server error", error });
  }
};
exports.privatealbumdeleteprofile = async (req, res) => {
  const { user_id, image, id } = req.body;
  console.log();
  try {
    // Step 1: Fetch the current images array
    db.query(
      "SELECT images FROM usersalbum WHERE user_id = ? AND id = ?",
      [user_id, id],
      (err, results) => {
        if (err) {
          console.error("Database query error:", err);
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        if (results.length === 0) {
          return res.status(404).json({ message: "Album not found" });
        }

        let imagesArray = JSON.parse(results[0].images); // Parse JSON
        imagesArray = imagesArray.filter((img) => img !== image); // Remove specific image
        const updatedImages = JSON.stringify(imagesArray); // Convert back to JSON string

        // Step 2: Update the database with the new images array
        db.query(
          "UPDATE usersalbum SET images = ? WHERE user_id = ? AND id = ?",
          [updatedImages, user_id, id],
          (updateErr) => {
            if (updateErr) {
              console.error("Error updating images:", updateErr);
              return res
                .status(500)
                .json({ message: "Error updating images", error: updateErr });
            }
            db.query(
              "DELETE FROM usersalbumcomment WHERE user_id = ? AND image_url = ?",
              [user_id, image],
              (deleteErr, result) => {
                if (deleteErr) {
                  console.error("Error deleting comment:", deleteErr);
                  return res.status(500).json({
                    message: "Error deleting comment",
                    error: deleteErr,
                  });
                }
                db.query(
                  "DELETE FROM usersalbumfavourite WHERE user_id = ? AND image_url = ?",
                  [user_id, image],
                  (deleteErr, result) => {
                    if (deleteErr) {
                      console.error("Error deleting comment:", deleteErr);
                      return res.status(500).json({
                        message: "Error deleting comment",
                        error: deleteErr,
                      });
                    }
                  }
                );
              }
            );

            res.status(200).json({
              message: "Image successfully removed",
              status: "1",
            });
          }
        );
      }
    );
  } catch (error) {
    console.error("Error in privatealbumdelete:", error);
    res.status(500).json({ message: "Server error", error });
  }
};

exports.uploadprivateAlbums = async (req, res) => {
  try {
    const { user_id, id } = req.body;
    console.log(req.body);
    const uploadedFiles = req.files.map((file) => file.location); // Get uploaded file URLs
    // Step 1: Fetch existing images from the database
    db.query(
      "SELECT images FROM usersalbum WHERE user_id = ? AND id = ?",
      [user_id, id],
      (err, results) => {
        if (err) {
          console.error("Database query error:", err);
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        let existingImages = [];
        if (results.length > 0 && results[0].images) {
          existingImages = JSON.parse(results[0].images); // Parse existing images JSON
        }
        console.log(existingImages);
        // Step 2: Append new images
        const updatedImages = JSON.stringify([
          ...existingImages,
          ...uploadedFiles,
        ]);
        console.log(updatedImages);
        console.log(user_id);
        console.log(id);
        // Step 3: Update the database with the new image list
        db.query(
          "UPDATE usersalbum SET images = ? WHERE user_id = ? AND id = ?",
          [updatedImages, user_id, id],
          (updateErr) => {
            if (updateErr) {
              console.error("Error updating images:", updateErr);
              return res
                .status(500)
                .json({ message: "Error updating images", error: updateErr });
            }
            const date = moment
              .tz(new Date(), "Europe/Oslo")
              .format("YYYY-MM-DD HH:mm:ss");
            db.query(
              "INSERT INTO useralbum_file_datetime (user_id,image_url,useralbum_id,date) VALUES (?, ?, ?, ?)",
              [user_id, uploadedFiles, id, date],
              (err, result) => {}
            );
            res.status(200).json({
              message: "Files successfully uploaded",
              status: "1",
              images: JSON.parse(updatedImages), // Send updated images in response
            });
          }
        );
      }
    );
  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ message: "Server error", error: err });
  }
};

exports.profileconfimationComment = async (req, res) => {
  const { user_id, to_id, comments } = req.body;
  console.log(req.body, "l");
  const wss = req.wss;

  try {
    // Validate required fields
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "User ID and To ID are required" });
    }

    // Insert Query
    const query = `
      INSERT INTO profile_confirmation (user_id, to_id, comments, date)
      VALUES (?, ?, ?, NOW())
    `;

    db.query(query, [user_id, to_id, comments], (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database insertion error",
          error: err,
        });
      }
      const broadcastMessage = JSON.stringify({
        event: "profileconfirm",
      });

      if (wss) {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMessage);
          }
        });
      }
      return res.status(201).json({
        message: "Comment added successfully",
        insertId: result.insertId,
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getallprofileconfrmation = async (req, res) => {
  const { user_id, user_ids, to_id } = req.body;
  console.log(req.body);
  try {
    // Validate required fields
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "User ID and To ID are required" });
    }

    // Ensure user_ids is an array and convert to numbers (except any non-numeric values)
    const userIdsArray = user_ids
      .map((id) => parseInt(id, 10))
      .filter((id) => !isNaN(id));

    if (userIdsArray.length === 0) {
      return res.status(400).json({ message: "Invalid user IDs" });
    }

    // SQL Query with JOIN
    const query = `
      SELECT p.*, 
             u.username, 
             u.profile_image,u.id as uid 
      FROM profile_confirmation p
      JOIN users u ON p.user_id = u.id
      WHERE p.to_id =? 
      ORDER BY p.id DESC
    `;

    db.query(query, [to_id], (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      return res.status(200).json({
        results: result,
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.profiledeleteComment = async (req, res) => {
  const { id } = req.body;

  console.log(req.body, "l");

  try {
    // Validate required field
    if (!id) {
      return res.status(400).json({ message: "Comment ID is required" });
    }

    // Delete Query
    const query = `DELETE FROM profile_confirmation WHERE id = ?`;

    db.query(query, [id], (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database deletion error",
          error: err,
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({ message: "Comment not found" });
      }

      return res.status(200).json({
        message: "Comment deleted successfully",
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.deletePostDashboard = (req, res) => {
  const { id, post_type } = req.body;
  const wss = req.wss;

  if (!id) {
    return res.status(400).json({ message: "Post ID is required" });
  }

  const executeQuery = (query, params) => {
    return new Promise((resolve, reject) => {
      db.query(query, params, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  };

  const broadcastEvent = (eventName) => {
    const message = JSON.stringify({ event: eventName });
    if (wss) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  };

  let deleteQueries = [];
  let eventName = "";

  switch (post_type) {
    case "group":
      deleteQueries = [
        { query: "DELETE FROM group_post WHERE id = ?", params: [id] },
        {
          query: "DELETE FROM group_post_comment WHERE group_post_id = ?",
          params: [id],
        },
        {
          query: "DELETE FROM group_post_favourite WHERE post_id = ?",
          params: [id],
        },
      ];
      eventName = "Deletegrouppost";
      break;

    case "gallery":
      deleteQueries = [
        { query: "DELETE FROM gallery WHERE id = ?", params: [id] },
        {
          query: "DELETE FROM gallery_comment WHERE gallery_id = ?",
          params: [id],
        },
        {
          query: "DELETE FROM gallery_favourite WHERE gallery_id = ?",
          params: [id],
        },
      ];
      eventName = "Deletegallery";
      break;

    case "forum":
      deleteQueries = [
        { query: "DELETE FROM forum WHERE id = ?", params: [id] },
        { query: "DELETE FROM forum_comment WHERE forum_id = ?", params: [id] },
      ];
      eventName = "Deleteforum";
      break;

    default:
      return res.status(400).json({ message: "Invalid post type" });
  }

  // Execute the deletion chain
  executeQuery(deleteQueries[0].query, deleteQueries[0].params)
    .then((result) => {
      if (result.affectedRows === 0) {
        throw { status: 404, message: "Post not found" };
      }
      // Execute remaining delete queries
      const promises = deleteQueries
        .slice(1)
        .map((q) => executeQuery(q.query, q.params));
      return Promise.all(promises);
    })
    .then(() => {
      broadcastEvent(eventName);
      res
        .status(200)
        .json({ message: "Post and related data deleted successfully" });
    })
    .catch((error) => {
      res
        .status(error.status || 500)
        .json({ message: "Database deletion error", error });
    });
};

exports.deletemessagechat = (req, res) => {
  const { id, user_id, to_id } = req.body;
  const wss = req.wss;

  console.log("Received request body:", req.body);

  if (!id) {
    return res.status(400).json({ message: "Message ID is required" });
  }

  // Delete from chatmessage_left
  const deleteChatMessageLeftQuery = `DELETE FROM chatmessage_left WHERE chatmessages_id = ?`;
  db.query(deleteChatMessageLeftQuery, [id], (err1) => {
    if (err1) {
      console.error("Error deleting from chatmessage_left:", err1);
      return res
        .status(500)
        .json({ message: "Error deleting from chatmessage_left", error: err1 });
    }

    // Delete from chatmessages
    const deleteChatMessagesQuery = `DELETE FROM chatmessages WHERE id = ?`;
    db.query(deleteChatMessagesQuery, [id], (err2) => {
      if (err2) {
        console.error("Error deleting from chatmessages:", err2);
        return res
          .status(500)
          .json({ message: "Error deleting from chatmessages", error: err2 });
      }

      // Broadcast WebSocket event
      const broadcastMessage = JSON.stringify({
        event: "DeleteChatMessage",
        id,
        user_id,
        to_id,
      });

      if (wss) {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMessage);
          }
        });
      }

      return res.status(200).json({
        message: "Deleted successfully",
        deletedId: id,
      });
    });
  });
};

exports.deletemultiplemessagechat = (req, res) => {
  const { id, user_id, to_id, other_id } = req.body;
  const wss = req.wss;

  try {
    // Ensure `id` is an array and filter out any non-numeric values
    const validIds =
      Array.isArray(id) && id.length > 0 ? id.filter(Number) : [];

    const insertOtherIds = Array.isArray(other_id) && other_id.length > 0;

    // Function to execute deletion query only if valid IDs exist
    const executeDeletion = () => {
      if (validIds.length > 0) {
        const deleteChatMessagesQuery = `DELETE FROM chatmessages WHERE id IN (${validIds
          .map(() => "?")
          .join(",")})`;

        db.query(deleteChatMessagesQuery, validIds, (err2, result2) => {
          if (err2) {
            return res.status(500).json({
              message: "Error deleting from chatmessages",
              error: err2,
            });
          }
          finalizeProcess();
        });
      } else {
        finalizeProcess(); // If no IDs, just finalize
      }
    };

    // Function to finalize process and send response
    const finalizeProcess = () => {
      // Merge both `id` and `other_id` for broadcasting
      const mergedIds = [...validIds, ...(insertOtherIds ? other_id : [])];

      const broadcastMessage = JSON.stringify({
        event: "DeleteChatMessageMultiple",
        id: mergedIds, // Deleted chat message IDs + inserted other_id
        user_id,
        to_id,
      });

      if (wss) {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMessage);
          }
        });
      }

      return res.status(200).json({
        message: "Deleted successfully",
        deletedIds: mergedIds,
      });
    };

    // Insert `other_id` if it exists; otherwise, proceed to deletion
    if (insertOtherIds) {
      const insertQuery = `INSERT INTO chatmessage_left (chatmessages_id, user_id, date) VALUES ${other_id
        .map(() => "(?, ?, NOW())")
        .join(",")}`;

      const insertValues = other_id.flatMap((oid) => [oid, user_id]);

      db.query(insertQuery, insertValues, (insertErr, insertResult) => {
        if (insertErr) {
          return res.status(500).json({
            message: "Error inserting into chatmessage_left",
            error: insertErr,
          });
        }
        executeDeletion();
      });
    } else {
      executeDeletion();
    }
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.favmemberinsert = (req, res) => {
  const { user_id, to_id } = req.body; // Expecting single user_id and single to_id

  try {
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "Valid user_id and to_id are required" });
    }

    // Check if a record exists in fav_friends
    const checkQuery = `SELECT * FROM fav_friends WHERE user_id = ? AND to_id = ?`;

    db.query(checkQuery, [user_id, to_id], (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (results.length > 0) {
        // If record exists, delete it
        const deleteQuery = `DELETE FROM fav_friends WHERE user_id = ? AND to_id = ?`;
        db.query(deleteQuery, [user_id, to_id], (err, result) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Database deletion error", error: err });
          }

          return res.status(200).json({
            message: "Favorite member removed",
            deletedId: to_id,
            status: 2,
          });
        });
      } else {
        var date = moment
          .tz(new Date(), "Europe/Oslo")
          .format("YYYY-MM-DD HH:mm:ss");
        // If record does not exist, insert it
        const insertQuery = `INSERT INTO fav_friends (user_id, to_id,date) VALUES (?, ?,?)`;

        db.query(insertQuery, [user_id, to_id, date], (err, result) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Database insertion error", error: err });
          }

          return res.status(200).json({
            message: "Favorite member added",
            insertedId: to_id,
            status: 1,
          });
        });
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getUserDetailsfav = (req, res) => {
  const { user_id, to_id } = req.body; // Expecting single user_id and single to_id

  try {
    if (!user_id || !to_id) {
      return res
        .status(400)
        .json({ message: "Valid user_id and to_id are required" });
    }

    // Check if a record exists in fav_friends
    const checkQuery = `SELECT * FROM fav_friends WHERE user_id = ? AND to_id = ?`;

    db.query(checkQuery, [user_id, to_id], (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (results.length > 0) {
        // If record exists, delete it
        return res.status(200).json({
          message: "Favorite member removed",
          status: 1,
        });
      } else {
        return res.status(200).json({
          message: "Favorite member removed",
          status: 2,
        });
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.deletemessagechat_Left = (req, res) => {
  const { id, user_id, to_id } = req.body;
  const wss = req.wss;
  try {
    // Validate required field
    if (!id) {
      return res.status(400).json({ message: "Comment ID is required" });
    }
    var date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");
    // Delete Query
    const query = `INSERT INTO chatmessage_left ( chatmessages_id,user_id,date) VALUES (?, ?,?)`;

    db.query(query, [id, user_id, date], (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database deletion error",
          error: err,
        });
      }

      const broadcastMessage = JSON.stringify({
        event: "DeleteChatMessage_other",
        id,
        user_id,
        to_id,
      });

      if (wss) {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMessage);
          }
        });
      }

      return res.status(200).json({
        message: "deleted successfully",
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.deletemultiplemessagechat_left = (req, res) => {
  const { id, user_id, to_id } = req.body;
  const wss = req.wss;

  try {
    // Validate required fields
    if (!Array.isArray(id) || id.length === 0) {
      return res.status(400).json({ message: "Valid IDs are required" });
    }

    var date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Prepare values for bulk insert
    const values = id.map((chatmessages_id) => [
      chatmessages_id,
      user_id,
      date,
    ]);

    // Construct the SQL query
    const query = `INSERT INTO chatmessage_left (chatmessages_id, user_id, date) VALUES ?`;

    // Execute the query with multiple values
    db.query(query, [values], (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database insertion error",
          error: err,
        });
      }

      const broadcastMessage = JSON.stringify({
        event: "DeleteChatMessage_other_Left",
        id,
        user_id,
        to_id,
      });

      // Broadcast WebSocket message
      if (wss) {
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(broadcastMessage);
          }
        });
      }

      return res.status(200).json({
        message: "Messages deleted successfully",
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getlastestpost = async (req, res) => {
  const { user_ids, user_id } = req.body; // Expecting an array or string of user IDs
  console.log(user_ids);
  try {
    // Ensure user_ids and user_id are provided
    if (!user_ids || !user_id) {
      return res
        .status(400)
        .json({ message: "User IDs and User ID are required" });
    }

    // If user_ids is a comma-separated string, convert it into an array

    const query = `
        SELECT g.*, u.username, u.makeImagePrivate, u.profile_type, u.gender, u.profile_image as uimage
        FROM gallery g
        JOIN users u ON g.user_id = u.id
        WHERE g.user_id = (${user_id})
        ORDER BY g.id DESC LIMIT 5;
      `;

    // Fetching the galleries using parameterized query
    db.query(query, (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }
      console.log(results);
      // Sending the gallery data in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getAllforumLatest = async (req, res) => {
  const { user_id } = req.body; // Get search parameter from request body

  try {
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Construct WHERE condition for filtering
    let whereClause = `WHERE g.user_id IN (${user_id})`;

    // Query to fetch forum posts with optional search filter
    const query = `
        SELECT g.*,
              u.username,
              u.profile_type,u.profile_image,
              u.gender,
              u.birthday_date,
              COUNT(fc.id) AS total_comments
        FROM forum g
        JOIN users u ON g.user_id = u.id
        LEFT JOIN forum_comment fc ON g.id = fc.forum_id
        WHERE g.user_id = ? 
        GROUP BY g.id, u.username, u.profile_type, u.gender, u.birthday_date
        ORDER BY g.id DESC Limit 5;
    `;

    // Fetch results from the database
    db.query(query, [user_id], (err, results) => {
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

exports.getAllgrouplatest = async (req, res) => {
  const { user_id } = req.body;

  try {
    // Ensure user_id is provided
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Query to fetch latest comments and posts from groups
    const sql = `SELECT 
    activity.type,
    activity.content,
    activity.created_at,
    activity.user_id,
    g.id AS group_id,
    g.slug,
    g.image,
    g.name,
    g.description AS group_description
FROM \`groups\` g
LEFT JOIN (
    -- Fetch last comments on group posts
    SELECT 
        'comment' AS type, 
        gpc.description AS content, 
        gpc.date AS created_at, 
        gpc.user_id, 
        gpc.group_id
    FROM group_post_comment gpc

    UNION ALL
    SELECT 
        'post' AS type, 
        gp.description AS content, 
        gp.date AS created_at, 
        gp.user_id, 
        gp.group_id
    FROM group_post gp

    UNION ALL
    SELECT 
        'group' AS type, 
        NULL AS content, 
        g.date AS created_at, 
        g.user_id, 
        g.id AS group_id
    FROM \`groups\` g
) AS activity ON g.id = activity.group_id

WHERE g.user_id = ? 
ORDER BY activity.created_at DESC 
LIMIT 5;

    `;

    db.query(sql, [user_id], (err, results) => {
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

exports.getAlleventsLatest = async (req, res) => {
  const { user_id, search, user_ids } = req.body;
  console.log(req.body, "kkk");
  // Validate required fields
  if (!user_ids) {
    return res.status(400).json({ message: "User IDs are required" });
  }

  try {
    // Prepare the search term with wildcard pattern
    const searchTerm = search ? `%${search}%` : "%";

    // SQL query with dynamic search conditions
    const query = `SELECT 
    activity.type,
    activity.content,
    activity.created_at,
    activity.user_id,
    e.id AS event_id,
    e.slug,
    e.image,
    e.name,
    e.description AS event_description
FROM events e
LEFT JOIN (
    -- Fetch comments for events
    SELECT 
        'comment' AS type, 
        epc.description AS content, 
        epc.date AS created_at, 
        epc.user_id, 
        epc.event_id
    FROM event_post_comment epc

    UNION ALL

    -- Fetch posts for events
    SELECT 
        'post' AS type, 
        ep.description AS content, 
        ep.date AS created_at, 
        ep.user_id, 
        ep.event_id
    FROM event_post ep

    UNION ALL

    -- Include newly created events, even if they have no posts/comments
    SELECT 
        'event' AS type, 
        NULL AS content, 
        e.created_at AS created_at, 
        e.user_id, 
        e.id AS event_id
    FROM events e
) AS activity ON e.id = activity.event_id

WHERE e.user_id = ? 
  AND e.end_date IS NOT NULL 
  AND e.time IS NOT NULL
  AND STR_TO_DATE(CONCAT(e.end_date, ' ', e.time), '%Y-%m-%d %H:%i') >= NOW()
  
ORDER BY activity.created_at DESC 
LIMIT 5;
`;

    db.query(query, [user_id], (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        message: "Events retrieved successfully",
        results: results,
      });
    });
  } catch (error) {
    console.error("Event retrieval error:", error);
    res.status(500).json({ message: "Event retrieval error", error });
  }
};
exports.getmediaAlbumName = async (req, res) => {
  const { id, user_id } = req.body;

  try {
    // Prepare the search term with wildcard pattern

    // SQL query with dynamic search conditions
    const query = `
      SELECT * from albums where id != ? And user_id = ?;
    `;

    db.query(query, [id, user_id], (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }
      res.status(200).json({
        message: "",
        results: results,
      });
    });
  } catch (error) {
    console.error("Event retrieval error:", error);
    res.status(500).json({ message: "Event retrieval error", error });
  }
};
exports.getGalleryallAlbum = async (req, res) => {
  const { user_id } = req.body;

  try {
    // Prepare the search term with wildcard pattern

    // SQL query with dynamic search conditions
    const query = `
      SELECT * from albums where user_id = ?;
    `;

    db.query(query, [user_id], (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }
      res.status(200).json({
        message: "",
        results: results,
      });
    });
  } catch (error) {
    console.error("Event retrieval error:", error);
    res.status(500).json({ message: "Event retrieval error", error });
  }
};

exports.movetoFile = async (req, res) => {
  const { file, id, removeid, user_id } = req.body;

  if (!file || !id || !removeid || !user_id) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    // Step 1: Remove file from `removeid`
    db.query(
      "SELECT images FROM usersalbum WHERE user_id = ? AND id = ?",
      [user_id, removeid],
      (err, removeRows) => {
        if (err) {
          console.error("Database query error:", err);
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        if (removeRows.length === 0) {
          return res.status(404).json({ message: "Source album not found" });
        }

        let removeImagesArray = JSON.parse(removeRows[0].images || "[]");
        removeImagesArray = removeImagesArray.filter((img) => img !== file); // Remove file

        // Update `removeid` album
        db.query(
          "UPDATE usersalbum SET images = ? WHERE user_id = ? AND id = ?",
          [JSON.stringify(removeImagesArray), user_id, removeid],
          (updateErr) => {
            if (updateErr) {
              console.error("Error updating removeid:", updateErr);
              return res
                .status(500)
                .json({ message: "Error updating removeid", error: updateErr });
            }

            // Step 2: Add file to `id`
            db.query(
              "SELECT images FROM usersalbum WHERE user_id = ? AND id = ?",
              [user_id, id],
              (targetErr, targetRows) => {
                if (targetErr) {
                  console.error("Database query error:", targetErr);
                  return res.status(500).json({
                    message: "Database query error",
                    error: targetErr,
                  });
                }

                let targetImagesArray =
                  targetRows.length > 0
                    ? JSON.parse(targetRows[0].images || "[]")
                    : [];

                if (!targetImagesArray.includes(file)) {
                  targetImagesArray.push(file); // Add file to target album
                }

                // Update `id` album
                db.query(
                  "UPDATE usersalbum SET images = ? WHERE user_id = ? AND id = ?",
                  [JSON.stringify(targetImagesArray), user_id, id],
                  (finalErr) => {
                    if (finalErr) {
                      console.error("Error updating target album:", finalErr);
                      return res.status(500).json({
                        message: "Error updating target album",
                        error: finalErr,
                      });
                    }

                    res
                      .status(200)
                      .json({ message: "File moved successfully" });
                  }
                );
              }
            );
          }
        );
      }
    );
  } catch (error) {
    console.error("File move error:", error);
    res.status(500).json({ message: "File move error", error });
  }
};

exports.getUserDetailsFriends = async (req, res) => {
  var user_id = req.body.user_id;

  var to_id = req.body.to_id;
  try {
    // Ensure the email is provided

    // Query the database to get the user's profile details
    db.query(
      `SELECT ua.*
       FROM usersalbum ua
       JOIN friendRequest_accept fr 
       ON (fr.user_id = ua.user_id AND fr.sent_to = ?) 
       OR (fr.sent_to = ua.user_id AND fr.user_id = ?)
       WHERE fr.status = 'Yes' And ua.addToAlbum = 'No' And ua.user_id = ?
       AND ua.visibility = 'Friends_visible';`,
      [user_id, user_id, to_id],
      (err, results) => {
        return res.status(200).json({ results: results });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};

exports.getUserDetailsOwn = async (req, res) => {
  var user_id = req.body.user_id;

  try {
    // Ensure the email is provided

    // Query the database to get the user's profile details
    db.query(
      `SELECT ua.*,ua.id as usersalbum_id
       FROM usersalbum ua
       WHERE  ua.addToAlbum = 'No' And ua.user_id = ?
       AND ua.visibility = 'Friends_visible';`,
      [user_id],
      (err, results) => {
        return res.status(200).json({ results: results });
      }
    );
  } catch (error) {
    res.status(500).json({ message: "Server error", error });
  }
};
exports.checkfrdevent = async (req, res) => {
  const { user_id } = req.body;
  try {
    // Ensure user_id and to_id are provided
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Query to fetch chat messages between user_id and to_id
    const query = `
     SELECT
    u.*,
    CASE
        WHEN fr.status = 'Yes' THEN true
        ELSE false
    END AS is_friend,
    CASE
        WHEN bu.user_id IS NOT NULL THEN true
        ELSE false
    END AS is_blocked
FROM
    users u
JOIN
    friendRequest_accept fr
    ON (u.id = fr.sent_to AND fr.user_id = ?)
    OR (u.id = fr.user_id AND fr.sent_to = ?)
LEFT JOIN
    blockuser bu
    ON (u.id = bu.user_id AND bu.to_id = ?)
    OR (u.id = bu.to_id AND bu.user_id = ?)
WHERE
    fr.status = 'Yes'
    AND (
        bu.user_id IS NULL
        AND bu.to_id IS NULL
    )`;

    // Fetching the messages
    db.query(query, [user_id, user_id, user_id, user_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getmessageCount = async (req, res) => {
  console.log(req.body, "kkkk");
  try {
    // Ensure user_id and to_id are provided
    const { user_id, to_id } = req.body; // Destructure user_id and to_id

    // Query to fetch chat messages between user_id and to_id
    const query = `
          SELECT
    cm.*,
    u1.profile_image AS user1_profile,
    u1.id AS user1_id,
    u1.makeImagePrivate AS user1_makeImagePrivate,
    u2.profile_image AS user2_profile,
    u2.id AS user2_id,
    u2.makeImagePrivate AS user2_makeImagePrivate
FROM
    chatmessages cm
JOIN
    users u1 ON cm.user_id = u1.id
JOIN
    users u2 ON cm.to_id = u2.id
WHERE
    cm.user_id = ? 
    AND cm.to_id = ? 
    AND cm.read = 'No'
ORDER BY
    cm.date DESC;

      `;

    // Fetching the messages
    db.query(query, [to_id, user_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getprofilegallery = async (req, res) => {
  try {
    // Ensure user_id and to_id are provided
    const { user_id } = req.body; // Destructure user_id and to_id

    // Query to fetch chat messages between user_id and to_id
    const query = `SELECT g.*, u.username, COUNT(gc.id) AS total_comments FROM gallery g JOIN users u ON g.user_id = u.id LEFT JOIN gallery_comment gc ON g.id = gc.gallery_id WHERE g.status = ? AND g.user_id = ? GROUP BY g.id, u.username ORDER BY g.id DESC;`;

    // Fetching the messages
    db.query(query, ["Profile", user_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getallblockuser = async (req, res) => {
  try {
    // Ensure user_id and to_id are provided
    const { user_id } = req.body; // Destructure user_id and to_id

    // Query to fetch chat messages between user_id and to_id
    const query = `SELECT blockuser.*, users.profile_image, users.username, users.birthday_date FROM blockuser JOIN users ON users.id = blockuser.to_id WHERE blockuser.user_id = ? order by blockuser.id desc `;

    // Fetching the messages
    db.query(query, [user_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getalbums = async (req, res) => {
  try {
    // Ensure user_id and to_id are provided
    const { user_id } = req.body; // Destructure user_id and to_id

    // Query to fetch chat messages between user_id and to_id
    const query = `SELECT * from albums where user_id = ?`;

    // Fetching the messages
    db.query(query, [user_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.profileMovetoAlbum = async (req, res) => {
  try {
    const { user_id, albumid, profilepost, profile_image_type } = req.body;

    const allowedFields = [
      "profile_image_1",
      "profile_image_2",
      "profile_image_3",
      "profile_image_4",
    ];

    if (!allowedFields.includes(profile_image_type)) {
      return res.status(400).json({ message: "Invalid profile_image_type" });
    }

    const checkQuery = `SELECT ${profile_image_type} FROM users WHERE id = ?`;

    db.query(checkQuery, [user_id], (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Error checking user", error: err });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      const currentValue = results[0][profile_image_type];
      console.log(currentValue);
      if (currentValue !== profilepost) {
        return res
          .status(400)
          .json({ message: "Profile post not found in that field." });
      }

      // Step 1: Clear the profile image from users table
      const updateUserQuery = `UPDATE users SET ${profile_image_type} = '' WHERE id = ?`;

      db.query(updateUserQuery, [user_id], (err2) => {
        if (err2) {
          return res
            .status(500)
            .json({ message: "Error updating user", error: err2 });
        }

        // Step 2: Fetch album images
        db.query(
          "SELECT images FROM usersalbum WHERE user_id = ? AND album_id = ?",
          [user_id, albumid],
          (albumErr, albumRows) => {
            if (albumErr) {
              return res
                .status(500)
                .json({ message: "Error fetching album", error: albumErr });
            }

            let imagesArray =
              albumRows.length > 0
                ? JSON.parse(albumRows[0].images || "[]")
                : [];

            // Add image only if it doesn't already exist
            if (!imagesArray.includes(profilepost)) {
              imagesArray.push(profilepost);
            }

            // Step 3: Update album with new image array
            db.query(
              "UPDATE usersalbum SET images = ? WHERE user_id = ? AND id = ?",
              [JSON.stringify(imagesArray), user_id, albumid],
              (finalErr) => {
                if (finalErr) {
                  return res
                    .status(500)
                    .json({ message: "Error updating album", error: finalErr });
                }

                return res
                  .status(200)
                  .json({ message: "Image moved to album successfully." });
              }
            );
          }
        );
      });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.profileMovetoAlbumPublic = async (req, res) => {
  try {
    const { user_id, albumid, useralbumId, profilepost } = req.body;

    db.query(
      "SELECT * FROM usersalbum WHERE user_id = ? AND id = ?",
      [user_id, useralbumId],
      (albumErr, albumRows) => {
        if (albumErr) {
          return res
            .status(500)
            .json({ message: "Error fetching album", error: albumErr });
        }

        if (albumRows.length === 0) {
          return res.status(404).json({ message: "Album not found." });
        }

        let imagesArraydel = JSON.parse(albumRows[0].images || "[]");
        db.query(
          "SELECT * FROM usersalbum WHERE user_id = ? AND album_id = ?",
          [user_id, albumid],
          (albumErr, albumRowss) => {
            let imagesArray = JSON.parse(albumRowss[0].images || "[]");

            // The new image as a string
            const newImage = profilepost;

            // Add new image if it's not already in the array
            if (!imagesArray.includes(newImage)) {
              imagesArray.push(newImage);
            }

            db.query(
              "UPDATE usersalbum SET images = ? WHERE user_id = ? AND album_id = ?",
              [JSON.stringify(imagesArray), user_id, albumid],
              (updateErr) => {
                if (updateErr) {
                  return res.status(500).json({
                    message: "Error updating album",
                    error: updateErr,
                  });
                }
              }
            );
            console.log(imagesArraydel.length);
            if (imagesArraydel.length === 1) {
              db.query(
                "DELETE FROM usersalbum WHERE user_id = ? AND id = ?",
                [user_id, useralbumId],
                (deleteErr) => {}
              );
            }
            let imagesArrayup = imagesArraydel.filter(
              (img) => img !== profilepost
            );
            db.query(
              "UPDATE usersalbum SET images = ? WHERE user_id = ? AND id = ?",
              [JSON.stringify(imagesArrayup), user_id, useralbumId],
              (updateErr) => {
                if (updateErr) {
                  return res.status(500).json({
                    message: "Error updating album",
                    error: updateErr,
                  });
                }
              }
            );
          }
        );

        return res.status(200).json({ message: "Image removed from album." });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.profileMovetoAlbumFriend = async (req, res) => {
  try {
    const { user_id, albumid, useralbumId, profilepost } = req.body;

    db.query(
      "SELECT * FROM usersalbum WHERE user_id = ? AND id = ?",
      [user_id, useralbumId],
      (albumErr, albumRows) => {
        if (albumErr) {
          return res
            .status(500)
            .json({ message: "Error fetching album", error: albumErr });
        }

        if (albumRows.length === 0) {
          return res.status(404).json({ message: "Album not found." });
        }

        let imagesArraydel = JSON.parse(albumRows[0].images || "[]");
        db.query(
          "SELECT * FROM usersalbum WHERE user_id = ? AND album_id = ?",
          [user_id, albumid],
          (albumErr, albumRowss) => {
            let imagesArray = JSON.parse(albumRowss[0].images || "[]");

            // The new image as a string
            const newImage = profilepost;

            // Add new image if it's not already in the array
            if (!imagesArray.includes(newImage)) {
              imagesArray.push(newImage);
            }

            db.query(
              "UPDATE usersalbum SET images = ? WHERE user_id = ? AND album_id = ?",
              [JSON.stringify(imagesArray), user_id, albumid],
              (updateErr) => {
                if (updateErr) {
                  return res.status(500).json({
                    message: "Error updating album",
                    error: updateErr,
                  });
                }
              }
            );
            console.log(imagesArraydel.length);
            if (imagesArraydel.length === 1) {
              db.query(
                "DELETE FROM usersalbum WHERE user_id = ? AND id = ?",
                [user_id, useralbumId],
                (deleteErr) => {}
              );
            }
            let imagesArrayup = imagesArraydel.filter(
              (img) => img !== profilepost
            );
            db.query(
              "UPDATE usersalbum SET images = ? WHERE user_id = ? AND id = ?",
              [JSON.stringify(imagesArrayup), user_id, useralbumId],
              (updateErr) => {
                if (updateErr) {
                  return res.status(500).json({
                    message: "Error updating album",
                    error: updateErr,
                  });
                }
              }
            );
          }
        );

        return res.status(200).json({ message: "Image removed from album." });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getPageEditAlbums = async (req, res) => {
  try {
    // Ensure user_id and to_id are provided
    const { user_id } = req.body; // Destructure user_id and to_id

    // Query to fetch chat messages between user_id and to_id
    const query = `SELECT albums.*,usersalbum.images,coverphoto.image_url as cover_image FROM albums LEFT JOIN usersalbum ON albums.id = usersalbum.album_id LEFT JOIN coverphoto ON coverphoto.usersalbum_id = albums.id   WHERE albums.user_id = ?;`;

    // Fetching the messages
    db.query(query, [user_id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      // Sending the chat messages in the response
      return res.status(200).json({ results });
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.grouplikepostgrouppage = async (req, res) => {
  const { user_id, id } = req.body;
  const wss = req.wss;
  const date = moment
    .tz(new Date(), "Europe/Oslo")
    .format("YYYY-MM-DD HH:mm:ss");
  db.query(`SELECT * FROM group_post WHERE  id = ?`, [id], (err, results) => {
    console.log(results, req.body);
    if (results.length > 0) {
      const group_id = results[0].group_id;
      const post_id = id;
      db.query(
        `SELECT * FROM group_post_favourite WHERE user_id = ? AND group_id = ? AND post_id = ?`,
        [user_id, group_id, post_id],
        (err, results) => {
          if (err) {
            console.error("Database query error:", err);
            return res
              .status(500)
              .json({ message: "Database query error", error: err });
          }

          // Function to handle notifications and broadcasting
          const sendNotificationsAndBroadcast = (event, messageData) => {
            const broadcastMessage = JSON.stringify({
              event,
              ...messageData,
            });
            // Send broadcast message to WebSocket clients
            if (wss) {
              wss.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                  client.send(broadcastMessage);
                }
              });
            }
          };

          // Handle deletion of favourite post
          if (results.length > 0) {
            db.query(
              `DELETE FROM group_post_favourite WHERE user_id = ? AND group_id = ? AND post_id = ?`,
              [user_id, group_id, post_id],
              (deleteErr) => {
                if (deleteErr) {
                  console.error("Database delete error:", deleteErr);
                  return res.status(500).json({
                    message: "Database delete error",
                    error: deleteErr,
                  });
                }

                sendNotificationsAndBroadcast("groupfav", { post_id });

                // Fetch group info for logging
                db.query(
                  `SELECT * FROM \`groups\` WHERE id = ?`,
                  [group_id],
                  (err, row) => {
                    if (err) {
                      return res.status(500).json({
                        message: "Database query error",
                        error: err,
                      });
                    }
                    logActivity(
                      user_id,
                      `disliked a post in the group ${row[0].name}`
                    );
                  }
                );

                return res.status(200).json({
                  message: "Event Favourite post deleted successfully.",
                  status: "2",
                });
              }
            );
          } else {
            // If not exists, insert a new record
            db.query(
              `INSERT INTO group_post_favourite (post_id, user_id, group_id, fav, date) VALUES (?, ?, ?, ?, ?)`,
              [post_id, user_id, group_id, "Like", date],
              (insertErr) => {
                if (insertErr) {
                  console.error("Database insert error:", insertErr);
                  return res.status(500).json({
                    message: "Database insert error",
                    error: insertErr,
                  });
                }

                sendNotificationsAndBroadcast("groupfav", { post_id });

                // Fetch group info for logging
                db.query(
                  `SELECT * FROM \`groups\` WHERE id = ?`,
                  [group_id],
                  (err, row) => {
                    if (err) {
                      return res
                        .status(500)
                        .json({ message: "Database query error", error: err });
                    }
                    const gname = row[0].name;
                    const slug = row[0].slug;
                    logActivity(user_id, `liked a post in the group ${gname}`);

                    // Handle friend request notifications
                    db.query(
                      `SELECT * FROM group_member WHERE group_id = ? And user_id != ?`,
                      [group_id, user_id],
                      (err, results) => {
                        // Retrieve the friend requests
                        const allusers = results;
                        const notificationMessage = `liked a post in the group ${gname}`;
                        const date = moment
                          .tz(new Date(), "Europe/Oslo")
                          .format("YYYY-MM-DD HH:mm:ss");
                        const link_href = `/group/${slug}`;
                        const link_hrefurl = `https://amourette.no/group/${slug}`;

                        // Fetch the username and email of the user who sent the request
                        db.query(
                          `SELECT * FROM users WHERE id = ?`,
                          [user_id],
                          async (err, senderResult) => {
                            if (err) {
                              return res.status(500).json({
                                message: "Error fetching user data for sender",
                                error: err,
                              });
                            }

                            const senderUsername = senderResult[0].username;
                            allusers.forEach((item) => {
                              db.query(
                                `SELECT * FROM users WHERE id = ?`,
                                [user_id],
                                async (err, senderResultss) => {
                                  db.query(
                                    "INSERT INTO notification (user_id, to_id, message, date, link_href) VALUES (?, ?, ?, ?, ?)",
                                    [
                                      item.user_id,
                                      user_id,
                                      notificationMessage,
                                      date,
                                      link_href,
                                    ],
                                    (err, result) => {
                                      if (err) {
                                        console.error(
                                          "Database insertion error:",
                                          err
                                        );
                                      } else {
                                      }
                                    }
                                  );

                                  if (
                                    senderResultss[0]
                                      .notification_group_event === "Yes"
                                  ) {
                                    sendEmailFor_postLikeCreateNotification(
                                      link_hrefurl,
                                      gname,
                                      senderResultss[0].email,
                                      senderResultss[0].username,
                                      senderUsername
                                    );
                                  }
                                }
                              );
                            });
                            res.status(200).json({
                              message:
                                "Event Favourite post added successfully.",
                            });

                            // Insert notifications for each user
                          }
                        );
                      }
                    );
                  }
                );
              }
            );
          }
        }
      );
    }
  });
};
async function sendEmailFor_postLikeCreateNotification(
  url,
  gname,
  to,
  name,
  fromby,
  callback
) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf", // Consider using environment variables here for security
    },
  });

  const mailOptions = {
    from: "Amourette <amourette.no@gmail.com>",
    to: to,
    subject: `Group post liked by ${fromby} on Amourette!`,
    text: `Hello,\n\nExciting news! A post in the group "${gname}" has been liked by ${fromby}.\n\nJoin the conversation, explore the latest creations, and share your thoughts.\n\nBest regards,\nThe Amourette Team`,
    html: `
  <p>Hello ${name},</p>
  <p>Exciting news! A post in the group "<strong>${gname}</strong>" has been commented by <strong>${fromby}</strong>.</p>
  <p><a href="${url}" target="_blank" style="color: #1a73e8;">Click here to view the post</a></p>
  <p>Join the conversation, explore the latest creations, and share your thoughts.</p>
  <p>Best regards,<br>The Amourette Team</p>
`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (callback) {
      callback(error, info);
    }
  });
}
exports.forumlikepostforumpage = async (req, res) => {
  try {
    const { user_id, id: post_id } = req.body; // consistent use of `post_id`

    const query = `SELECT * from form_post_favourite where user_id = ? AND post_id = ?`;
    db.query(query, [user_id, post_id], (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      const date = moment
        .tz(new Date(), "Europe/Oslo")
        .format("YYYY-MM-DD HH:mm:ss");

      if (results.length > 0) {
        const deleteQuery = `DELETE FROM form_post_favourite WHERE user_id = ? AND post_id = ?`;
        db.query(deleteQuery, [user_id, post_id], (deleteErr) => {
          if (deleteErr) {
            return res
              .status(500)
              .json({ message: "Database delete error", error: deleteErr });
          }

          handleBroadcastForumPostLike(user_id, post_id, wss, date, "out", res);
        });
      } else {
        const insertQuery = `INSERT INTO form_post_favourite (user_id, post_id, date) VALUES (?, ?, ?)`;
        db.query(insertQuery, [user_id, post_id, date], (insertErr) => {
          if (insertErr) {
            return res
              .status(500)
              .json({ message: "Database insertion error", error: insertErr });
          }

          handleBroadcastForumPostLike(user_id, post_id, wss, date, "in", res);
        });
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

function handleBroadcastForumPostLike(user_id, post_id, wss, date, ch, res) {
  if (ch === "in") {
    const query = `
      SELECT u.*, CASE WHEN fr.status = 'Yes' THEN true ELSE false END AS is_friend
      FROM users u
      JOIN friendRequest_accept fr
        ON (u.id = fr.sent_to AND fr.user_id = ?) OR (u.id = fr.user_id AND fr.sent_to = ?)
      WHERE fr.status = 'Yes'`;

    db.query(query, [user_id, user_id], (err, friends) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      // Fetch sender details
      db.query(
        `SELECT * FROM users WHERE id = ?`,
        [user_id],
        (err, senderResult) => {
          if (err || senderResult.length === 0) {
            return res
              .status(500)
              .json({ message: "Error fetching sender info", error: err });
          }

          db.query(
            `SELECT * FROM forum WHERE id = ?`,
            [post_id],
            async (err, postResult) => {
              if (err || postResult.length === 0) {
                return res
                  .status(500)
                  .json({ message: "Post not found", error: err });
              }

              const forumName = postResult[0].name || "Forum";
              const forumSlug = postResult[0].slug || "";

              logActivity(
                user_id,
                ` liked your post in the forum ${forumName}`
              );

              const message = ` liked your post in the forum ${forumName}`;
              const link_href = "/singleforums/" + forumSlug;

              const insertNotifications = friends.map((friend) => {
                return new Promise((resolve, reject) => {
                  db.query(
                    "INSERT INTO notification (post_id, user_id, to_id, message, date, link_href) VALUES (?, ?, ?, ?, ?, ?)",
                    [
                      postResult[0].id,
                      friend.id,
                      user_id,
                      message,
                      date,
                      link_href,
                    ],
                    (err, result) => {
                      if (err) reject(err);
                      else resolve(result);
                    }
                  );
                });
              });

              try {
                await Promise.all(insertNotifications);

                // ✅ Respond to client immediately
                res.status(200).json({ message: "Successfully created." });

                // ✅ Continue work (emails + broadcast) in background
                setImmediate(async () => {
                  try {
                    const emailPromises = friends.map(async (friend) => {
                      if (friend.notification_message === "Yes") {
                        await sendEmailFor_postlikeForum(
                          friend.email,
                          friend.username,
                          senderResult[0].username,
                          forumName
                        );
                      }
                    });

                    await Promise.all(emailPromises);

                    // ✅ WebSocket Broadcast
                    const broadcastMessage = JSON.stringify({
                      event: "forumPost_like",
                      user_id: user_id,
                      LoginData: senderResult[0],
                    });

                    if (wss) {
                      wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                          client.send(broadcastMessage);
                        }
                      });
                    }
                  } catch (err) {
                    console.error("Background task failed:", err);
                  }
                });
              } catch (error) {
                return res
                  .status(500)
                  .json({ message: "Notification creation failed", error });
              }
            }
          );
        }
      );
    });
  } else {
    if (ch === "out") {
      const deleteQuery = `DELETE FROM notification WHERE to_id = ? AND post_id = ?`;
      db.query(deleteQuery, [user_id, post_id], (deleteErr) => {
        if (deleteErr) {
          return res
            .status(500)
            .json({ message: "Database delete error", error: deleteErr });
        }
      });
    }
    // Like removed — optionally broadcast or just respond
    return res.status(200).json({
      message: "Post like removed successfully.",
      status: "1",
    });
  }
}

async function sendEmailFor_postlikeForum(too, name, byname, forumName) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf", // Use environment variables for sensitive data
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: too,
    subject: `Post was liked by ${byname}`, // Updated subject to reflect post like
    text: `Hello ${name},\n\nWe're excited to let you know that your post in the forum ${forumName} was liked by ${byname} on Amourette.\n\nKeep sharing and stay connected!\n\nBest regards,\nThe Amourette Team`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response);
  } catch (error) {
    console.error("Error sending email:", error);
  }
}

exports.getuseralbumFile = async (req, res) => {
  try {
    const { user_id, id, file } = req.body;
    db.query(
      `SELECT 
    usersalbum.*, 
    users.username, 
    users.profile_image, 
    users.id AS uid,
    COUNT(usersalbumfavourite.id) AS total_favourites,
    useralbum_file_datetime.date as realdate
FROM usersalbum 
JOIN users ON users.id = usersalbum.user_id 
LEFT JOIN usersalbumfavourite 
    ON usersalbum.id = usersalbumfavourite.usersalbum_id 
    AND usersalbumfavourite.image_url = ?
LEFT JOIN useralbum_file_datetime 
    ON useralbum_file_datetime.useralbum_id = usersalbum.id 
    AND useralbum_file_datetime.image_url = ?
WHERE usersalbum.user_id = ? 
  AND usersalbum.id = ?
GROUP BY usersalbum.id;
`,
      [file, file, user_id, id],
      (albumErr, results) => {
        if (albumErr || results.length === 0) {
          return res.status(200).json({
            message: "Album not found",
            matched: false,
            error: albumErr,
          });
        }

        let imagesArray = [];
        try {
          imagesArray = JSON.parse(results[0].images || "[]");
        } catch (parseErr) {
          return res.status(500).json({
            message: "Error parsing images array",
            error: parseErr,
          });
        }

        const matchedFile = imagesArray.find((img) => img === file);

        if (matchedFile) {
          return res.status(200).json({
            matched: true,
            image: matchedFile,
            results: results[0], // this now includes total_likes
          });
        } else {
          return res.status(404).json({
            matched: false,
            message: "File not found in album",
          });
        }
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getUseralbumsComments = async (req, res) => {
  try {
    const { user_id, id, file } = req.body;

    // Debug log
    console.log("Request Body:", req.body);

    db.query(
      `
      SELECT 
        usersalbum.*, 
        users.username, 
        users.profile_image, 
        users.id AS uid,
        users.makeImagePrivate AS makeImagePrivate,
        usersalbumcomment.id AS comment_id,
        usersalbumcomment.message AS comment,
        usersalbumcomment.date AS comment_date,
        usersalbumcomment.user_id AS comment_user_id,
        userscommenter.username AS commenter_name,
        userscommenter.profile_image AS commenter_image
      FROM usersalbum 
      JOIN users ON users.id = usersalbum.user_id 
      LEFT JOIN usersalbumcomment 
        ON usersalbum.id = usersalbumcomment.usersalbum_id 
        AND usersalbumcomment.image_url = ?
      LEFT JOIN users AS userscommenter
        ON usersalbumcomment.user_id = userscommenter.id
      WHERE usersalbum.user_id = ? 
        AND usersalbum.id = ?
      ORDER BY usersalbumcomment.date ASC
      `,
      [file, user_id, id],
      (albumErr, results) => {
        if (albumErr) {
          console.error("Album Error:", albumErr);
          return res.status(500).json({
            success: false,
            message: "Error retrieving album or comments",
            error: albumErr,
          });
        }

        if (results.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Album not found",
          });
        }

        // Prepare the album info
        const albumInfo = {
          id: results[0].id,
          title: results[0].title,
          description: results[0].description,
          username: results[0].username,
          profile_image: results[0].profile_image,
          uid: results[0].uid,
          images: results[0].images ? JSON.parse(results[0].images) : [],
          comments: results
            .filter((r) => r.comment_id !== null) // Only actual comments
            .map((r) => ({
              id: r.comment_id,
              message: r.comment,
              date: r.comment_date,
              user_id: r.comment_user_id,
              makeImagePrivate: r.makeImagePrivate,
              commenter_name: r.commenter_name,
              commenter_image: r.commenter_image,
            })),
        };

        return res.status(200).json({
          success: true,
          album: albumInfo,
        });
      }
    );
  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error,
    });
  }
};
exports.UserPhotoCommentSave = async (req, res) => {
  const wss = req.wss;
  console.log("lk");
  try {
    const { user_id, comment_id, description, image_url } = req.body;

    db.query(
      `SELECT * FROM usersalbum WHERE id = ?`,
      [comment_id],
      (albumErr, results) => {
        const checkuni = results;
        const albumId = results[0].album_id;
        if (results.length > 0) {
          if (
            results[0].visibility !== "Private_visible" &&
            results[0].album_id !== 0
          ) {
            const albumId = results[0].album_id;

            db.query(
              `SELECT * FROM gallery WHERE album_id = ? AND image = ?`,
              [albumId, image_url],
              (err, galleryresults) => {
                if (galleryresults.length > 0) {
                  const gallery_id = galleryresults[0].id;
                  const date = moment
                    .tz(new Date(), "Europe/Oslo")
                    .format("YYYY-MM-DD HH:mm:ss");

                  db.query(
                    `INSERT INTO gallery_comment (gallery_id, user_id, description, date) VALUES (?, ?, ?, ?)`,
                    [gallery_id, user_id, description, date],
                    (err, commentResult) => {
                      if (err) {
                        return res.status(500).json({
                          message: "Failed to insert comment",
                          error: err,
                        });
                      }

                      const commentId = commentResult.insertId;

                      db.query(
                        `SELECT username, profile_image, makeImagePrivate FROM users WHERE id = ?`,
                        [user_id],
                        (err, userResult) => {
                          if (err || userResult.length === 0) return;

                          const { username, profile_image, makeImagePrivate } =
                            userResult[0];

                          const broadcastMessage = JSON.stringify({
                            event: "GalleryPost",
                            user_id,
                            gallery_id,
                            username,
                            message: description,
                            makeImagePrivate,
                            date,
                            profile_image,
                            lastInsertId: commentId,
                          });

                          if (wss) {
                            wss.clients.forEach((client) => {
                              if (client.readyState === WebSocket.OPEN) {
                                client.send(broadcastMessage);
                              }
                            });
                          }

                          const gname = galleryresults[0].name;
                          const byuser = galleryresults[0].user_id;

                          db.query(
                            `SELECT username FROM users WHERE id = ?`,
                            [byuser],
                            (err, byUserResult) => {
                              if (err) return;
                              const byUsername =
                                byUserResult[0]?.username || "Unknown User";

                              logActivity(
                                user_id,
                                `commented on the gallery ${gname}`
                              );

                              const friendQuery = `
                                SELECT u.*, CASE WHEN fr.status = 'Yes' THEN true ELSE false END AS is_friend
                                FROM users u
                                JOIN friendRequest_accept fr ON
                                  (u.id = fr.sent_to AND fr.user_id = ?) OR
                                  (u.id = fr.user_id AND fr.sent_to = ?)
                                WHERE fr.status = 'Yes';
                              `;

                              db.query(
                                friendQuery,
                                [user_id, user_id],
                                async (err, friends) => {
                                  if (err || friends.length === 0) return;

                                  const wsNotification = JSON.stringify({
                                    event: "eventrequest_acceptnotification",
                                    user_id: friends,
                                    LoginData: friends,
                                  });

                                  if (wss) {
                                    wss.clients.forEach((client) => {
                                      if (
                                        client.readyState === WebSocket.OPEN
                                      ) {
                                        client.send(wsNotification);
                                      }
                                    });
                                  }

                                  db.query(
                                    `SELECT username, email, notification_news_update FROM users WHERE id = ?`,
                                    [user_id],
                                    async (err, senderResult) => {
                                      if (err || senderResult.length === 0)
                                        return;

                                      const senderUsername =
                                        senderResult[0].username;
                                      const notificationMessage = `commented on the post by ${byUsername}`;
                                      const link_href = "/allgallery";

                                      const notificationInserts = friends.map(
                                        (friend) => {
                                          return new Promise(
                                            (resolve, reject) => {
                                              // db.query(
                                              //   `INSERT INTO notification (user_id, to_id, message, date, link_href, post_id) VALUES (?, ?, ?, ?, ?, ?)`,
                                              //   [
                                              //     friend.id,
                                              //     user_id,
                                              //     notificationMessage,
                                              //     date,
                                              //     link_href,
                                              //     gallery_id,
                                              //   ],
                                              //   (err) =>
                                              //     err ? reject(err) : resolve()
                                              // );
                                            }
                                          );
                                        }
                                      );

                                      try {
                                        await Promise.all(notificationInserts);

                                        const emailPromises = friends.map(
                                          async (friend) => {
                                            if (
                                              friend.notification_news_update ===
                                              "Yes"
                                            ) {
                                              // await sendEmailFor_postcommentNotification(
                                              //   friend.email,
                                              //   friend.username,
                                              //   senderUsername
                                              // );
                                            }
                                          }
                                        );

                                        await Promise.all(emailPromises);
                                      } catch (e) {
                                        console.error(
                                          "Notification or email error:",
                                          e
                                        );
                                      }
                                    }
                                  );
                                }
                              );
                            }
                          );
                        }
                      );
                    }
                  );
                }
              }
            );
          }
        }

        const insertQuery = `INSERT INTO usersalbumcomment (user_id, image_url, usersalbum_id, message, date) VALUES (?, ?, ?, ?, ?)`;
        const date = moment
          .tz(new Date(), "Europe/Oslo")
          .format("YYYY-MM-DD HH:mm:ss");

        db.query(
          insertQuery,
          [user_id, image_url, comment_id, description, date],
          (err, result) => {
            if (err) {
              return res
                .status(500)
                .json({ message: "Database insertion error", error: err });
            }

            const insertedCommentId = result.insertId;

            const fetchQuery = `
          SELECT 
            usersalbumcomment.id,
            usersalbumcomment.message,
            usersalbumcomment.date,
            usersalbumcomment.usersalbum_id,
            usersalbumcomment.user_id,
            users.makeImagePrivate,
            users.username AS commenter_name,
            users.profile_image AS commenter_image
          FROM usersalbumcomment
          JOIN users ON users.id = usersalbumcomment.user_id
          WHERE usersalbumcomment.id = ?
        `;

            db.query(
              fetchQuery,
              [insertedCommentId],
              (fetchErr, fetchResults) => {
                if (fetchErr) {
                  return res.status(500).json({
                    message: "Error fetching inserted comment",
                    error: fetchErr,
                  });
                }

                if (wss) {
                  const broadcastMessage = JSON.stringify({
                    event: "UserAlbumComments",
                    comment: fetchResults[0],
                    comment_id: comment_id,
                    insertedCommentId: insertedCommentId,
                  });

                  wss.clients.forEach((client) => {
                    if (client.readyState === WebSocket.OPEN) {
                      client.send(broadcastMessage);
                    }
                  });
                }

                const userQuery = `SELECT username, profile_image, makeImagePrivate FROM users WHERE id = ?`;

                db.query(userQuery, [user_id], (err, userResult) => {
                  if (err || userResult.length === 0) {
                    return res.status(500).json({
                      message: "User not found or query error",
                      error: err,
                    });
                  }

                  const query = `SELECT usersalbum.*, albums.name AS album_name FROM usersalbum LEFT JOIN albums ON albums.id = usersalbum.album_id WHERE usersalbum.id = ?`;

                  db.query(query, [comment_id], (err, row) => {
                    if (err) {
                      return res
                        .status(500)
                        .json({ message: "Database query error", error: err });
                    }

                    const gname = row[0].album_name;
                    const albumidd = row[0].album_id;
                    const byuser = row[0].user_id;

                    db.query(
                      `SELECT username FROM users WHERE id = ?`,
                      [byuser],
                      (err, byUserResult) => {
                        if (err) {
                          return res.status(500).json({
                            message: "Error fetching post owner username",
                            error: err,
                          });
                        }

                        const byUsername =
                          byUserResult[0]?.username || "Unknown User";
                        logActivity(user_id, `commented on the album ${gname}`);

                        const query = `
                  SELECT u.*, CASE WHEN fr.status = 'Yes' THEN true ELSE false END AS is_friend
                  FROM users u
                  JOIN friendRequest_accept fr
                  ON (u.id = fr.sent_to AND fr.user_id = ?) OR (u.id = fr.user_id AND fr.sent_to = ?)
                  WHERE fr.status = 'Yes';
                `;

                        db.query(query, [user_id, user_id], (err, results) => {
                          if (err) {
                            return res.status(500).json({
                              message: "Database query error",
                              error: err,
                            });
                          }
                          db.query(
                            `SELECT * FROM gallery WHERE album_id = ? AND image = ?`,
                            [albumidd, image_url],
                            (err, galleryresults) => {
                              if (galleryresults.length > 0) {
                                var link_href = "/allgallery";
                                var pid = galleryresults[0].id;
                              } else {
                                var link_href = "/previewimages";
                                var pid = albumidd;
                              }
                              db.query(
                                `SELECT * FROM users WHERE id = ?`,
                                [user_id],
                                async (err, senderResult) => {
                                  if (err) {
                                    return res.status(500).json({
                                      message: "Error fetching username",
                                      error: err,
                                    });
                                  }

                                  const senderUsername =
                                    senderResult[0]?.username || "Unknown User";
                                  const senderEmail =
                                    senderResult[0]?.email || "";
                                  const notificationGroupEvent =
                                    senderResult[0]?.notification_show_activity;
                                  const notificationMessage = `commented on the album by ${gname}`;
                                  const date = moment
                                    .tz(new Date(), "Europe/Oslo")
                                    .format("YYYY-MM-DD HH:mm:ss");

                                  const insertNotificationsPromises =
                                    results.map((item) => {
                                      return new Promise((resolve, reject) => {
                                        if (galleryresults.length > 0) {
                                          db.query(
                                            "INSERT INTO notification (user_id, to_id, message, date, link_href, post_id) VALUES (?, ?, ?, ?, ?, ?)",
                                            [
                                              item.id,
                                              user_id,
                                              notificationMessage,
                                              date,
                                              link_href,
                                              pid,
                                            ],
                                            (err, result) => {
                                              if (err) {
                                                console.error(
                                                  "Database insertion error:",
                                                  err
                                                );
                                                reject(err);
                                              } else {
                                                resolve(result);
                                              }
                                            }
                                          );
                                        } else {
                                          db.query(
                                            "INSERT INTO notification (image_url,user_id, to_id, message, date, link_href, post_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
                                            [
                                              image_url,
                                              item.id,
                                              user_id,
                                              notificationMessage,
                                              date,
                                              link_href,
                                              pid,
                                            ],
                                            (err, result) => {
                                              if (err) {
                                                console.error(
                                                  "Database insertion error:",
                                                  err
                                                );
                                                reject(err);
                                              } else {
                                                resolve(result);
                                              }
                                            }
                                          );
                                        }
                                      });
                                    });

                                  try {
                                    await Promise.all(
                                      insertNotificationsPromises
                                    );

                                    const emailPromises = results.map(
                                      async (item) => {
                                        if (
                                          item.notification_news_update ===
                                          "Yes"
                                        ) {
                                          await sendEmailFor_postcommentNotification(
                                            item.email,
                                            item.username,
                                            senderUsername
                                          );
                                        }
                                      }
                                    );

                                    await Promise.all(emailPromises);

                                    return res.status(200).json({
                                      message:
                                        "Comment saved and notifications sent",
                                    });
                                  } catch (e) {
                                    return res.status(500).json({
                                      message: "Error sending notifications",
                                      error: e,
                                    });
                                  }
                                }
                              );
                            }
                          );
                        });
                      }
                    );
                  });
                });
              }
            );
          }
        );
      }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    return res.status(500).json({ message: "Internal server error", error });
  }
};
async function sendEmailFor_postcommentUserAlbum(gname, too, name, byname) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf", // It's better to use environment variables here
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: too, // use dynamic recipient email
    subject: `${byname} commented on album "${gname}"`, // Dynamic album name and commenter name
    text:
      `Hello ${name},\n\n` +
      `We are excited to inform you that ${byname} has commented on album "${gname}" on Amourette.\n\n` +
      `Stay active and keep engaging with the community!\n\n` +
      `Best regards,\n` +
      `The Amourette Team`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response);
  } catch (error) {
    console.error("Error sending email:", error);
  }
}

exports.getUseralbumsCommentsSeperate = async (req, res) => {
  try {
    const { commentid, id } = req.body;
    console.log(req.body);

    // Query the database to fetch the album and comment details
    db.query(
      `SELECT 
        usersalbum.*, 
        users.username, 
        users.profile_image, 
        users.id AS uid,
        users.makeImagePrivate AS makeImagePrivate,
        usersalbumcomment.id AS comment_id,
        usersalbumcomment.message AS comment,
        usersalbumcomment.date AS comment_date,
        usersalbumcomment.user_id AS comment_user_id,
        userscommenter.username AS commenter_name,
        userscommenter.profile_image AS commenter_image
      FROM usersalbum 
      JOIN users ON users.id = usersalbum.user_id 
      LEFT JOIN usersalbumcomment 
        ON usersalbum.id = usersalbumcomment.usersalbum_id 
        AND usersalbumcomment.id = ?
      LEFT JOIN users AS userscommenter
        ON usersalbumcomment.user_id = userscommenter.id
      WHERE usersalbum.id = ?
      ORDER BY usersalbumcomment.date ASC`,
      [id, commentid],
      (albumErr, results) => {
        if (albumErr) {
          console.error("Album Error:", albumErr);
          return res.status(500).json({
            success: false,
            message: "Error retrieving album or comments",
            error: albumErr,
          });
        }
        console.log(results);
        // Check if no results were found
        if (!results || results.length === 0) {
          console.log("No comment found for the given id and commentid.");
          return res.status(404).json({
            success: false,
            message: "Comment not found",
          });
        }

        // Prepare the album info with the comment details
        const albumInfo = {
          id: results[0].id,
          title: results[0].title,
          description: results[0].description,
          username: results[0].username,
          profile_image: results[0].profile_image,
          uid: results[0].uid,
          images: results[0].images ? JSON.parse(results[0].images) : [],
          comments: results
            .filter((r) => r.comment_id !== null) // Only actual comments
            .map((r) => ({
              id: r.comment_id,
              message: r.comment,
              date: r.comment_date,
              user_id: r.comment_user_id,
              makeImagePrivate: r.makeImagePrivate,
              commenter_name: r.commenter_name,
              commenter_image: r.commenter_image,
            })),
        };

        // Return the response with the album and its comments
        return res.status(200).json({
          success: true,
          album: albumInfo,
        });
      }
    );
  } catch (error) {
    console.error("Server Error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error,
    });
  }
};

exports.UseralbumPostLike = async (req, res) => {
  const { id, user_id, image_url } = req.body;
  const wss = req.wss;

  if (!id || !user_id) {
    return res.status(400).json({ message: "ID and User ID are required." });
  }

  let responseSent = false;

  const safeSend = (data, status = 200) => {
    if (!responseSent) {
      responseSent = true;
      return res.status(status).json(data);
    }
  };

  try {
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");
    let checkLink = "";
    // First part: check usersalbum visibility and handle gallery logic
    db.query(
      `SELECT * FROM usersalbum WHERE id = ?`,
      [id],
      (albumErr, results) => {
        if (albumErr) {
          return safeSend(
            { message: "Database query error", error: albumErr },
            500
          );
        }

        if (results.length > 0) {
          if (
            results[0].visibility !== "Private_visible" &&
            results[0].album_id !== 0
          ) {
            const albumId = results[0].album_id;
            checkLink = "1";
            db.query(
              `SELECT * FROM gallery WHERE album_id = ? AND image = ?`,
              [albumId, image_url],
              (err, galleryresults) => {
                if (err)
                  return safeSend(
                    { message: "Gallery query error", error: err },
                    500
                  );
                if (galleryresults.length > 0) {
                  const gallery_id = galleryresults[0].id;

                  const checkExistsQuery = `SELECT * FROM gallery_favourite WHERE user_id = ? AND gallery_id = ?`;
                  db.query(
                    checkExistsQuery,
                    [user_id, gallery_id],
                    (err, row) => {
                      if (err)
                        return safeSend(
                          { message: "Database query error", error: err },
                          500
                        );

                      if (row.length > 0) {
                        const deleteQuery = `DELETE FROM gallery_favourite WHERE user_id = ? AND gallery_id = ?`;
                        db.query(
                          deleteQuery,
                          [user_id, gallery_id],
                          (deleteErr) => {
                            if (deleteErr)
                              return safeSend(
                                { message: "Delete error", error: deleteErr },
                                500
                              );
                            handleBroadcast_Useralbum(
                              user_id,
                              gallery_id,
                              wss,
                              date,
                              res,
                              "out"
                            );
                          }
                        );
                      } else {
                        const insertQuery = `INSERT INTO gallery_favourite (gallery_id, user_id, date) VALUES (?, ?, ?)`;
                        db.query(
                          insertQuery,
                          [gallery_id, user_id, date],
                          (insertErr) => {
                            if (insertErr)
                              return safeSend(
                                { message: "Insert error", error: insertErr },
                                500
                              );
                            handleBroadcast_Useralbum(
                              user_id,
                              gallery_id,
                              wss,
                              date,
                              res,
                              "in"
                            );
                          }
                        );
                      }
                    }
                  );
                }
              }
            );
          }
        }
      }
    );

    // Second part: check usersalbumfavourite
    const checkExistsQuery = `SELECT * FROM usersalbumfavourite WHERE user_id = ? AND usersalbum_id = ? AND image_url = ?`;
    db.query(checkExistsQuery, [user_id, id, image_url], (err, row) => {
      if (err)
        return safeSend({ message: "Database query error", error: err }, 500);

      if (row.length > 0) {
        const deleteQuery = `DELETE FROM usersalbumfavourite WHERE user_id = ? AND usersalbum_id = ? AND image_url = ?`;
        db.query(deleteQuery, [user_id, id, image_url], (deleteErr) => {
          if (deleteErr)
            return safeSend({ message: "Delete error", error: deleteErr }, 500);
          handleBroadcastAlbumPhotoPostLike(
            user_id,
            id,
            wss,
            date,
            res,
            image_url,
            "out",
            safeSend,
            checkLink
          );
        });
      } else {
        const insertQuery = `INSERT INTO usersalbumfavourite (usersalbum_id, user_id, image_url) VALUES (?, ?, ?)`;
        db.query(insertQuery, [id, user_id, image_url], (insertErr) => {
          if (insertErr)
            return safeSend({ message: "Insert error", error: insertErr }, 500);
          handleBroadcastAlbumPhotoPostLike(
            user_id,
            id,
            wss,
            date,
            res,
            image_url,
            "in",
            safeSend,
            checkLink
          );
        });
      }
    });
  } catch (error) {
    console.error("Event retrieval error:", error);
    safeSend({ message: "Event retrieval error", error }, 500);
  }
};

const UseralbumPostLike_dashboardEnd = async (
  id,
  user_id,
  image_url,
  wss,
  res
) => {
  if (!id || !user_id) {
    return res.status(400).json({ message: "ID and User ID are required." });
  }
  let responseSent = false;

  const safeSend = (data, status = 200) => {
    if (!responseSent) {
      responseSent = true;
      return res.status(status).json(data);
    }
  };

  try {
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");
    let checkLink = "SELECT * FROM usersalbum WHERE album_id=?";
    db.query(checkLink, [id], (err, row) => {
      if (err) {
        return safeSend({ message: "Database query error", error: err }, 500);
      }
      const checkExistsQuery = `
        SELECT * FROM usersalbumfavourite 
        WHERE user_id = ? AND usersalbum_id = ? AND image_url = ?
      `;
      const id = row[0].id;
      db.query(checkExistsQuery, [user_id, id, image_url], (err, row) => {
        if (err) {
          return safeSend({ message: "Database query error", error: err }, 500);
        }

        if (row.length > 0) {
          // Already liked, so remove
          const deleteQuery = `
          DELETE FROM usersalbumfavourite 
          WHERE user_id = ? AND usersalbum_id = ? AND image_url = ?
        `;
          db.query(deleteQuery, [user_id, id, image_url], (deleteErr) => {
            if (deleteErr) {
              return safeSend(
                { message: "Delete error", error: deleteErr },
                500
              );
            }

            console.log("Removed like from album photo.");
            handleBroadcastAlbumPhotoPostLike_DashboardEnd(
              user_id,
              id,
              wss,
              date,
              res,
              image_url,
              "out",
              checkLink
            );
          });
        } else {
          // Not liked, insert
          const insertQuery = `
          INSERT INTO usersalbumfavourite (usersalbum_id, user_id, image_url) 
          VALUES (?, ?, ?)
        `;
          db.query(insertQuery, [id, user_id, image_url], (insertErr) => {
            if (insertErr) {
              return safeSend(
                { message: "Insert error", error: insertErr },
                500
              );
            }

            console.log("Inserted like for album photo.");
            handleBroadcastAlbumPhotoPostLike_DashboardEnd(
              user_id,
              id,
              wss,
              date,
              res,
              image_url,
              "in",
              checkLink
            );
          });
        }
      });
    });
  } catch (error) {
    console.error("Event retrieval error:", error);
    safeSend({ message: "Event retrieval error", error }, 500);
  }
};

function handleBroadcastAlbumPhotoPostLike_DashboardEnd(
  user_id,
  post_id,
  wss,
  date,
  res,
  image_url,
  ch,
  chklink
) {
  const safeSend = (data, status = 200) => {
    if (!res.headersSent) {
      return res.status(status).json(data);
    }
  };

  const query = `
    SELECT u.*, CASE WHEN fr.status = 'Yes' THEN true ELSE false END AS is_friend
    FROM users u
    JOIN friendRequest_accept fr
      ON (u.id = fr.sent_to AND fr.user_id = ?) OR (u.id = fr.user_id AND fr.sent_to = ?)
    WHERE fr.status = 'Yes'
  `;

  db.query(query, [user_id, user_id], (err, friends) => {
    if (err) {
      console.error("Friend query error:", err);
    }

    db.query(
      `SELECT * FROM users WHERE id = ?`,
      [user_id],
      (err, senderResult) => {
        if (err || senderResult.length === 0) {
          console.error("Sender not found.");
          return safeSend({ message: "User not found", error: err }, 404);
        }

        db.query(
          `SELECT usersalbum.*, albums.name AS album_name FROM usersalbum 
           LEFT JOIN albums ON albums.id = usersalbum.album_id 
           WHERE usersalbum.id = ?`,
          [post_id],
          async (err, postResult) => {
            if (err || postResult.length === 0) {
              console.error("Album post not found.");
              return safeSend({ message: "Post not found", error: err }, 404);
            }

            const forumName = postResult[0].album_name || "Album";

            try {
              // You can insert notification logic here if needed
              // await Promise.all(insertNotifications); // optional

              // WebSocket broadcast
              setImmediate(() => {
                try {
                  const broadcastMessage = JSON.stringify({
                    event: "AlbumPost_like",
                    user_id,
                    post_id,
                    image_url,
                    type: ch, // 'in' or 'out'
                    forumName,
                    date,
                  });

                  console.log("Broadcasting message to WebSocket clients");

                  if (wss) {
                    wss.clients.forEach((client) => {
                      if (client.readyState === WebSocket.OPEN) {
                        client.send(broadcastMessage);
                      }
                    });
                  }

                  return safeSend({
                    success: true,
                    message: `Post like status updated`,
                    type: ch,
                  });
                } catch (err) {
                  console.error("WebSocket broadcast failed:", err);
                  return safeSend(
                    { message: "Broadcast failed", error: err },
                    500
                  );
                }
              });
            } catch (error) {
              console.error("Background task error:", error);
              return safeSend({ message: "Processing error", error }, 500);
            }
          }
        );
      }
    );
  });
}
function handleBroadcastAlbumPhotoPostLike(
  user_id,
  post_id,
  wss,
  date,
  res,
  image_url,
  ch,
  safeSend,
  chklink
) {
  if (ch === "in") {
    const query = `
      SELECT u.*, CASE WHEN fr.status = 'Yes' THEN true ELSE false END AS is_friend
      FROM users u
      JOIN friendRequest_accept fr
        ON (u.id = fr.sent_to AND fr.user_id = ?) OR (u.id = fr.user_id AND fr.sent_to = ?)
      WHERE fr.status = 'Yes'`;

    db.query(query, [user_id, user_id], (err, friends) => {
      if (err)
        return safeSend({ message: "Friend query error", error: err }, 500);

      db.query(
        `SELECT * FROM users WHERE id = ?`,
        [user_id],
        (err, senderResult) => {
          if (err || senderResult.length === 0)
            return safeSend({ message: "Sender not found", error: err }, 500);

          db.query(
            `SELECT usersalbum.*, albums.name AS album_name FROM usersalbum 
                  LEFT JOIN albums ON albums.id = usersalbum.album_id 
                  WHERE usersalbum.id = ?`,
            [post_id],
            async (err, postResult) => {
              if (err || postResult.length === 0)
                return safeSend({ message: "Post not found", error: err }, 500);

              const forumName = postResult[0].album_name || "Album";
              logActivity(user_id, ` commented post in the album ${forumName}`);
              const message = ` commented post in the album ${forumName}`;
              if (chklink === "1") {
                var link_href = "/dashboard";
              } else {
                var link_href = "";
              }

              const insertNotifications = friends.map((friend) => {
                return new Promise((resolve, reject) => {
                  db.query(
                    "INSERT INTO notification (user_id, to_id, message, date, link_href, post_id) VALUES (?, ?, ?, ?, ?, ?)",
                    [friend.id, user_id, message, date, link_href, post_id],
                    (err, result) => (err ? reject(err) : resolve(result))
                  );
                });
              });

              try {
                await Promise.all(insertNotifications);

                safeSend({ message: "Successfully created." });

                // Run remaining operations in background
                setImmediate(async () => {
                  try {
                    const emailPromises = friends.map((friend) => {
                      if (friend.notification_show_activity === "Yes") {
                        return sendEmailFor_albumlikePhoto(
                          friend.email,
                          friend.username,
                          senderResult[0].username,
                          forumName
                        );
                      }
                    });
                    await Promise.all(emailPromises);

                    const broadcastMessage = JSON.stringify({
                      event: "AlbumPost_like",
                    });

                    if (wss) {
                      wss.clients.forEach((client) => {
                        if (client.readyState === WebSocket.OPEN) {
                          client.send(broadcastMessage);
                        }
                      });
                    }
                  } catch (err) {
                    console.error("Background task failed:", err);
                  }
                });
              } catch (error) {
                return safeSend(
                  { message: "Notification creation failed", error },
                  500
                );
              }
            }
          );
        }
      );
    });
  } else if (ch === "out") {
    const deleteQuery = `DELETE FROM notification WHERE to_id = ? AND post_id = ?`;
    db.query(deleteQuery, [user_id, post_id], (deleteErr) => {
      if (deleteErr) {
        return safeSend(
          { message: "Notification delete error", error: deleteErr },
          500
        );
      }
    });

    const broadcastMessage = JSON.stringify({ event: "AlbumPost_like" });

    if (wss) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(broadcastMessage);
        }
      });
    }

    return safeSend({
      message: "Post like removed successfully.",
      status: "1",
    });
  }
}

async function sendEmailFor_albumlikePhoto(too, name, byname, forumName) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: "amourette.no@gmail.com",
      pass: "ozox fcff dftd mguf", // It's better to use environment variables here
    },
  });

  const mailOptions = {
    from: "amourette.no@gmail.com",
    to: too,
    subject: `${byname} liked your album in the forum "${forumName}"`, // Updated subject for clarity
    text:
      `Hello ${name},\n\n` +
      `We are excited to inform you that your album in the forum "${forumName}" was liked by ${byname} on Amourette.\n\n` +
      `Keep sharing your amazing posts and stay connected with the community!\n\n` +
      `Best regards,\n` +
      `The Amourette Team`,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("Email sent successfully:", info.response);
  } catch (error) {
    console.error("Error sending email:", error);
  }
}

exports.deletePostUserAlbum = (req, res) => {
  const { id, user_id, image_url } = req.body;
  const wss = req.wss;
  console.log(req.body);
  if (!id || !user_id || !image_url) {
    return res
      .status(400)
      .json({ message: "Post ID, user ID, and image URL are required" });
  }

  const executeQuery = (query, params) => {
    return new Promise((resolve, reject) => {
      db.query(query, params, (err, result) => {
        if (err) return reject(err);
        resolve(result);
      });
    });
  };

  const broadcastEvent = (eventName) => {
    const message = JSON.stringify({ event: eventName });
    if (wss) {
      wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  };

  (async () => {
    try {
      // 1. Delete related comments
      await executeQuery(
        "DELETE FROM usersalbumcomment WHERE image_url = ? AND usersalbum_id = ? AND user_id = ?",
        [image_url, id, user_id]
      );

      // 2. Delete related favorites
      await executeQuery(
        "DELETE FROM usersalbumfavourite WHERE image_url = ? AND usersalbum_id = ? AND user_id = ?",
        [image_url, id, user_id]
      );

      // 3. Fetch the current images array
      const [album] = await executeQuery(
        "SELECT images FROM usersalbum WHERE id = ? AND user_id = ?",
        [id, user_id]
      );

      if (!album) {
        return res
          .status(404)
          .json({ message: "Album not found or user not authorized" });
      }

      let images = JSON.parse(album.images); // Convert JSON string to JS array

      // 4. Remove the image_url from the array
      images = images.filter((img) => img !== image_url);

      // 5. Update the usersalbum row with the new images array
      await executeQuery(
        "UPDATE usersalbum SET images = ? WHERE id = ? AND user_id = ?",
        [JSON.stringify(images), id, user_id]
      );

      broadcastEvent("DeleteUserAlbumPost");

      res
        .status(200)
        .json({ message: "Image removed from album successfully" });
    } catch (error) {
      console.error("Database error:", error);
      res
        .status(500)
        .json({ message: "Database error", error: error.message || error });
    }
  })();
};

exports.checkaccessuserAlbum = async (req, res) => {
  const { user_id, albumid } = req.body;
  console.log(req.body);
  // Validate required fields
  if (!albumid || !user_id) {
    return res.status(400).json({ message: "ID and User ID are required." });
  }

  try {
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Check if the entry already exists
    const checkExistsQuery = `SELECT * FROM albums WHERE user_id = ? AND id = ?`;
    db.query(checkExistsQuery, [user_id, albumid], (err, row) => {
      if (err) {
        console.error("Database query error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({ message: "", row });
    });
  } catch (error) {
    console.error("Event retrieval error:", error); // Log error to console
    res.status(500).json({ message: "Event retrieval error", error });
  }
};

exports.checkaccessTopage = async (req, res) => {
  const { user_id, albumid } = req.body;
  //console.log(req.body);

  const wss = req.wss; // Get the WebSocket server instance from the request

  try {
    // Ensure user_id and to_id are provided
    if (!user_id || !albumid) {
      return res
        .status(400)
        .json({ message: "Both user_id and to_id are required" });
    }

    // Prepare the current date
    const date = moment
      .tz(new Date(), "Europe/Oslo")
      .format("YYYY-MM-DD HH:mm:ss");

    // Insert the message along with file URLs into a single database row
    // First, check if the record exists
    db.query(
      "SELECT albums.id FROM albums JOIN usersalbum ON albums.id = usersalbum.album_id JOIN userphotoprivate ON userphotoprivate.albumid = usersalbum.id WHERE userphotoprivate.status = 'Yes' AND albums.id = ? And userphotoprivate.to_id = ?;",
      [albumid, user_id],
      (selectErr, selectResults) => {
        if (selectErr) {
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
          });
        }
        // If the record exists, return status "2"
        if (selectResults.length > 0) {
          if (selectResults[0].status === "No") {
            return res.status(200).json({
              to_id: to_id,
              status: "2",
            });
          }
          if (selectResults[0].status === "Yes") {
            return res.status(200).json({
              to_id: to_id,
              status: "1",
            });
          }
        } else {
          return res.status(200).json({
            to_id: "",
            status: "3",
          });
        }
      }
    );
  } catch (error) {
    console.error("Error:", error); // Log the error for debugging
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.setCoverphoto = async (req, res) => {
  const { id, user_id, coverphoto } = req.body;

  try {
    const selectQuery = `
      SELECT * FROM coverphoto WHERE usersalbum_id = ? AND user_id = ?;
    `;

    db.query(selectQuery, [id, user_id, coverphoto], (err, results) => {
      if (err) {
        console.error("Database select error:", err);
        return res
          .status(500)
          .json({ message: "Select query failed", error: err });
      }

      if (results.length === 0) {
        // No matching row found, so insert
        const insertQuery = `
          INSERT INTO coverphoto (usersalbum_id, user_id, image_url) VALUES (?, ?, ?);
        `;

        db.query(
          insertQuery,
          [id, user_id, coverphoto],
          (err, insertResult) => {
            if (err) {
              console.error("Insert error:", err);
              return res
                .status(500)
                .json({ message: "Insert failed", error: err });
            }

            return res
              .status(200)
              .json({ success: true, message: "Cover photo inserted." });
          }
        );
      } else {
        // Matching row exists, so update it
        const updateQuery = `
          UPDATE coverphoto SET image_url = ? WHERE usersalbum_id = ? AND user_id = ?;
        `;

        db.query(
          updateQuery,
          [coverphoto, id, user_id],
          (err, updateResult) => {
            if (err) {
              console.error("Update error:", err);
              return res
                .status(500)
                .json({ message: "Update failed", error: err });
            }

            return res
              .status(200)
              .json({ success: true, message: "Cover photo updated." });
          }
        );
      }
    });
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ message: "Server error", error });
  }
};

exports.readmessageuser = async (req, res) => {
  const { to_id, user_id } = req.body;
  console.log(req.body, "juuu");

  try {
    // Step 1: Get unread messages
    db.query(
      "SELECT * FROM chatmessages WHERE user_id = ? AND to_id = ? AND `read` = 'No'",
      [to_id, user_id],
      (selectErr, messages) => {
        if (selectErr) {
          console.error("Database select error:", selectErr);
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
            status: "2",
          });
        }
        console.log(messages, "kkk");
        if (messages.length === 0) {
          return res.status(200).json({
            status: "1",
            message: "No unread messages",
            messages: [],
          });
        }

        // Step 2: Loop through messages and update each by ID
        let updatedCount = 0;
        messages.forEach((msg, index) => {
          db.query(
            "UPDATE chatmessages SET `read` = 'Yes' WHERE id = ?",
            [msg.id],
            (updateErr) => {
              if (updateErr) {
                console.error(
                  `Error updating message ID ${msg.id}:`,
                  updateErr
                );
                // Optional: You can choose to return here or continue updating others
              }

              updatedCount++;

              // After all updates are attempted
              if (updatedCount === messages.length) {
                return res.status(200).json({
                  status: "1",
                  message: "Messages updated successfully",
                  messages,
                });
              }
            }
          );
        });
      }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    res.status(500).json({ message: "Server error", error });
  }
};

exports.gallerymovetoAlbum = async (req, res) => {
  const { user_id, file, id, galleryIdd } = req.body;

  try {
    // Step 1: Remove file from `removeid`
    db.query(
      "SELECT images FROM usersalbum WHERE user_id = ? AND album_id = ?",
      [user_id, id],
      (err, removeRows) => {
        if (err) {
          console.error("Database query error:", err);
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        if (removeRows.length === 0) {
          return res.status(404).json({ message: "Source album not found" });
        }

        let removeImagesArray = JSON.parse(removeRows[0].images || "[]");
        let removeImagesArraycheck = JSON.parse(removeRows[0].images || "[]");
        removeImagesArray = removeImagesArray.filter((img) => img !== file); // Remove file

        if (removeImagesArraycheck.includes(file)) {
          db.query(
            "SELECT name FROM albums WHERE id = ?",
            [id],
            (selectErr, selectResult) => {
              if (selectErr) {
                console.error("Error fetching album name:", selectErr);
                return res.status(500).json({
                  message: "File moved but failed to retrieve album name",
                  error: selectErr,
                });
              }

              const albumName = selectResult[0]?.name || "Unknown";

              return res.status(200).json({
                message: `File already moved to album: ${albumName}`,
              });
            }
          );
        } else {
          // Update `removeid` album
          db.query(
            "UPDATE usersalbum SET images = ? WHERE user_id = ? AND album_id = ?",
            [JSON.stringify(removeImagesArray), user_id, id],
            (updateErr) => {
              if (updateErr) {
                console.error("Error updating removeid:", updateErr);
                return res.status(500).json({
                  message: "Error updating removeid",
                  error: updateErr,
                });
              }

              // Step 2: Add file to `id`
              db.query(
                "SELECT images FROM usersalbum WHERE user_id = ? AND album_id = ?",
                [user_id, id],
                (targetErr, targetRows) => {
                  if (targetErr) {
                    console.error("Database query error:", targetErr);
                    return res.status(500).json({
                      message: "Database query error",
                      error: targetErr,
                    });
                  }

                  let targetImagesArray =
                    targetRows.length > 0
                      ? JSON.parse(targetRows[0].images || "[]")
                      : [];

                  if (!targetImagesArray.includes(file)) {
                    targetImagesArray.push(file); // Add file to target album
                  }

                  // Update `id` album
                  db.query(
                    "UPDATE usersalbum SET images = ? WHERE user_id = ? AND album_id = ?",
                    [JSON.stringify(targetImagesArray), user_id, id],
                    (finalErr) => {
                      if (finalErr) {
                        console.error("Error updating target album:", finalErr);
                        return res.status(500).json({
                          message: "Error updating target album",
                          error: finalErr,
                        });
                      }
                      if (galleryIdd !== "") {
                        db.query(
                          "UPDATE gallery SET album_id = ? WHERE id = ?",
                          [id, galleryIdd],
                          (finalErr) => {}
                        );
                      }

                      // After update, fetch album name from albums table
                      db.query(
                        "SELECT name FROM albums WHERE id = ?",
                        [id],
                        (selectErr, selectResult) => {
                          if (selectErr) {
                            console.error(
                              "Error fetching album name:",
                              selectErr
                            );
                            return res.status(500).json({
                              message:
                                "File moved but failed to retrieve album name",
                              error: selectErr,
                            });
                          }

                          const albumName = selectResult[0]?.name || "Unknown";

                          return res.status(200).json({
                            message: `File successfully moved to album: ${albumName}`,
                          });
                        }
                      );
                    }
                  );
                }
              );
            }
          );
        }
      }
    );
  } catch (error) {
    console.error("File move error:", error);
    res.status(500).json({ message: "File move error", error });
  }
};

exports.recentActivity = async (req, res) => {
  console.log("friend");
  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ message: "user_id is required" });
    }

    const query = `
  (
    SELECT 'gallery' AS type, id, image AS content, date, slug AS extra_slug, name, image
    FROM gallery
    WHERE user_id = ?
  )
  UNION ALL
  (
    SELECT 'groups' AS type, id, image AS content, date, slug AS extra_slug, name, image
    FROM \`groups\`
    WHERE user_id = ?
  )
  UNION ALL
  (
    SELECT 'forum' AS type, id, image AS content, date, slug AS extra_slug, name, image
    FROM forum
    WHERE user_id = ?
  )
  UNION ALL
  (
    SELECT 
      'forum_comment' AS type, 
      fc.id, 
      fc.description AS content,
      fc.date,
      f.slug AS extra_slug, 
      f.name,
      f.image AS image
    FROM forum_comment fc
    JOIN forum f ON f.id = fc.forum_id
    WHERE fc.user_id = ?
  )
  UNION ALL
  (
    SELECT 
      'gallery_comment' AS type, 
      gc.id, 
      gc.description AS content, 
      gc.date,
      g.slug AS extra_slug,
      g.name,
      g.image AS image
    FROM gallery_comment gc
    JOIN gallery g ON g.id = gc.gallery_id
    WHERE gc.user_id = ?
  )
  UNION ALL
  (
    SELECT 
      'group_post_comment' AS type, 
      gpc.id, 
      gpc.description AS content, 
      gpc.date, 
      g.slug AS extra_slug,
      g.name,
      g.image AS image
    FROM group_post_comment gpc
    JOIN \`groups\` g ON g.id = gpc.group_id
    WHERE gpc.user_id = ?
  )
  ORDER BY date DESC
  LIMIT 5
`;

    db.query(
      query,
      [user_id, user_id, user_id, user_id, user_id, user_id],
      (err, results) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }

        return res.status(200).json({
          message: "Recent activity fetched successfully",
          results,
        });
      }
    );
  } catch (error) {
    return res.status(500).json({ message: "Server error", error });
  }
};

exports.getmessageNoRead = async (req, res) => {
  const { user_id } = req.body; // Expecting message ID and user ID

  try {
    // Ensure both ID and User ID are provided
    if (!user_id) {
      return res.status(400).json({ message: "ID and User ID are required" });
    }

    // First, check if the message with the provided ID exists and if the to_id matches the user_id
    db.query(
      `SELECT * FROM chatmessages WHERE to_id = ?  AND \`read\`= 'No'`,
      [user_id],
      (selectErr, selectResults) => {
        if (selectErr) {
          console.error("Database select error:", selectErr);
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
            status: "2",
          });
        }

        return res.status(200).json({
          message: "",
          results: selectResults,
        });
      }
    );
  } catch (error) {
    console.error("Server error:", error); // Log server-side errors
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getinviteusers = async (req, res) => {
  const { user_id, slug } = req.body; // Expecting message ID and user ID

  try {
    // Ensure both ID and User ID are provided
    if (!user_id) {
      return res.status(400).json({ message: "ID and User ID are required" });
    }

    // First, check if the message with the provided ID exists and if the to_id matches the user_id
    db.query(
      `SELECT 
  gi.*, 
  u.username, 
  u.email,
  u.profile_image,
  u.id AS in_id,
  u.slug AS in_slug,
  su.profile_image AS sender_profile_image,
  su.username AS sender_username,
  su.slug AS sender_slug,
  f.status AS is_friend,f.id as frd_id
FROM \`groups\` g
JOIN groups_invite gi ON g.id = gi.group_id
JOIN users u ON gi.user_id = u.id
JOIN users su ON gi.sent_id = su.id
LEFT JOIN friendRequest_accept f ON (
  (f.user_id = ? AND f.sent_to = gi.sent_id) OR 
  (f.user_id = gi.sent_id AND f.sent_to = ?)
)
WHERE g.slug = ?`,
      [user_id, user_id, slug],
      (selectErr, selectResults) => {
        if (selectErr) {
          console.error("Database select error:", selectErr);
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
            status: "2",
          });
        }

        return res.status(200).json({
          message: "",
          results: selectResults,
        });
      }
    );
  } catch (error) {
    console.error("Server error:", error); // Log server-side errors
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getcannotattend = async (req, res) => {
  const { user_id, slug } = req.body; // Expecting message ID and user ID

  try {
    // Ensure both ID and User ID are provided
    if (!user_id) {
      return res.status(400).json({ message: "ID and User ID are required" });
    }

    // First, check if the message with the provided ID exists and if the to_id matches the user_id
    db.query(
      `SELECT 
  gi.*, 
  u.username, 
  u.email,
  u.profile_image,
  u.id as in_id,
  u.slug as in_slug,
  su.profile_image AS sender_profile_image,
  su.username AS sender_username,
  su.slug AS sender_slug,
  f.status AS is_friend,f.id as frd_id
FROM \`groups\` g
JOIN groups_invite gi ON g.id = gi.group_id
JOIN users u ON gi.user_id = u.id
JOIN users su ON gi.sent_id = su.id
LEFT JOIN friendRequest_accept f ON (
  (f.user_id = ? AND f.sent_to = gi.sent_id) OR 
  (f.user_id = gi.sent_id AND f.sent_to = ?)
)
WHERE g.slug = ? And gi.accept = 'No'`,
      [user_id, user_id, slug],
      (selectErr, selectResults) => {
        if (selectErr) {
          console.error("Database select error:", selectErr);
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
            status: "2",
          });
        }

        return res.status(200).json({
          message: "",
          results: selectResults,
        });
      }
    );
  } catch (error) {
    console.error("Server error:", error); // Log server-side errors
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getconfirmgodGuestuser = async (req, res) => {
  const { user_id, slug } = req.body; // Expecting message ID and user ID

  try {
    // Ensure both ID and User ID are provided
    if (!user_id) {
      return res.status(400).json({ message: "ID and User ID are required" });
    }

    // First, check if the message with the provided ID exists and if the to_id matches the user_id
    db.query(
      `SELECT 
  gi.*, 
  u.username, 
  u.email,
  u.profile_image,
  u.id as in_id,
  u.slug as in_slug,
  su.profile_image AS sender_profile_image,
  su.username AS sender_username,
  su.slug AS sender_slug,
  f.status AS is_friend,f.id as frd_id
FROM \`groups\` g
JOIN groups_invite gi ON g.id = gi.group_id
JOIN users u ON gi.user_id = u.id
JOIN users su ON gi.sent_id = su.id
LEFT JOIN friendRequest_accept f ON (
  (f.user_id = ? AND f.sent_to = gi.sent_id) OR 
  (f.user_id = gi.sent_id AND f.sent_to = ?)
)
WHERE g.slug = ? And gi.accept = 'Yes'`,
      [user_id, user_id, slug],
      (selectErr, selectResults) => {
        if (selectErr) {
          console.error("Database select error:", selectErr);
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
            status: "2",
          });
        }

        return res.status(200).json({
          message: "",
          results: selectResults,
        });
      }
    );
  } catch (error) {
    console.error("Server error:", error); // Log server-side errors
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.getintesusers = async (req, res) => {
  const { user_id, slug } = req.body; // Expecting message ID and user ID

  try {
    // Ensure both ID and User ID are provided
    if (!user_id) {
      return res.status(400).json({ message: "ID and User ID are required" });
    }

    // First, check if the message with the provided ID exists and if the to_id matches the user_id
    db.query(
      `SELECT 
        gi.*, 
        
        su.profile_image AS sender_profile_image,
        su.username AS sender_username,
        su.slug AS sender_slug,f.status AS is_friend,f.id as frd_id
      FROM \`groups\` g
      JOIN groups_intersted gi ON g.id = gi.group_id
      JOIN users su ON gi.user_id = su.id
      LEFT JOIN friendRequest_accept f ON (
        (f.user_id = ? AND f.sent_to = gi.user_id) OR 
        (f.user_id = gi.user_id AND f.sent_to = ?)
      )
      WHERE g.slug = ?`,
      [user_id, user_id, slug],
      (selectErr, selectResults) => {
        if (selectErr) {
          console.error("Database select error:", selectErr);
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
            status: "2",
          });
        }

        return res.status(200).json({
          message: "",
          results: selectResults,
        });
      }
    );
  } catch (error) {
    console.error("Server error:", error); // Log server-side errors
    return res.status(500).json({ message: "Server error", error });
  }
};
exports.checkcodeverified = async (req, res) => {
  const { code } = req.body; // Expecting message ID and user ID

  try {
    // Ensure both ID and User ID are provided

    // First, check if the message with the provided ID exists and if the to_id matches the user_id
    db.query(
      `SELECT * from entercode where code =?`,
      [code],
      (selectErr, selectResults) => {
        if (selectErr) {
          console.error("Database select error:", selectErr);
          return res.status(500).json({
            message: "Database select error",
            error: selectErr,
            status: "2",
          });
        }
        if (selectResults.length > 0) {
          return res.status(200).json({
            message: "",
            status: "1",
            code: code,
          });
        } else {
          return res.status(200).json({
            message: "",
            status: "2",
            code: code,
          });
        }
      }
    );
  } catch (error) {
    console.error("Server error:", error); // Log server-side errors
    return res.status(500).json({ message: "Server error", error });
  }
};
