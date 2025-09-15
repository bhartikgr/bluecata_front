const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");
const cron = require("node-cron");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");
const yahooFinance = require("yahoo-finance2").default;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Make sure this is set in your .env file
});
// const response = await openai.chat.completions.create({
//   model: "gpt-4", // or "gpt-3.5-turbo"
//   messages: [
//     { role: "system", content: "You are a helpful assistant." },
//     { role: "user", content: "Summarize this document." },
//   ],
// });

require("dotenv").config();
//Email Detail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
//Email Detail
exports.getallcountry = (req, res) => {
  db.query("SELECT * FROM country", async (err, results) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    res.status(200).json({
      message: "",
      results: results,
    });
  });
};
function generateStrongPassword(length = 12) {
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const special = "!@#$%^&*()_+-=[]{}|;:,.<>?";
  const allChars = uppercase + lowercase + numbers + special;

  const passwordArray = [
    uppercase[
      Math.floor((crypto.randomBytes(1).readUInt8() / 256) * uppercase.length)
    ],
    lowercase[
      Math.floor((crypto.randomBytes(1).readUInt8() / 256) * lowercase.length)
    ],
    numbers[
      Math.floor((crypto.randomBytes(1).readUInt8() / 256) * numbers.length)
    ],
    special[
      Math.floor((crypto.randomBytes(1).readUInt8() / 256) * special.length)
    ],
  ];

  for (let i = passwordArray.length; i < length; i++) {
    const randomByte = crypto.randomBytes(1).readUInt8();
    passwordArray.push(
      allChars[Math.floor((randomByte / 256) * allChars.length)]
    );
  }

  for (let i = passwordArray.length - 1; i > 0; i--) {
    const randomByte = crypto.randomBytes(1).readUInt8();
    const j = Math.floor((randomByte / 256) * (i + 1));
    [passwordArray[i], passwordArray[j]] = [passwordArray[j], passwordArray[i]];
  }

  return passwordArray.join("");
}
function generateAccessToken() {
  return crypto.randomBytes(32).toString("hex"); // 32 bytes = 64 hex characters
}
function sendEmailLoginpassword(to, fullName, newPassword) {
  const subject = `Welcome to Blueprint Catalyst Ltd - Your Login Details`;

  const body = `
Dear ${fullName},

Thank you for registering with **Blueprint Catalyst Ltd**.

Your account has been successfully created. Below are your login credentials:

**Email:** ${to}  
**Password:** ${newPassword}

Please log in and change this password immediately to keep your account secure.

If you have any questions or need assistance, feel free to contact our support team.

We're excited to have you on board!

Regards,  
Blueprint Catalyst Ltd Team
  `;

  const mailOptions = {
    from: "scale@blueprintcatalyst.com",
    to,
    subject,
    text: body,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Registration email sent:", info.response);
  });
}

exports.userRegister = async (req, res) => {
  const {
    first_name,
    last_name,
    email,
    role,
    linked_in,
    phone,
    area,
    city_step2,
    country,
    company_name,
    year_registration,
    company_website,
    employee_number,
    company_linkedin,
    company_maimai,
    company_wechat,
    company_zhipin,
    company_mail_address,
    company_state,
    company_city,
    company_postal_code,
    company_country,
    stage_step3,
    gross_revenue,
    headline,
    descriptionBrief,
    descriptionProblem,
    descriptionSolution,
    headlineStep4,
    descriptionStep4,
    problemStep4,
    solutionStep4,
    company_industory,
  } = req.body;

  try {
    // Hash the password
    //var password = generateStrongPassword(8);
    const password = generateStrongPassword(8);
    const hashedPassword = await bcrypt.hash(password, 12);
    //var password = "12345";
    //const hashedPassword = await bcrypt.hash(password, 12);
    const accessToken = generateAccessToken();
    // Check if user already exists
    db.query(
      "SELECT * FROM company WHERE email = ?",
      [email],
      async (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        if (results.length > 0) {
          return res.status(200).json({
            message: "Email is already exists",
            status: "2",
          });
        } else {
          // Insert new user (adjust query based on your database schema)
          var date = new Date();
          const query = `
          INSERT INTO company (company_industory,
            first_name, last_name, email, password, role,
            linked_in, phone,
            area, city_step2, country, company_name, year_registration,
            company_website, employee_number, company_linkedin,
            company_maimai, company_wechat, company_zhipin,
            company_mail_address, company_state, company_city,
            company_postal_code, company_country, stage_step3,
            gross_revenue, headline, descriptionBrief,
            descriptionProblem, descriptionSolution, headlineStep4,
            descriptionStep4, problemStep4, solutionStep4,created_at,access_token,view_password
          ) VALUES (?, ?, ?,  ?, ?, ?,  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

          // Array of values for the query
          const values = [
            company_industory,
            first_name,
            last_name,
            email,
            hashedPassword, // NULL if password not provided
            role || "user", // Default to 'user'
            linked_in || null,
            phone || null,
            area || null,
            city_step2 || null,
            country || null,
            company_name || null,
            year_registration || null,
            company_website || null,
            employee_number || null,
            company_linkedin || null,
            company_maimai || null,
            company_wechat || null,
            company_zhipin || null,
            company_mail_address || null,
            company_state || null,
            company_city || null,
            company_postal_code || null,
            company_country || null,
            stage_step3 || null,
            gross_revenue || null,
            headline || null,
            descriptionBrief || null,
            descriptionProblem || null,
            descriptionSolution || null,
            headlineStep4 || null,
            descriptionStep4 || null,
            problemStep4 || null,
            solutionStep4 || null,
            date,
            accessToken,
            password,
          ];

          // Execute the INSERT query
          db.query(query, values, (err, results) => {
            if (err) {
              console.error("Database insert error:", err);
              return res.status(500).json({
                message: "Database insert error",
                status: "0",
                error: err.message,
              });
            }
            var fl = first_name + " " + last_name;
            sendEmailLoginpassword(email, fl || "User", password);
            res.status(200).json({
              message: "Account successfully created",
              status: "1",
              id: results.insertId,
              email: email,
              first_name: first_name,
              last_name: last_name,
              access_token: accessToken,
            });
          });
        }
      }
    );
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};
exports.userLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check if user already exists
    db.query(
      "SELECT * FROM company WHERE email = ?",
      [email],
      async (err, rows) => {
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
              .json({ status: "2", message: "Invalid email or password" });
          } else {
            res.status(200).json({
              message: "Login successfully",
              status: "1",
              id: user.id,
              email: user.email,
              first_name: user.first_name,
              last_name: user.last_name,
              access_token: user.access_token,
            });
          }
        } else {
          res
            .status(200)
            .json({ status: "2", message: "Invalid email or password" });
        }
      }
    );
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

exports.getModules = (req, res) => {
  db.query(
    "SELECT * FROM module where status =? order by id desc",
    ["Active"],
    async (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        message: "",
        results: results,
      });
    }
  );
};
const generateUniqueCode = () => {
  const timestamp = Date.now();
  const randomNum = Math.floor(Math.random() * 1000); // Add randomness

  // Generate a random 3-letter string
  const randomLetters = Math.random()
    .toString(36)
    .substring(2, 5)
    .toUpperCase();

  return `${randomLetters}${timestamp}${randomNum}`;
};
exports.registerforZoom = async (req, res) => {
  const data = req.body;
  const meetingRecords = [];
  let selectedSlots = [];

  if (typeof data.selectedSlots === "string") {
    try {
      selectedSlots = JSON.parse(data.selectedSlots);
    } catch (err) {
      return res.status(200).json({
        message: "Invalid selectedSlots format",
        status: "2",
      });
    }
  } else if (Array.isArray(data.selectedSlots)) {
    selectedSlots = data.selectedSlots;
  } else {
    return res.status(200).json({
      message: "selectedSlots is missing or invalid",
      status: "2",
    });
  }

  // Convert slot start times into formatted datetime strings
  const formattedSlots = selectedSlots.map((slot) =>
    format(new Date(slot.start), "yyyy-MM-dd HH:mm:ss")
  );

  // ❌ Check for conflicting slots (exact time match)
  const conflictQuery = `
    SELECT zm.meeting_date 
    FROM zoommeeting_register zr 
    JOIN zoommeeting zm ON zm.zoom_register_id = zr.id 
    WHERE zr.email = ? AND zr.module_id = ? 
      AND zm.meeting_date IN (${formattedSlots.map(() => "?").join(",")})
  `;

  const conflictParams = [data.email, data.module_id, ...formattedSlots];

  db.query(conflictQuery, conflictParams, async (err, conflictResults) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    if (conflictResults.length > 0) {
      const conflictingTimes = conflictResults.map((row) =>
        format(new Date(row.meeting_date), "yyyy-MM-dd hh:mm a")
      );
      const conflictingTimess = conflictResults.map((row) =>
        format(new Date(row.meeting_date), "yyyy-MM-dd")
      );

      return res.status(200).json({
        message: `Already registered for the following date(${conflictingTimess}):`,
        status: "2",
        conflicts: conflictingTimes,
      });
    }

    // ✅ No conflicts, proceed with insert
    const insertRegisterQuery = `
      INSERT INTO zoommeeting_register (module_id, name, email, description, date)
      VALUES (?, ?, ?, ?, ?)
    `;

    db.query(
      insertRegisterQuery,
      [data.module_id, data.name, data.email, data.description, new Date()],
      async (err, result) => {
        if (err) {
          return res.status(500).json({
            message: "Error inserting into zoommeeting_register",
            error: err,
          });
        }

        const registerId = result.insertId;

        for (const slot of selectedSlots) {
          try {
            const zoomMeeting = await createZoomMeeting(
              slot,
              data.selectedZone,
              data.module_id
            );

            const meetingDateTime = format(
              new Date(slot.start),
              "yyyy-MM-dd HH:mm:ss"
            );

            const token = jwt.sign(
              {
                email: data.email,
                ip: data.ip_address,
                meetingId: zoomMeeting.id,
              },
              process.env.JWT_SECRET,
              { expiresIn: "1h" }
            );

            const uniqueCode = generateUniqueCode();
            const tokenExpiry = format(
              new Date(slot.start),
              "yyyy-MM-dd 23:00:00"
            );

            const insertMeetingQuery = `
              INSERT INTO zoommeeting 
              (zoom_meeting_id, module_id, unique_code, zoom_register_id, time, ip_address, meeting_date, timezone, date, zoom_link, access_token, token_expiry)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            const values = [
              zoomMeeting.id,
              data.module_id,
              uniqueCode,
              registerId,
              data.timeset,
              data.ip_address,
              meetingDateTime,
              data.selectedZone,
              new Date(),
              zoomMeeting.join_url,
              token,
              tokenExpiry,
            ];

            await new Promise((resolve, reject) => {
              db.query(insertMeetingQuery, values, (err, res) => {
                if (err) reject(err);
                else resolve(res);
              });
            });

            meetingRecords.push({
              join_url: zoomMeeting.join_url,
              slot: format(new Date(slot.start), "yyyy-MM-dd hh:mm a"),
            });
          } catch (zoomErr) {
            return res.status(500).json({
              message: "Zoom meeting creation failed",
              error: zoomErr.message,
            });
          }
        }

        return res.status(200).json({
          message: `Successfully registered for ${meetingRecords.length} meeting(s)`,
          status: "1",
          meetings: meetingRecords,
        });
      }
    );
  });
};

const CLIENT_ID = "AC7sqzKtRlq_Cqh8W5Hxg";
const CLIENT_SECRET = "DsRMvo4EoYxUrhXuxKxr317OQYZPbY3L";
const ACCOUNT_ID = "dLzomxwNRdaSvLyNiUzOsQ";

// Step 1: Get OAuth Access Token
async function getZoomAccessToken() {
  const token = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  try {
    const response = await axios.post(
      `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ACCOUNT_ID}`,
      {},
      {
        headers: {
          Authorization: `Basic ${token}`,
        },
      }
    );

    return response.data.access_token;
  } catch (err) {
    console.error(
      "Error fetching Zoom access token:",
      err.response?.data || err.message
    );
    throw err;
  }
}
let meetingsDatabase = {};

// Step 2: Create Zoom Meeting
async function createZoomMeeting(slot, timezone, moduleid) {
  const accessToken = await getZoomAccessToken();

  // Query to fetch module name
  let moduleName = "Entrepreneur Session"; // Default topic if query fails
  try {
    const query = "SELECT name FROM module WHERE id = $1"; // Use parameterized query for security
    const result = await pool.query(query, [moduleid]);

    if (result.rows.length > 0) {
      moduleName = result.rows[0].name; // Set module name from query result
    } else {
      console.warn(`No module found with id ${moduleid}`);
    }
  } catch (error) {
    console.error("❌ Error fetching module name:", error.message);
    // Proceed with default topic if query fails
  }

  const meetingData = {
    topic: `Entrepreneur Session: ${moduleName}`, // Use module name in topic
    type: 2, // Scheduled meeting
    start_time: slot.start,
    duration: 30,
    timezone: timezone,
    agenda: "Zoom Meeting for Entrepreneurs",
    settings: {
      host_video: true,
      participant_video: true,
      waiting_room: true,
      require_password: true,
      approval_type: 2,
    },
  };

  try {
    const response = await axios.post(
      `https://api.zoom.us/v2/users/me/meetings`,
      meetingData,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    // Optional: Store meeting info in in-memory DB
    meetingsDatabase[response.data.id] = {
      join_url: response.data.join_url,
      created_at: new Date(),
      id: response.data.id,
    };

    // console.log('✅ Zoom Meeting Created', meetingsDatabase);
    // console.log('Join URL:', response.data.join_url);

    return response.data; // Return the meeting data
  } catch (error) {
    console.error(
      "❌ Error creating Zoom meeting:",
      error.response?.data || error.message
    );
    throw error;
  }
}
exports.selectModule = (req, res) => {
  const moduleId = req.body.id;

  // First: fetch module info
  db.query(
    "SELECT * FROM module WHERE id = ?",
    [moduleId],
    (err, moduleResults) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Error fetching module", error: err });
      }

      // Second: fetch related zoom meetings
      db.query(
        "SELECT * FROM zoommeeting WHERE module_id = ?  order by id asc",
        [moduleId],
        (err, zoomResults) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Error fetching Zoom meetings", error: err });
          }
          const finalMeetings = zoomResults
            .map((meeting) => {
              const userTimeZone =
                Intl.DateTimeFormat().resolvedOptions().timeZone;

              if (!meeting.meeting_date || !meeting.time || !meeting.timezone) {
                console.warn(`Invalid meeting input:`, meeting);
                return null;
              }

              // Ensure date is in correct format (YYYY-MM-DD)
              const dateFormatted = moment(meeting.meeting_date).format(
                "YYYY-MM-DD"
              );
              const fullDateTimeStr = `${dateFormatted} ${meeting.time}:00`;

              if (
                !moment(fullDateTimeStr, "YYYY-MM-DD HH:mm:ss", true).isValid()
              ) {
                console.warn("Invalid date format:", fullDateTimeStr);
                return null;
              }

              let meetingTimeInOriginal;
              try {
                meetingTimeInOriginal = moment.tz(
                  fullDateTimeStr,
                  "YYYY-MM-DD HH:mm:ss",
                  meeting.timezone
                );
              } catch (e) {
                console.error("Timezone error:", e, meeting.timezone);
                return null;
              }

              if (!meetingTimeInOriginal.isValid()) {
                console.warn("Failed to parse meeting time:", fullDateTimeStr);
                return null;
              }

              const localTime = meetingTimeInOriginal.clone().tz(userTimeZone);

              return {
                id: meeting.id,
                topic: meeting.topic,
                title: `${localTime.format("hh:mm A")}`,
                start: localTime.toDate(),
                time: meeting.time,
                end: localTime.clone().add(30, "minutes").toDate(),
                allDay: false,
                zoom_link: meeting.zoom_link,
                datee: meeting.meeting_date_time,
                moduleId: meeting.module_id,
                originalMeeting: meeting,
              };
            })
            .filter(Boolean);
          return res.status(200).json({
            message: "Module and Zoom meetings fetched",
            results: moduleResults, // only one module
            zoomMeetings: finalMeetings, // all related meetings
          });
        }
      );
    }
  );
};

exports.joinZoomMeeting = (req, res) => {
  const token = req.body.token;
  const clientIp = req.body.ip;

  // Verify JWT token
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res
        .status(403)
        .json({ message: "Invalid token", error: err.message });
    }

    const { email, ip, meetingId } = decoded;

    // Check token and IP in database
    db.query(
      "SELECT zm.ip_address, zm.zoom_link, zm.zoom_meeting_id, zm.token_expiry, zmr.email FROM zoommeeting AS zm JOIN zoommeeting_register AS zmr ON zmr.id = zm.zoom_register_id WHERE zm.access_token = ? AND zmr.email = ?;",
      [token, email],
      (err, results) => {
        if (err) {
          console.error("Database query error:", err);
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }
        console.log(results);
        if (results.length === 0) {
          return res.status(200).json({
            message: "Invalid or expired token",
            error: "No matching record found",
          });
        }

        const { ip_address, zoom_link, zoom_meeting_id, token_expiry } =
          results[0];

        // Check token expiry
        if (new Date() > new Date(token_expiry)) {
          return res.status(200).json({
            message: "Token has expired",
            error: "Token validity period exceeded",
          });
        }

        // Check IP match
        if (ip_address !== clientIp || ip !== clientIp) {
          return res.status(200).json({
            message: "Access denied: IP address does not match",
            error: "IP mismatch",
          });
        }

        // Check meeting ID
        if (Number(zoom_meeting_id) !== Number(meetingId)) {
          return res.status(200).json({
            message: "Invalid meeting ID",
            error: "Meeting ID mismatch",
          });
        }
        res.status(200).send(`
             
                <iframe src="${zoom_link}" allow="camera; microphone; fullscreen" sandbox="allow-same-origin allow-scripts allow-popups" onload="window.parent.postMessage('zoom-loaded', '*')"></iframe>
             
            `);
        // Invalidate token
        // db.query(
        //   "UPDATE zoommeeting SET access_token = NULL, token_expiry = NULL WHERE access_token = ?",
        //   [token],
        //   (err) => {
        //     if (err) {
        //       console.error("Error invalidating token:", err);
        //       return res
        //         .status(500)
        //         .json({ message: "Error invalidating token", error: err });
        //     }

        //     // Serve Zoom meeting in an iframe
        //     res.status(200).send(`

        //         <iframe src="${zoom_link}" allow="camera; microphone; fullscreen" sandbox="allow-same-origin allow-scripts allow-popups"></iframe>

        //     `);
        //   }
        // );
      }
    );
  });
};

exports.videolimitsave = (req, res) => {
  const { user_id, video_id, limit } = req.body;
  db.query(
    "SELECT * FROM uservideolimit where user_id =? And video_id = ?",
    [user_id, video_id],
    async (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }
      if (results.length >= limit) {
        res.status(200).json({
          message: `You have reached the maximum views ${limit} for this video.`,
          status: "2",
        });
      } else {
        const userInsertQuery = `
            INSERT INTO uservideolimit 
            (user_id, video_id, date)
            VALUES (?, ?, ?)
          `;

        const date = new Date();
        db.query(
          userInsertQuery,
          [user_id, video_id, date],
          async (err, result) => {}
        );
        res.status(200).json({
          message: "",
          status: 1,
        });
      }
    }
  );
};

exports.getcategories = (req, res) => {
  const userId = req.query.user_id || req.body.user_id;

  // Step 1: Check lock status from subscription_statuslockfile
  const lockQuery = `
    SELECT * 
    FROM subscription_statuslockfile 
    WHERE user_id = ? 
    LIMIT 1
  `;

  db.query(lockQuery, [userId], (lockErr, lockResult) => {
    if (lockErr) {
      return res
        .status(500)
        .json({ message: "Error checking lock status", error: lockErr });
    }

    const lockStatus = lockResult.length > 0 ? "No" : "Yes";

    // Step 2: Your original dataroomcategories query
    const query = `
      SELECT
        dc.id AS category_id,
        dc.category_tips,
        dc.name AS category_name,
        dc.exits_tips,
        dc.do_not_exits,
        ddocs.Ai_generate,
        ddocs.locked,
        dsc.id AS subcategory_id,
        dsc.name AS subcategory_name,
        dsc.tips AS subcategory_tips,
        ddocs.id AS document_id,
        ddocs.doc_name,
        ddocs.folder_name,
        ddocs.created_at,
        ddocs.user_id,
        ddocs.subcategory_id AS subcate_id,
        dar.id AS summary_id,
        dar.summary AS summary_text,
        CASE 
          WHEN ddocs.status = 'Yes' THEN 'Yes'
          ELSE 'No'
        END AS approvedOrNot

      FROM dataroomcategories dc
      LEFT JOIN dataroomsub_categories dsc ON dc.id = dsc.dataroom_id
      LEFT JOIN dataroomdocuments ddocs ON
        dc.id = ddocs.category_id
        AND dsc.id = ddocs.subcategory_id
        AND ddocs.user_id = ?
      LEFT JOIN dataroomai_summary dar ON dar.category_id = ddocs.category_id

      GROUP BY dc.id,
        dc.category_tips,
        dc.name,
        dc.exits_tips,
        dc.do_not_exits,
        dsc.id,
        dsc.name,
        dsc.tips,
        ddocs.id,
        ddocs.doc_name,
        ddocs.folder_name,
        ddocs.created_at,
        ddocs.user_id,
        ddocs.subcategory_id,
        dar.id,
        dar.summary

      ORDER BY dc.name, dsc.name ASC;
    `;

    db.query(query, [userId], (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      const grouped = {};

      results.forEach((row) => {
        if (!grouped[row.category_id]) {
          grouped[row.category_id] = {
            id: row.category_id,
            name: row.category_name,
            category_tips: row.category_tips,
            exits_tips: row.exits_tips,
            do_not_exits: row.do_not_exits,
            subcategories: [],
            documents: [],
            documentStatus: [],
          };
        }

        const category = grouped[row.category_id];

        // Track approval status
        if (row.document_id) {
          category.documentStatus.push(row.approvedOrNot);
        }

        // Handle subcategory
        if (row.subcategory_id) {
          let subcat = category.subcategories.find(
            (sc) => sc.id === row.subcategory_id
          );

          if (!subcat) {
            subcat = {
              id: row.subcategory_id,
              name: row.subcategory_name,
              tips: row.subcategory_tips || "",
              summary_id: row.summary_id,
              summary_text: row.summary_text,
              user_id: row.user_id,
              locked: row.locked,
              lockStatus: lockStatus,
              Ai_generate: row.Ai_generate,
              document_id: row.document_id,
              documents: [],
            };
            category.subcategories.push(subcat);
          }

          if (
            row.document_id &&
            !subcat.documents.some((doc) => doc.id === row.document_id)
          ) {
            subcat.documents.push({
              id: row.document_id,
              document_id: row.document_id,
              name: row.doc_name,
              folder_name: row.folder_name,
              subcate_id: row.subcate_id,
              user_id: row.user_id,
              approvedOrNot: row.approvedOrNot,
              subcategory_name: row.subcategory_name,
              created_at: row.created_at,
              summary_id: row.summary_id,
              summary_text: row.summary_text,
              Ai_generate: row.Ai_generate,
              locked: row.locked,
              lockStatus: lockStatus,
            });
          }
        } else {
          // No subcategory present
          if (
            row.document_id &&
            !category.documents.some((doc) => doc.id === row.document_id)
          ) {
            category.documents.push({
              id: row.document_id,
              name: row.doc_name,
              created_at: row.created_at,
              ai_question_count: row.ai_question_count || 0,
            });
          }
        }
      });

      // Finalize approval status
      Object.values(grouped).forEach((category) => {
        const allApproved =
          category.documentStatus.length > 0 &&
          category.documentStatus.every((status) => status === "Yes");
        category.approvedOrNot = allApproved ? "Yes" : "No";
        delete category.documentStatus;
      });

      // Final response with lockStatus
      res.status(200).json({
        message: "",
        lockStatus: lockStatus, // ⬅️ Included here
        results: Object.values(grouped),
      });
    });
  });
};

exports.uploadDocuments = async (req, res) => {
  try {
    const files = req.files;
    console.log(files);
    if (!files || files.length === 0)
      return res.status(400).json({ error: "No files uploaded" });

    let combinedText = "";

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      let extractedText = "";

      if (ext === ".pdf") {
        const buffer = fs.readFileSync(file.path);
        const data = await pdfParse(buffer);
        extractedText = data.text;
      } else if (ext === ".docx") {
        const result = await mammoth.extractRawText({ path: file.path });
        extractedText = result.value;
      } else {
        extractedText = await new Promise((resolve, reject) => {
          textract.fromFileWithPath(file.path, (err, text) => {
            if (err) reject(err);
            else resolve(text);
          });
        });
      }

      if (extractedText) {
        combinedText += `\n\n--- Extracted from: ${file.originalname} ---\n\n${extractedText}`;
      }
    }

    if (!combinedText.trim()) {
      return res.status(400).json({ error: "No readable content found" });
    }

    const englishPrompt = `Summarize the following documents into a due diligence report (1000 characters max per section):\n\n${combinedText}`;
    const localPrompt = `Translate and summarize this due diligence content into the local language (max 1000 characters per section):\n\n${combinedText}`;

    const [englishCompletion, localCompletion] = await Promise.all([
      openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a due diligence assistant." },
          { role: "user", content: englishPrompt },
        ],
      }),
      openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: "You are a local language due diligence assistant.",
          },
          { role: "user", content: localPrompt },
        ],
      }),
    ]);

    const englishSummary = englishCompletion.choices[0].message.content;
    const localSummary = localCompletion.choices[0].message.content;

    // Optionally: Use a template and email/send/download logic here

    res.json({
      englishSummary,
      localSummary,
      message: "Due diligence summaries generated successfully",
    });
  } catch (error) {
    console.error("Processing error:", error);
    res.status(500).json({ error: "Failed to process documents" });
  }
};

exports.checkCompanyEmail = (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  const query = "SELECT * FROM company WHERE email = ?";

  db.query(query, [email], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (results.length > 0) {
      res.status(200).json({
        message: "",
        status: "2",
      });
    } else {
      res.status(200).json({
        message: "",
        status: "1",
      });
    }
  });
};
exports.getallSubscriptionPlan = (req, res) => {
  const query = "SELECT * FROM subscription_plans";

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      results: results,
    });
  });
};
exports.usersubscription = (req, res) => {
  const data = req.body;
  const date = new Date();

  const getPlanQuery = "SELECT period FROM subscription_plans WHERE id = ?";
  db.query(getPlanQuery, [data.plan_id], (err, results) => {
    if (err || results.length === 0) {
      return res.status(500).json({
        message: "Plan not found or DB error",
        status: "0",
        error: err ? err.message : "Plan not found",
      });
    }

    const period = results[0].period;
    console.log(period);
    const startDate = new Date();
    let endDate;

    if (period === "yearly") {
      endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      // default to monthly
      endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 1);
    }
    console.log(endDate, startDate);
    const insertQuery = `
      INSERT INTO users_subscription (
        company_id, module_id, name, email, cardnumber,
        expiry, cvv, start_date, end_date, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      data.user_id,
      data.plan_id,
      data.name,
      data.email,
      data.cardnumber,
      data.expiry,
      data.cvv,
      startDate,
      endDate,
      date,
    ];

    db.query(insertQuery, values, (err, results) => {
      if (err) {
        console.error("Database insert error:", err);
        return res.status(500).json({
          message: "Database insert error",
          status: "0",
          error: err.message,
        });
      }

      res.status(200).json({
        message: "Subscription saved successfully",
        status: "1",
      });
    });
  });
};

exports.checkmodulesubscription = (req, res) => {
  var user_id = req.body.user_id;
  const query = "SELECT * FROM  usersubscriptiondata_academy where user_id = ?";

  db.query(query, [user_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      results: results,
    });
  });
};
exports.getzipcode = async (req, res) => {
  const { city, state, country } = req.body;
  const address = `${city}, ${state}, ${country}`;
  console.log(address);
  const apiKey =
    "728165937090-15b9f7n63pc8dfc8p7t59in8f0rk279h.apps.googleusercontent.com";

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();
    console.log(data);
    if (data.status === "OK") {
      const results = data.results;

      // Iterate over address components to find postal_code
      for (const component of results[0].address_components) {
        if (component.types.includes("postal_code")) {
          return component.long_name; // postal code found
        }
      }

      return null; // postal code not found
    } else {
      console.error("Geocode API error:", data.status);
      return null;
    }
  } catch (error) {
    console.error("Fetch error:", error);
    return null;
  }
};
//Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const query = "SELECT * FROM company WHERE email = ?";

    db.query(query, [email], async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      if (results.length > 0) {
        const pass = generateStrongPassword(8);
        const hashedPassword = await bcrypt.hash(pass, 12);

        const updateQuery =
          "UPDATE company SET password = ?, view_password = ? WHERE email = ?";
        db.query(
          updateQuery,
          [hashedPassword, pass, email],
          async (updateErr) => {
            if (updateErr) {
              console.error("Error updating password:", updateErr);
              return res.status(500).json({
                message: "Password update failed",
                error: updateErr,
              });
            }

            // Send Email
            var fl = results[0].first_name + " " + results[0].last_name;
            sendEmailResetpassword(email, fl || "User", pass);

            // Return response
            return res.status(200).json({
              status: 1,
              message: "Password reset successfully and email sent",
            });
          }
        );
      } else {
        return res.status(200).json({
          status: 2,
          message: "Email not found",
        });
      }
    });
  } catch (error) {
    return res.status(500).json({
      message: "Server error",
      error,
    });
  }
};

// Email sending function
function sendEmailResetpassword(to, fullName, newPassword) {
  const subject = `Your Password Has Been Reset - Startup Portal`;

  const body = `
Dear ${fullName},

Your password has been successfully reset.

Here is your new login password: **${newPassword}**

We recommend that you log in and change this password immediately for your account's security.

If you did not request this password reset, please contact our support team immediately.

Regards,  
Startup Portal Team
  `;

  const mailOptions = {
    from: "scale@blueprintcatalyst.com",
    to,
    subject,
    text: body,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Password reset email sent:", info.response);
  });
}

exports.register_zoom = (req, res) => {
  const { ip, user_id, email, name, selectedMeetings, timezone } = req.body;

  // ✅ Validate required fields
  if (!email || !name || !selectedMeetings || selectedMeetings.length === 0) {
    return res.status(400).json({ status: "error", message: "Missing fields" });
  }

  if (selectedMeetings.length > 3) {
    return res.status(200).json({
      status: "error",
      message: "You can select only up to 3 meetings.",
    });
  }

  // ✅ Step 1: Check if user already registered
  const checkRegisteredQuery = `
    SELECT registered_meeting_ids FROM zoommeeting_register 
    WHERE user_id = ?
  `;

  db.query(checkRegisteredQuery, [user_id], (err, rows) => {
    if (err) {
      return res.status(500).json({
        status: "error",
        message: "DB error",
        error: err,
      });
    }

    // Combine all previously registered meeting IDs
    let registeredIds = [];
    if (rows.length > 0) {
      rows.forEach((row) => {
        const ids = JSON.parse(row.registered_meeting_ids || "[]");
        registeredIds = registeredIds.concat(ids);
      });
    }

    // ✅ Check for duplicate registrations
    const duplicateIds = selectedMeetings.filter((id) =>
      registeredIds.includes(id)
    );

    if (duplicateIds.length > 0) {
      return res.status(200).json({
        status: "error",
        message:
          "You have already registered for one or more selected meetings.",
        alreadyRegisteredMeetings: duplicateIds,
      });
    }

    // ✅ Step 2: Validate selected meeting IDs
    const placeholders = selectedMeetings.map(() => "?").join(",");
    const validateQuery = `SELECT id FROM zoommeeting WHERE id IN (${placeholders})`;

    db.query(validateQuery, selectedMeetings, (err2, result) => {
      if (err2) {
        return res.status(500).json({
          status: "error",
          message: "Validation query failed",
          error: err2,
        });
      }

      const validIds = result.map((r) => r.id);
      const invalidIds = selectedMeetings.filter(
        (id) => !validIds.includes(id)
      );

      if (invalidIds.length > 0) {
        return res.status(200).json({
          status: "error",
          message: "Invalid meeting IDs selected.",
          invalidIds,
        });
      }

      // ✅ Step 3: Insert individual registrations
      const insertQuery = `
        INSERT INTO zoommeeting_register 
        (timezone,user_id, name, email, ip_address, registered_meeting_ids, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, NOW())
      `;

      const insertTasks = selectedMeetings.map((meetingId) => {
        return new Promise((resolve, reject) => {
          db.query(
            insertQuery,
            [timezone, user_id, name, email, ip, JSON.stringify([meetingId])],
            (err3) => {
              if (err3) return reject(err3);
              resolve(meetingId);
            }
          );
        });
      });

      Promise.all(insertTasks)
        .then(() => {
          // ✅ Step 4: Fetch and return meeting details
          const fetchQuery = `SELECT * FROM zoommeeting WHERE id IN (${placeholders})`;

          db.query(fetchQuery, selectedMeetings, (err4, meetings) => {
            if (err4) {
              return res.status(500).json({
                status: "error",
                message: "Meeting fetch failed",
                error: err4,
              });
            }

            const formatted = meetings
              .map((meeting) => {
                const userTimeZone =
                  Intl.DateTimeFormat().resolvedOptions().timeZone;

                if (
                  !meeting.meeting_date ||
                  !meeting.time ||
                  !meeting.timezone
                ) {
                  console.warn(`Invalid meeting input:`, meeting);
                  return null;
                }

                // Ensure date is in correct format (YYYY-MM-DD)
                const dateFormatted = moment(meeting.meeting_date).format(
                  "YYYY-MM-DD"
                );
                const fullDateTimeStr = `${dateFormatted} ${meeting.time}:00`;

                if (
                  !moment(
                    fullDateTimeStr,
                    "YYYY-MM-DD HH:mm:ss",
                    true
                  ).isValid()
                ) {
                  console.warn("Invalid date format:", fullDateTimeStr);
                  return null;
                }

                let meetingTimeInOriginal;
                try {
                  meetingTimeInOriginal = moment.tz(
                    fullDateTimeStr,
                    "YYYY-MM-DD HH:mm:ss",
                    meeting.timezone
                  );
                } catch (e) {
                  console.error("Timezone error:", e, meeting.timezone);
                  return null;
                }

                if (!meetingTimeInOriginal.isValid()) {
                  console.warn(
                    "Failed to parse meeting time:",
                    fullDateTimeStr
                  );
                  return null;
                }

                const localTime = meetingTimeInOriginal
                  .clone()
                  .tz(userTimeZone);

                return {
                  id: meeting.id,
                  title: meeting.topic,
                  start: localTime.toDate(), // ✅ Correct local date-time object
                  end: localTime.clone().add(30, "minutes").toDate(),
                  time: meeting.time,
                  zoom_link: meeting.zoom_link,
                  module_id: meeting.module_id,
                  zoomLink: meeting.zoom_link,
                };
              })
              .filter(Boolean);

            return res.status(200).json({
              status: "success",
              selectedMeetings: formatted,
            });
          });
        })
        .catch((insertErr) => {
          return res.status(500).json({
            status: "error",
            message: "One or more meeting registrations failed.",
            error: insertErr,
          });
        });
    });
  });
};

// ✅ Controller: get_registered_meetings
exports.get_registered_meetings = (req, res) => {
  const user_id = req.body.user_id;

  // Step 1: Get registered meeting IDs for the user
  const query =
    "SELECT registered_meeting_ids FROM zoommeeting_register WHERE user_id = ?";
  db.query(query, [user_id], (err, rows) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ status: "error", message: "DB error", error: err });
    }

    if (rows.length === 0 || !rows[0].registered_meeting_ids) {
      return res.status(200).json({ meetings: [] });
    }

    let meetingIds;
    try {
      meetingIds = JSON.parse(rows[0].registered_meeting_ids); // [2, 3]
    } catch (parseErr) {
      return res
        .status(500)
        .json({ status: "error", message: "Invalid meeting ID format" });
    }

    if (meetingIds.length === 0) {
      return res.status(200).json({ meetings: [] });
    }

    // Step 2: Fetch meeting details
    const placeholders = meetingIds.map(() => "?").join(",");
    const meetingQuery = `SELECT id, topic, meeting_date, time, zoom_link FROM zoommeeting WHERE id IN (${placeholders})`;

    db.query(meetingQuery, meetingIds, (err2, meetings) => {
      if (err2) {
        console.error(err2);
        return res.status(500).json({
          status: "error",
          message: "Failed to fetch meetings",
          error: err2,
        });
      }

      // Format the start/end for calendar

      // const formattedMeetings = meetings.map((m) => {
      //   const dateOnly = new Date(m.meeting_date).toISOString().split("T")[0];
      //   const datetimeStr = `${dateOnly}T${m.time}`;
      //   const datetime = new Date(datetimeStr);

      //   return {
      //     id: m.id,
      //     title: m.topic,
      //     start: datetime,
      //     time: m.time,
      //     end: new Date(datetime.getTime() + 30 * 60 * 1000),
      //     zoomLink: m.zoom_link,
      //   };
      // });

      return res.status(200).json({ meetings: meetings });
    });
  });
};

// GET all Zoom meetings (for calendar display)
exports.get_all_zoom_meetings = (req, res) => {
  var id = req.body.id;
  const query = "SELECT * FROM zoommeeting WHERE module_id = ?";

  db.query(query, [id], (err, results) => {
    if (err) {
      console.error("DB Error:", err);
      return res.status(500).json({ status: "error", message: "DB error" });
    }

    // const meetings = results.map((m) => {
    //   const dateOnly = new Date(m.meeting_date).toISOString().split("T")[0];
    //   const datetimeStr = `${dateOnly}T${m.time}`;
    //   const datetime = new Date(datetimeStr);

    //   return {
    //     id: m.id,
    //     title: m.topic,
    //     start: datetime,
    //     time: m.time,
    //     end: new Date(datetime.getTime() + 30 * 60 * 1000),
    //     zoomLink: m.zoom_link,
    //   };
    // });
    return res.status(200).json({ status: "success", events: results });
  });
};
// Controller: get_combined_zoom_meetings
exports.get_combined_zoom_meetings = (req, res) => {
  const module_id = req.body.module_id;
  const user_id = req.body.user_id;
  const selectedZone = req.body.selectedZone; // optional

  // Step 1: Fetch ALL meetings
  const allMeetingsQuery = "SELECT * FROM zoommeeting WHERE module_id = ?";
  db.query(allMeetingsQuery, [module_id], (err, allMeetings) => {
    if (err) {
      console.error("All meeting fetch error", err);
      return res
        .status(500)
        .json({ error: "DB error while fetching meetings" });
    }

    // Step 2: Fetch REGISTERED meeting IDs
    const regQuery =
      "SELECT registered_meeting_ids FROM zoommeeting_register WHERE user_id = ?";
    db.query(regQuery, [user_id], (err2, rows) => {
      if (err2) {
        console.error("Registered fetch error", err2);
        return res
          .status(500)
          .json({ error: "DB error while fetching registered" });
      }

      let registeredIDs = [];

      if (rows.length > 0) {
        try {
          // Combine all registered_meeting_ids arrays from each row
          registeredIDs = rows
            .map((row) => JSON.parse(row.registered_meeting_ids || "[]"))
            .flat(); // flatten the array of arrays into a single array

          // Remove duplicates (optional, if needed)
          registeredIDs = [...new Set(registeredIDs)];
        } catch (e) {
          return res
            .status(500)
            .json({ error: "Invalid registered_meeting_ids format" });
        }
      }

      // Step 3: Convert all meetings with timezones in backend

      const finalMeetings = allMeetings
        .map((meeting) => {
          const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

          if (!meeting.meeting_date || !meeting.time || !meeting.timezone) {
            console.warn(`Invalid meeting input:`, meeting);
            return null;
          }

          // Ensure date is in correct format (YYYY-MM-DD)
          const dateFormatted = moment(meeting.meeting_date).format(
            "YYYY-MM-DD"
          );
          const fullDateTimeStr = `${dateFormatted} ${meeting.time}:00`;

          if (!moment(fullDateTimeStr, "YYYY-MM-DD HH:mm:ss", true).isValid()) {
            console.warn("Invalid date format:", fullDateTimeStr);
            return null;
          }

          let meetingTimeInOriginal;
          try {
            meetingTimeInOriginal = moment.tz(
              fullDateTimeStr,
              "YYYY-MM-DD HH:mm:ss",
              meeting.timezone
            );
          } catch (e) {
            console.error("Timezone error:", e, meeting.timezone);
            return null;
          }

          if (!meetingTimeInOriginal.isValid()) {
            console.warn("Failed to parse meeting time:", fullDateTimeStr);
            return null;
          }

          const localTime = meetingTimeInOriginal.clone().tz(userTimeZone);

          return {
            id: meeting.id,
            topic: meeting.topic,
            title: `${localTime.format("hh:mm A")} ${meeting.topic}`,
            time: meeting.time,
            start: localTime.toDate(),
            end: localTime.clone().add(30, "minutes").toDate(),
            allDay: false,
            datee: meeting.meeting_date_time,
            moduleId: meeting.module_id,
            originalMeeting: meeting,
            zoom_link: meeting.zoom_link,
            isRegistered: registeredIDs.includes(meeting.id),
          };
        })
        .filter(Boolean);
      // remove any nulls

      return res.status(200).json({
        status: "success",
        meetings: finalMeetings,
      });
    });
  });
};

//Cron Job Zoom Meeting
exports.sendAlluserReminderZoomLink = async (req, res) => {
  try {
    const [meetings] = await db.promise().query(`
      SELECT zr.*, zm.id AS zoom_meeting_id, zm.timezone, zm.meeting_date, zm.time, zm.topic, zm.zoom_link, zm.unique_code
      FROM zoommeeting_register zr
      LEFT JOIN zoommeeting zm 
        ON FIND_IN_SET(
          zm.id, 
          REPLACE(REPLACE(REPLACE(zr.registered_meeting_ids, '[', ''), ']', ''), ' ', '')
        )
    `);

    const [templateResults] = await db
      .promise()
      .query(`SELECT * FROM email_templates`);
    const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const now = moment().tz(userTimeZone);

    const reminderTypes = {
      reminder_48hr: { hours: 48, dbField: "reminder_48_sent" },
      reminder_24hr: { hours: 24, dbField: "reminder_24_sent" },
      reminder_1hr: { hours: 1, dbField: "reminder_1_sent" },
    };

    for (const [templateType, { hours, dbField }] of Object.entries(
      reminderTypes
    )) {
      const template = templateResults.find((t) => t.type === templateType);
      if (!template) continue;

      for (const meeting of meetings) {
        if (!meeting.meeting_date || !meeting.time) continue;
        if (meeting[dbField] === 1) continue; // already sent

        const [hour, minute] = meeting.time.split(":").map(Number);
        const meetingTimeInOrigin = moment
          .tz(meeting.meeting_date, "YYYY-MM-DD", meeting.timezone)
          .set({ hour, minute, second: 0 });
        const meetingTimeInLocal = meetingTimeInOrigin.clone().tz(userTimeZone);
        const reminderTime = meetingTimeInLocal
          .clone()
          .subtract(hours, "hours");

        const diffMinutes = Math.abs(now.diff(reminderTime, "minutes"));
        console.log(meeting.zoom_meeting_id);
        if (diffMinutes <= 10) {
          const zoomLink =
            "https://blueprintcatalyst.com/api/zoommeeting?token=" +
            meeting.unique_code;

          const replacements = {
            user_name: meeting.name || "User",
            meeting_topic: meeting.topic || "Zoom Meeting",
            event_time: meetingTimeInLocal.format(
              "dddd, MMMM Do YYYY [at] hh:mm A"
            ),
            zoom_link: zoomLink,
          };

          const htmlBody = fillTemplate(template.body, replacements);
          const emailSubject = fillTemplate(template.subject, replacements);

          // sendReminder(meeting.email, "Company", htmlBody, emailSubject);
          // console.log(`📧 Sent ${hours}hr reminder to ${meeting.email}`);

          await db
            .promise()
            .query(
              `UPDATE zoommeeting_register SET ${dbField} = 1 WHERE id = ?`,
              [meeting.id]
            );
        }
      }
    }

    res.json({ status: "Reminders checked and sent where applicable." });
  } catch (error) {
    console.error("❌ Error in reminder cron job:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Simple placeholder replacement
function fillTemplate(templateStr, data) {
  return templateStr.replace(/{{\s*(\w+)\s*}}/g, (_, key) => data[key] || "");
}

exports.zoommeeting = async (req, res) => {
  const { token } = req.query;
  console.log(req.query);
  const userIp = "";

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const query = "SELECT * FROM zoommeeting WHERE unique_code = ?";

    db.query(query, [token], (err, results) => {
      if (err) {
        console.error("DB Error:", err);
        return res.status(500).json({ status: "error", message: "DB error" });
      }
      // if (decoded.allowedIp !== userIp) {
      //   return res.status(403).send("Access denied: IP address mismatch.");
      // }
      if (results.length > 0) {
        var data = results[0];
        const redirectLink = data.zoom_link;
        return res.redirect(redirectLink);
      }
    });
  } catch (err) {
    return res.status(401).send("Invalid or expired link.");
  }
};
exports.getcompanydetail = async (req, res) => {
  var id = req.body.user_id;
  db.query("SELECT * FROM company where id=?", [id], async (err, row) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    res.status(200).json({
      message: "",
      results: row,
    });
  });
};
exports.companydataUpdate = async (req, res) => {
  const { id, company_name, phone, company_linkedin } = req.body;

  if (!id || !company_name || !phone || !company_linkedin) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  const updateQuery = `
    UPDATE company
    SET company_name = ?, phone = ?, company_linkedin = ?
    WHERE id = ?
  `;

  db.query(
    updateQuery,
    [company_name, phone, company_linkedin, id],
    (err, result) => {
      if (err) {
        return res.status(500).json({
          message: "Database update error",
          error: err,
        });
      }

      return res.status(200).json({
        message: "Company data updated successfully",
        updated: {
          id,
          company_name,
          phone,
          company_linkedin,
        },
      });
    }
  );
};

// controllers/subscription.js

exports.getusersSubscriptionPlan = async (req, res) => {
  const user_id = req.body.user_id;

  db.query(
    `SELECT * FROM usersubscriptiondataroomone_time WHERE user_id = ?`,
    [user_id],
    (err, dataroomOneTime) => {
      if (err) return res.status(500).json({ message: "Error 1", error: err });

      db.query(
        `SELECT * FROM usersubscriptiondataroom_perinstance WHERE user_id = ?`,
        [user_id],
        (err, perInstance) => {
          if (err)
            return res.status(500).json({ message: "Error 2", error: err });

          db.query(
            `SELECT * FROM userinvestorreporting_subscription WHERE user_id = ?`,
            [user_id],
            (err, reportingSub) => {
              if (err)
                return res.status(500).json({ message: "Error 3", error: err });

              const result = {
                dataroomOneTime: dataroomOneTime.length
                  ? dataroomOneTime[0]
                  : null,
                perInstancePurchases: perInstance,
                investorReporting: reportingSub.length ? reportingSub[0] : null,
              };

              res.status(200).json({
                success: true,
                results: result,
              });
            }
          );
        }
      );
    }
  );
};

exports.openZoomLink = (req, res) => {
  const id = req.body.id;

  const clientIp = req.body.ip_address;

  // Verify JWT token
  db.query(
    `SELECT 
  zm.ip_address, 
  zm.zoom_link,  
  zm.token_expiry, 
  zmr.email 
FROM zoommeeting AS zm 
JOIN zoommeeting_register AS zmr 
  ON FIND_IN_SET(
       zm.id,
       REPLACE(REPLACE(REPLACE(zmr.registered_meeting_ids, '[', ''), ']', ''), ' ', '')
     ) > 0
WHERE zm.id = ?;
`,
    [id],
    (err, results) => {
      if (err) {
        console.error("Database query error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (results.length === 0) {
        return res.status(200).json({
          message: "Invalid or expired token",
          error: "No matching record found",
          status: "2",
        });
      }

      const { ip_address, zoom_link, zoom_meeting_id, token_expiry } =
        results[0];

      // Check token expiry

      // Check IP match
      if (ip_address !== clientIp) {
        return res.status(200).json({
          message: "Access denied: IP address does not match",
          error: "IP mismatch",
          status: "2",
        });
      }

      // Check meeting ID

      res.status(200).send(`

                <iframe src="${zoom_link}" allow="camera; microphone; fullscreen" sandbox="allow-same-origin allow-scripts allow-popups" onload="window.parent.postMessage('zoom-loaded', '*')"></iframe>

            `);
    }
  );
};
