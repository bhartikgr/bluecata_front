const bcrypt = require("bcryptjs");
const multer = require("multer");
const crypto = require("crypto");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");

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
const JWT_SECRET = process.env.JWT_SECRET;
const logoBase64 = process.env.LOGO_BASE64;
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
      allChars[Math.floor((randomByte / 256) * allChars.length)],
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
function sendEmailResetpassword(to, fullName, newPassword) {
  const subject = `Your Password Has Been Reset - Capavate`;

  // HTML Email Template (dynamic)
  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Password Reset</title>
  </head>
  <body>
    <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; font-family: Verdana, Geneva, sans-serif;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:10px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <h2 style="font-size:16px; color:#111;">Dear ${fullName},</h2>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              Your password has been successfully reset.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              Here is your new login password:
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:15px;"><b>${newPassword}</b></p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              We recommend that you log in and change this password immediately for your account's security.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              If you did not request this password reset, please contact our support team immediately.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:0;">Regards,<br/>Capavate Team</p>
          </td>
        </tr>
      </table>
      <div style="text-align:center; font-size:12px; color:#999; padding:10px 0;">
        Capavate. Powered by Blueprint Catalyst Limited
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Password reset email sent:", info.response);
  });
}

exports.userRegister = async (req, res) => {
  const {
    referralCode,
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

            const fullName = first_name + " " + last_name;
            sendEmailLoginpassword(email, fullName || "User", password);

            if (referralCode !== "") {
              db.query(
                "SELECT * FROM shared_discount_code WHERE discount_code = ? AND email = ?",
                [referralCode, email],
                async (err, rowres) => {
                  if (err) {
                    return res
                      .status(500)
                      .json({ message: "Database query error", error: err });
                  }

                  if (rowres.length > 0) {
                    const checkadminCorp = rowres[0];
                    let refby = "";
                    let createdByType = "";

                    if (
                      checkadminCorp.shared_id === 0 &&
                      checkadminCorp.shared_by === "Admin"
                    ) {
                      refby = "Admin";
                      createdByType = "Admin";
                    } else {
                      refby = "Company";
                      createdByType = "Company";
                    }

                    const lastInsertedId = results.insertId;
                    const date = new Date();
                    const insertQuery = `
            INSERT INTO referralusage 
              (referred_by_id,referred_by, discount_code, used_by_company_id, registered_on, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `;
                    const insertValues = [
                      checkadminCorp.shared_id,
                      refby,
                      referralCode,
                      lastInsertedId,
                      date,
                      date,
                    ];

                    // Insert referral usage
                    db.query(insertQuery, insertValues, (err, insertRes) => {
                      if (err) {
                        console.error("Referral usage insert error:", err);
                      }
                    });

                    // 👇 Update `company` table with created_by_type and created_by
                    const updateQuery = `
            UPDATE company 
            SET created_by_type = ?, created_by = ? 
            WHERE id = ?
          `;
                    db.query(
                      updateQuery,
                      [createdByType, checkadminCorp.shared_id, lastInsertedId],
                      (err, updateRes) => {
                        if (err) {
                          console.error("Company update error:", err);
                        }
                      },
                    );
                  }
                },
              );
            }

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
      },
    );
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

function sendEmailLoginpassword(to, fullName, newPassword) {
  const subject = `Welcome to Capavate - Your Login Details`;

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Email</title>
    </head>
    <body style="background: #f9fafb; padding: 20px; font-family: Verdana, Geneva, sans-serif;">
      <div
        style="
          width: 600px;
          margin: 0 auto;
          border: 1px solid #e5e7eb;
          border-radius: 10px;
          overflow: hidden;
          background: #fff;
        "
      >
        <table
          style="
            width: 100%;
            border-collapse: collapse;
            font-family: Verdana, Geneva, sans-serif;
          "
        >
          <tr>
            <td style="background: #efefef; padding: 10px 0; text-align: center;">
              <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width: 130px;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 20px; color: #111; font-size: 14px;">
              <h2 style="margin: 0 0 15px 0; font-size: 18px; color: #111;">
                Dear ${fullName},
              </h2>
              <p style="margin: 0 0 15px 0;">
                Thank you for registering with <b>Capavate</b>.
              </p>
              <p style="margin: 0 0 15px 0;">
                Your account has been successfully created. Below are your login credentials:
              </p>
              <p style="margin: 0 0 10px 0;"><b>Email:</b> ${to}</p>
              <p style="margin: 0 0 15px 0;"><b>Password:</b> ${newPassword}</p>
              <p style="margin: 0 0 15px 0;">
                Please log in and change this password immediately to keep your account secure.
              </p>
              <p style="margin: 0 0 20px 0;">
                If you have any questions or need assistance, feel free to contact our support team.
              </p>
              <div style="text-align: center; margin: 20px 0;">
                <a
                  href="https://capavate.com/user/login"
                  style="
                    background: #CC0000;
                    color: #fff;
                    text-decoration: none;
                    font-size: 14px;
                    padding: 10px 30px;
                    border-radius: 10px;
                  "
                >Login Now</a>
              </div>
              <p style="margin: 30px 0 10px 0; font-size: 14px; text-align: center; color: #555;">
                Capavate Powered by <b>Blueprint Catalyst Ltd</b>
              </p>
            </td>
          </tr>
        </table>
      </div>
    </body>
  </html>
  `;

  const mailOptions = {
    from: "scale@blueprintcatalyst.com",
    to,
    subject,
    html: htmlBody, // ✅ use html instead of text
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Registration email sent:", info.response);
  });
}

exports.userLogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    db.query(
      "SELECT * FROM users WHERE email = ?",
      [email],
      async (err, rows) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        if (rows.length === 0) {
          return res
            .status(200)
            .json({ status: "2", message: "Invalid email or password" });
        }

        const user = rows[0];

        if (user.status !== "Active") {
          return res
            .status(200)
            .json({ status: "2", message: "Account is not active" });
        }

        // ✅ Compare password
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
          return res
            .status(200)
            .json({ status: "2", message: "Invalid email or password" });
        }

        // ✅ Generate JWT token with 1-hour expiry
        const token = jwt.sign(
          { id: user.id, email: user.email },
          JWT_SECRET,
          { expiresIn: "1h" }, // ⏰ 1 hour token expiry
        );

        // ✅ Send token & user info
        return res.status(200).json({
          message: "Login successfully",
          status: "1",
          id: user.id,
          email: user.email,
          name: user.name,
          access_token: token,
        });
      },
    );
  } catch (err) {
    return res.status(500).json({
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
    },
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
    format(new Date(slot.start), "yyyy-MM-dd HH:mm:ss"),
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
        format(new Date(row.meeting_date), "yyyy-MM-dd hh:mm a"),
      );
      const conflictingTimess = conflictResults.map((row) =>
        format(new Date(row.meeting_date), "yyyy-MM-dd"),
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
              data.module_id,
            );

            const meetingDateTime = format(
              new Date(slot.start),
              "yyyy-MM-dd HH:mm:ss",
            );

            const token = jwt.sign(
              {
                email: data.email,
                ip: data.ip_address,
                meetingId: zoomMeeting.id,
              },
              process.env.JWT_SECRET,
              { expiresIn: "1h" },
            );

            const uniqueCode = generateUniqueCode();
            const tokenExpiry = format(
              new Date(slot.start),
              "yyyy-MM-dd 23:00:00",
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
      },
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
      },
    );

    return response.data.access_token;
  } catch (err) {
    console.error(
      "Error fetching Zoom access token:",
      err.response?.data || err.message,
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
      },
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
      error.response?.data || error.message,
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
                "YYYY-MM-DD",
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
                  meeting.timezone,
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
        },
      );
    },
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
      },
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
          async (err, result) => {},
        );
        res.status(200).json({
          message: "",
          status: 1,
        });
      }
    },
  );
};

exports.getcategories = (req, res) => {
  const company_id = req.query.company_id || req.body.company_id;

  // Step 1: Check lock status from subscription_statuslockfile
  const lockQuery = `
    SELECT * 
    FROM subscription_statuslockfile 
    WHERE company_id = ? 
    LIMIT 1
  `;

  db.query(lockQuery, [company_id], (lockErr, lockResult) => {
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
        ddocs.company_id,
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
        AND ddocs.company_id = ?
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
        ddocs.company_id,
        ddocs.subcategory_id,
        dar.id,
        dar.summary

      ORDER BY dc.name, dsc.name ASC;
    `;

    db.query(query, [company_id], (err, results) => {
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
            (sc) => sc.id === row.subcategory_id,
          );

          if (!subcat) {
            subcat = {
              id: row.subcategory_id,
              name: row.subcategory_name,
              tips: row.subcategory_tips || "",
              summary_id: row.summary_id,
              summary_text: row.summary_text,
              company_id: row.company_id,
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
              company_id: row.company_id,
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
function generateActivationCode() {
  return crypto.randomBytes(20).toString("hex"); // 40-character hex string
}

exports.checkUserEmail = async (req, res) => {
  const { email, first_name, last_name, phone, password } = req.body;
  const checkCompanyQuery = "SELECT * FROM users WHERE email = ?";
  const activate_account_code = generateActivationCode();
  const hashedPassword = await bcrypt.hash(password, 12);
  db.query(checkCompanyQuery, [email], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    if (results.length > 0) {
      // ✅ Email already registered
      return res.status(200).json({
        message: "Email is already exists",
        status: "2",
      });
    } else {
      var date = new Date();
      const query = `INSERT INTO users (first_name,last_name,email,password,viewpassword,phone_number,activate_account_code,created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

      // Array of values for the query
      const values = [
        first_name,
        last_name,
        email,
        hashedPassword,
        password,
        phone, // Default to 'user'
        activate_account_code,
        date,
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
        var name = first_name + " " + last_name;
        sendEmailActivateAccount(email, name || "User", activate_account_code);

        res.status(200).json({
          message:
            "Account successfully created. Please check your email to activate your account.",
          status: "1",
          id: results.insertId,
          email: email,
          first_name: first_name,
          last_name: last_name,
          password: password,
        });
      });
    }
  });
};
exports.resendLink = async (req, res) => {
  const { email } = req.body;
  const checkCompanyQuery = "SELECT * FROM users WHERE email = ?";
  const activate_account_code = generateActivationCode();

  db.query(checkCompanyQuery, [email], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    if (results.length > 0) {
      var userData = results[0];
      if (userData.status === "Active") {
        res.status(200).json({
          message: "Account is already activate",
          status: 1,
        });
      } else {
        const updateQuery =
          "UPDATE users SET activate_account_code = ? WHERE email = ?";
        db.query(
          updateQuery,
          [activate_account_code, email],
          (err, updateResults) => {
            if (err) {
              return res.status(500).json({
                message: "Database update error",
                error: err,
              });
            }
            var name = userData.first_name + " " + userData.last_name;

            // 3️⃣ Send activation success email
            sendEmailResendActivateLink(email, name, activate_account_code);

            return res.status(200).json({
              message: "Please check your email to activate your account.",
              status: 1,
            });
          },
        );
      }
    } else {
      res.status(200).json({
        message: "Invalid detail",
        status: 2,
      });
    }
  });
};
exports.activateaccountcheck = async (req, res) => {
  const { email, code } = req.body;

  // 1️⃣ Check if the email and code exist in DB
  const checkQuery = "SELECT * FROM users WHERE email = ?";

  db.query(checkQuery, [email], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (results.length === 0) {
      // No user found with this email & code
      return res.status(200).json({
        message: "Invalid activation link or code.",
        status: "2",
      });
    } else {
      var checkdata = results[0];
      if (checkdata.activate_account_code === code) {
        if (checkdata.status === "Active") {
          return res.status(200).json({
            message:
              "Your account has been already activated! You can now log in.",
            status: "1",
            email: email,
            name: results[0].name,
          });
        } else {
          const updateQuery =
            "UPDATE users SET status = 'Active' WHERE email = ? AND activate_account_code = ?";
          db.query(updateQuery, [email, code], (err, updateResults) => {
            if (err) {
              return res.status(500).json({
                message: "Database update error",
                error: err,
              });
            }

            // 3️⃣ Send activation success email
            var name = results[0].first_name + " " + results[0].last_name;
            sendEmailAccountActivated(email, name || "User");

            return res.status(200).json({
              message:
                "Your account has been successfully activated! You can now log in.",
              status: "1",
              email: email,
              name: results[0].name,
            });
          });
        }
      } else {
        return res.status(200).json({
          message: "Invalid activation link or code.",
          status: "2",
        });
      }
    }
  });
};

// Example email function
function sendEmailAccountActivated(to, fullName) {
  const subject = "Your Capavate account is now active!";

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Account Activated</title>
    </head>
    <body style="background: #f9fafb; padding: 20px; font-family: Verdana, Geneva, sans-serif;">
      <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #fff;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="background: #efefef; padding: 10px 0; text-align: center;">
              <img src="https://capavate.com/api/upload/images/logo.png" alt="Capavate Logo" style="width: 130px;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 20px; color: #111; font-size: 14px;">
              <h2 style="margin: 0 0 15px 0; font-size: 18px; color: #111;">Hello ${fullName},</h2>
              <p style="margin: 0 0 15px 0;">
                Your account has been successfully activated. You can now log in using your credentials.
              </p>
              <div style="text-align: center; margin: 20px 0;">
                <a href="https://capavate.com/user/login" style="background:#CC0000; color:#fff; text-decoration:none; font-size:14px; padding:10px 30px; border-radius:10px;">Login Now</a>
              </div>
              <p style="margin: 30px 0 10px 0; font-size: 14px; text-align: center; color: #555;">
                Capavate Powered by <b>Blueprint Catalyst Ltd</b>
              </p>
            </td>
          </tr>
        </table>
      </div>
    </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Activation email sent:", info.response);
  });
}

function sendEmailResendActivateLink(to, fullName, activationCode) {
  const subject = "Activate your Capavate account";

  // Your frontend URL where users click to activate
  const activationUrl = `https://capavate.com/activate-account?code=${activationCode}&email=${encodeURIComponent(
    to,
  )}`;

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Activate Account</title>
    </head>
    <body style="background: #f9fafb; padding: 20px; font-family: Verdana, Geneva, sans-serif;">
      <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #fff;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="background: #efefef; padding: 10px 0; text-align: center;">
              <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width: 130px;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 20px; color: #111; font-size: 14px;">
              <h2>Hello ${fullName},</h2>
              
              <p>Please click the button below:</p>
              <div style="text-align: center; margin: 20px 0;">
                <a href="${activationUrl}" style="background: #CC0000; color: #fff; text-decoration: none; font-size: 14px; padding: 10px 30px; border-radius: 10px;">Activate Account</a>
              </div>
              <p>If you did not request this, please ignore this email.</p>
              <p style="margin-top: 30px; font-size: 14px; text-align: center; color: #555;">
                Capavate Powered by <b>Blueprint Catalyst Ltd</b>
              </p>
            </td>
          </tr>
        </table>
      </div>
    </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending activation email:", error);
    else console.log("Activation email sent:", info.response);
  });
}
function sendEmailActivateAccount(to, fullName, activationCode) {
  const subject = "Activate your Capavate account";

  // Your frontend URL where users click to activate
  const activationUrl = `https://capavate.com/activate-account?code=${activationCode}&email=${encodeURIComponent(
    to,
  )}`;

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Activate Account</title>
    </head>
    <body style="background: #f9fafb; padding: 20px; font-family: Verdana, Geneva, sans-serif;">
      <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #fff;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="background: #efefef; padding: 10px 0; text-align: center;">
              <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width: 130px;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 20px; color: #111; font-size: 14px;">
              <h2>Hello ${fullName},</h2>
              <p>Thank you for registering with <b>Capavate</b>.</p>
              <p>To activate your account, please click the button below:</p>
              <div style="text-align: center; margin: 20px 0;">
                <a href="${activationUrl}" style="background: #CC0000; color: #fff; text-decoration: none; font-size: 14px; padding: 10px 30px; border-radius: 10px;">Activate Account</a>
              </div>
              <p>If you did not request this, please ignore this email.</p>
              <p style="margin-top: 30px; font-size: 14px; text-align: center; color: #555;">
                Capavate Powered by <b>Blueprint Catalyst Ltd</b>
              </p>
            </td>
          </tr>
        </table>
      </div>
    </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending activation email:", error);
    else console.log("Activation email sent:", info.response);
  });
}

exports.checkCompanyEmail = (req, res) => {
  const { email, referralCode } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Email is required" });
  }

  const checkCompanyQuery = "SELECT * FROM company WHERE email = ?";

  db.query(checkCompanyQuery, [email], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (results.length > 0) {
      // ✅ Email already registered
      return res.status(200).json({
        message: "Email is already exists",
        status: "2",
      });
    } else {
      // ✅ Email is not registered yet
      if (referralCode) {
        // 🔍 Check if email + referralCode combo exists in shared_discount_code
        const sharedCodeQuery = `
          SELECT * FROM shared_discount_code 
          WHERE email = ? AND discount_code = ?
        `;

        db.query(
          sharedCodeQuery,
          [email.trim().toLowerCase(), referralCode.trim()],
          (err2, sharedResults) => {
            if (err2) {
              return res.status(500).json({
                message: "Error checking referral access",
                error: err2,
              });
            }

            if (sharedResults.length === 0) {
              return res.status(200).json({
                message: "Email is not authorized to use this referral code.",
                status: "2",
              });
            } else {
              return res.status(200).json({
                message: "",
                status: "1", // ✅ Allowed to register
              });
            }
          },
        );
      } else {
        // No referral code — allow registration
        return res.status(200).json({
          message: "",
          status: "1",
        });
      }
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
  var company_id = req.body.company_id;
  const query =
    "SELECT * FROM  usersubscriptiondata_academy where company_id = ? And end_date >= CURRENT_DATE";

  db.query(query, [company_id], (err, results) => {
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

  const apiKey =
    "728165937090-15b9f7n63pc8dfc8p7t59in8f0rk279h.apps.googleusercontent.com";

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address,
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
    const query = "SELECT * FROM users WHERE email = ?";

    db.query(query, [email], async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      if (results.length > 0) {
        console.log(results[0].status);
        if (results[0].status === "Active") {
          const pass = generateStrongPassword(8);
          const hashedPassword = await bcrypt.hash(pass, 12);

          const updateQuery =
            "UPDATE users SET password = ?, viewpassword = ? WHERE email = ?";
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
                message: "Password reset successfully, Please check your email",
              });
            },
          );
        } else {
          return res.status(200).json({
            status: 2,
            message:
              "Your account is not active. Please activate your account.",
          });
        }
      } else {
        console.log("ll");
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
  const subject = `Your Password Has Been Reset - Capavate`;

  // HTML Email Template (dynamic)
  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Password Reset</title>
  </head>
  <body>
    <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; font-family: Verdana, Geneva, sans-serif;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:10px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <h2 style="font-size:16px; color:#111;">Dear ${fullName},</h2>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              Your password has been successfully reset.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              Here is your new login password:
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:15px;"><b>${newPassword}</b></p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              We recommend that you log in and change this password immediately for your account's security.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              If you did not request this password reset, please contact our support team immediately.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:0;">Regards,<br/>Capavate Team</p>
          </td>
        </tr>
      </table>
      <div style="text-align:center; font-size:12px; color:#999; padding:10px 0;">
        Capavate. Powered by Blueprint Catalyst Limited
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlBody,
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
      registeredIds.includes(id),
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
        (id) => !validIds.includes(id),
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
            },
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
                  "YYYY-MM-DD",
                );
                const fullDateTimeStr = `${dateFormatted} ${meeting.time}:00`;

                if (
                  !moment(
                    fullDateTimeStr,
                    "YYYY-MM-DD HH:mm:ss",
                    true,
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
                    meeting.timezone,
                  );
                } catch (e) {
                  console.error("Timezone error:", e, meeting.timezone);
                  return null;
                }

                if (!meetingTimeInOriginal.isValid()) {
                  console.warn(
                    "Failed to parse meeting time:",
                    fullDateTimeStr,
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
            "YYYY-MM-DD",
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
              meeting.timezone,
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
            usertimezone: userTimeZone,
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
            meet_type: "Session",
            morevng: "",
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
      reminderTypes,
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
            "https://capavate.com/api/zoommeeting?token=" + meeting.unique_code;

          const replacements = {
            user_name: meeting.name || "User",
            meeting_topic: meeting.topic || "Zoom Meeting",
            event_time: meetingTimeInLocal.format(
              "dddd, MMMM Do YYYY [at] hh:mm A",
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
              [meeting.id],
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
  const id = req.body.company_id;

  db.query(
    `SELECT 
       company.*, 
       company_legal_information.mailing_address,
       company_legal_information.articles,
       company_legal_information.entity_name,
       company_legal_information.business_number,
       company_legal_information.jurisdiction_country,
       company_legal_information.entity_type,
       company_legal_information.date_of_incorporation,
       company_legal_information.entity_structure,
       company_legal_information.office_address
     FROM company
     LEFT JOIN company_legal_information 
       ON company_legal_information.company_id = company.id
     WHERE company.id = ?`,
    [id],
    async (err, row) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        message: "",
        results: row,
      });
    },
  );
};

exports.companydataUpdate = async (req, res) => {
  const { id, company_shares, first_name, last_name, phone, company_linkedin } =
    req.body;

  if (!id || !phone || !company_linkedin) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  const updateQuery = `
    UPDATE company
    SET company_shares=?,first_name = ?,last_name = ?, phone = ?, company_linkedin = ?
    WHERE id = ?
  `;

  db.query(
    updateQuery,
    [company_shares, first_name, last_name, phone, company_linkedin, id],
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
          phone,
          company_linkedin,
        },
      });
    },
  );
};

// controllers/subscription.js

exports.getusersSubscriptionPlan = async (req, res) => {
  const company_id = req.body.company_id;

  db.query(
    `SELECT * FROM usersubscriptiondataroomone_time WHERE company_id = ?`,
    [company_id],
    (err, dataroomOneTime) => {
      if (err) return res.status(500).json({ message: "Error 1", error: err });

      db.query(
        `SELECT * FROM usersubscriptiondataroom_perinstance WHERE company_id = ?`,
        [company_id],
        (err, perInstance) => {
          if (err)
            return res.status(500).json({ message: "Error 2", error: err });

          db.query(
            `SELECT * FROM userinvestorreporting_subscription WHERE company_id = ?`,
            [company_id],
            (err, reportingSub) => {
              if (err)
                return res.status(500).json({ message: "Error 3", error: err });

              db.query(
                `SELECT * FROM usersubscriptiondata_academy WHERE company_id = ?`,
                [company_id],
                (err, academySub) => {
                  if (err)
                    return res
                      .status(500)
                      .json({ message: "Error 4", error: err });

                  const result = {
                    dataroomOneTime: dataroomOneTime.length
                      ? dataroomOneTime[0]
                      : null,
                    perInstancePurchases: perInstance,
                    investorReporting: reportingSub.length
                      ? reportingSub[0]
                      : null,
                    academySubscription: academySub.length
                      ? academySub[0]
                      : null,
                  };

                  res.status(200).json({
                    success: true,
                    results: result,
                  });
                },
              );
            },
          );
        },
      );
    },
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
    },
  );
};

exports.sendcontactInfo = async (req, res) => {
  try {
    const data = req.body;

    // Combine first and last name
    const fullName = `${data.first_name} ${data.last_name}`;
    const dateFormatted = new Date().toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });

    await sendContactEmail({
      to: "scale@blueprintcatalyst.com", // Your internal email to receive the message
      fullName,
      phone: data.phone,
      email: data.email,
      message: data.message,
      dateFormatted,
    });

    res
      .status(200)
      .json({ success: true, message: "Contact info sent successfully." });
  } catch (error) {
    console.error("❌ Failed to send contact info:", error);
    res.status(500).json({ success: false, message: "Something went wrong." });
  }
};

function sendContactEmail({
  to,
  fullName,
  phone,
  email,
  message,
  dateFormatted,
}) {
  const subject = `📬 New Contact Form Submission from ${fullName}`;

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Contact Form Submission</title>
  </head>
  <body>
    <div style="width:600px; margin:0 auto; border:1px solid #e5e7eb; border-radius:10px; overflow:hidden; font-family:Verdana, Geneva, sans-serif;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:10px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <h2 style="font-size:16px; color:#111;">New Contact Request</h2>
            <p style="font-size:14px; color:#111; margin-bottom:10px;"><strong>Name:</strong> ${fullName}</p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;"><strong>Email:</strong> ${email}</p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;"><strong>Phone:</strong> ${phone}</p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;"><strong>Message:</strong><br/>${message}</p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;"><strong>Submitted on:</strong> ${dateFormatted}</p>
            <hr/>
            <p style="font-size:14px; color:#111; margin-top:20px;">
              This message was received from the website contact form.
            </p>
          </td>
        </tr>
      </table>
      <div style="text-align:center; font-size:12px; color:#999; padding:10px 0;">
        Capavate. Powered by Blueprint Catalyst Limited
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlContent,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("❌ Error sending contact email:", error);
    else console.log(`✅ Contact email sent to ${to}`);
  });
}

exports.checkreferralCode = async (req, res) => {
  var code = req.body.referralCode;
  db.query(
    "SELECT * FROM discount_code where code=? And exp_date >= CURRENT_DATE",
    [code],
    async (err, row) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        message: "",
        results: row,
      });
    },
  );
};

exports.checkReferralUser = async (req, res) => {
  const data = req.body;
  const { discount_code, emails, user_id } = data;

  if (!Array.isArray(emails) || emails.length === 0) {
    return res
      .status(400)
      .json({ message: "Email list is required", status: "0" });
  }

  // Step 1: Validate discount code
  db.query(
    "SELECT * FROM discount_code WHERE code = ? AND exp_date >= CURRENT_DATE",
    [discount_code],
    async (err, discountRows) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (discountRows.length === 0) {
        return res.status(200).json({ message: "Invalid code", status: "2" });
      }

      const discount = discountRows[0];

      if (discount.usage_limit <= discount.used_count) {
        return res
          .status(200)
          .json({ message: "Usage limit exceeded", status: "2" });
      }

      // Step 2: Check if any emails already registered in company
      db.query(
        "SELECT email FROM company WHERE email IN (?)",
        [emails],
        (err, companyRows) => {
          if (err) {
            return res
              .status(500)
              .json({ message: "Company email check failed", error: err });
          }

          if (companyRows.length > 0) {
            const existingEmails = companyRows.map((row) => row.email);
            return res.status(200).json({
              message: `These emails are already registered: ${existingEmails.join(
                ", ",
              )}`,
              status: "2",
            });
          }

          // Step 3: Check if already shared with these emails
          db.query(
            "SELECT email FROM shared_discount_code WHERE discount_code = ? AND email IN (?)",
            [discount_code, emails],
            (err, sharedRows) => {
              if (err) {
                return res
                  .status(500)
                  .json({ message: "Shared email check failed", error: err });
              }

              if (sharedRows.length > 0) {
                const alreadySharedEmails = sharedRows.map((row) => row.email);
                return res.status(200).json({
                  message: `Discount code already shared with: ${alreadySharedEmails.join(
                    ", ",
                  )}`,
                  status: "2",
                });
              }

              // Step 4: Get company name by user_id
              db.query(
                "SELECT * FROM company WHERE id = ?",
                [user_id],
                (err, companyInfoRows) => {
                  if (err || companyInfoRows.length === 0) {
                    return res.status(500).json({
                      message: "Could not fetch company name",
                      error: err || "Company not found",
                      status: "0",
                    });
                  }

                  const sharedBy = companyInfoRows[0].company_name;
                  const now = new Date();
                  const insertValues = emails.map((email) => [
                    "Company",
                    user_id,
                    discount_code,
                    email,
                    now,
                  ]);

                  // Step 5: Insert new discount_code + email rows
                  // ✅ Step 5: Insert new discount_code + email rows (batch insert)
                  db.query(
                    `INSERT INTO shared_discount_code (shared_by, shared_id, discount_code, email, created_at) VALUES ?`,
                    [insertValues],
                    async (err, results) => {
                      if (err) {
                        return res.status(500).json({
                          message: "Insert failed",
                          status: "0",
                          error: err,
                        });
                      }

                      // ✅ Step 6: Send emails after successful insert
                      try {
                        const [[codeInfo]] = await db
                          .promise()
                          .query(
                            `SELECT type FROM discount_code WHERE code = ? LIMIT 1`,
                            [discount_code],
                          );

                        let allowedModules = [];
                        try {
                          allowedModules = JSON.parse(codeInfo.type);
                          if (!Array.isArray(allowedModules)) {
                            allowedModules = codeInfo.type
                              .split(",")
                              .map((x) => x.trim());
                          }
                        } catch {
                          allowedModules = codeInfo.type
                            .split(",")
                            .map((x) => x.trim());
                        }

                        // Send email to each
                        await Promise.all(
                          emails.map((email) =>
                            sendsharedCode({
                              to: email,
                              isRegistered: false,
                              discount_code,
                              sharedBy,
                              context: "company_to_register",
                              allowedModules,
                            }),
                          ),
                        );

                        return res.status(200).json({
                          message: "Discount code shared and emails sent",
                          status: "1",
                        });
                      } catch (error) {
                        return res.status(500).json({
                          message:
                            "Failed to fetch discount type or send emails",
                          status: "0",
                          error,
                        });
                      }
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
};

const sendsharedCode = ({
  to,
  isRegistered,
  discount_code,
  sharedBy,
  context = "company_to_register",
  allowedModules = [],
}) => {
  const moduleNameMap = {
    Dataroom_Plus_Investor_Report: "Dataroom Plus Investor Report",
    Academy: "Academy Modules",
    Dataroom: "Data Room",
    Due_Diligence: "Due Diligence Services",
    Subscription: "Subscriptions",
  };

  const readableModules = allowedModules
    .map((key) => moduleNameMap[key] || key)
    .join("\n- ");

  let subject = "";
  let body = "";

  switch (context) {
    case "company_to_register":
      subject = `${sharedBy} has invited you to BluePrint Catalyst`;
      body = `Hello,

The company **${sharedBy}** has shared a referral code with you: ${discount_code}

Register using the link below to activate your discount:
https://capavate.com/register?ref=${discount_code}

With this code, you'll get benefits on:
- ${readableModules}

🚀 Join now and explore premium features for your business.

Best regards,  
BluePrint Catalyst Team`;
      break;

    // existing fallback cases
    case "registered_to_new":
      subject = `${sharedBy} Has Invited You to BluePrint Catalyst`;
      body = `Hello,

${sharedBy} has invited you to join BluePrint Catalyst and shared a discount code with you: ${discount_code}

Register using the link below to activate your discount:  
https://capavate.com/register?ref=${discount_code}

This gives you access to benefits across:
- ${readableModules}

Welcome aboard!

Best,  
BluePrint Catalyst Team`;
      break;

    case "registered_to_existing":
      subject = `You've Received a Discount Code via ${sharedBy}`;
      body = `Hello,

${sharedBy} has shared a discount code with you: ${discount_code}

Please log in to your BluePrint Catalyst account and apply this code to enjoy discounts on:
- ${readableModules}

Log in here: https://capavate.com/login

Happy scaling!  
BluePrint Catalyst Team`;
      break;

    default:
      subject = "BluePrint Catalyst Discount Code";
      body = `Hello,

Here is your discount code: ${discount_code}

Register or log in using the link below to redeem it:  
https://capavate.com/register?ref=${discount_code}

Best,  
BluePrint Catalyst Team`;
  }

  const mailOptions = {
    from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
    to,
    subject,
    text: body,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending email:", error);
    } else {
      console.log("Shared code email sent:", info.response);
    }
  });
};

exports.getallsharedCodeByCompany = (req, res) => {
  var data = req.body;
  db.query(
    "SELECT sdc.*, dc.percentage, CASE WHEN c.id IS NOT NULL THEN 'Yes' ELSE 'No' END AS company_email_match FROM shared_discount_code sdc JOIN discount_code dc ON dc.code = sdc.discount_code LEFT JOIN company c ON c.email COLLATE utf8mb4_general_ci = sdc.email WHERE sdc.shared_id = ? ORDER BY sdc.id DESC",
    [data.user_id],
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
    },
  );
};
exports.getallCodetrack = (req, res) => {
  const { id, user_id, discount_code } = req.body;
  const sharedQuery = `
    SELECT 
      sdc.*, 
      c.id AS company_id,
      c.company_name,
      c.email AS company_email
    FROM shared_discount_code sdc
    JOIN company c 
      ON c.email COLLATE utf8mb4_general_ci = sdc.email
    WHERE sdc.id = ? AND sdc.shared_by = 'Company' And sdc.shared_id =?
  `;

  db.query(sharedQuery, [id, user_id], (err, sharedResults) => {
    if (err) {
      return res.status(500).json({
        message: "Error fetching shared data",
        error: err,
      });
    }

    if (sharedResults.length === 0) {
      return res.status(200).json({
        message: "Shared code not found",
        status: "2",
      });
    }

    const shared = sharedResults[0];
    const companyId = shared.company_id;
    const companyEmail = shared.company_email;

    const usageQuery = `
      SELECT 
        id AS usage_id,
        payment_type,
        discounts,
        created_at AS used_at,
        discount_code
      FROM used_referral_code
      WHERE user_id = ? AND discount_code = ?
      ORDER BY created_at DESC
    `;

    db.query(usageQuery, [companyId, discount_code], (err, usageResults) => {
      if (err) {
        return res.status(500).json({
          message: "Error fetching usage data",
          error: err,
        });
      }

      // Inject company_email into each usage result
      const usageWithEmail = usageResults.map((row) => ({
        ...row,
        company_email: companyEmail,
      }));

      res.status(200).json({
        message: "Code tracking and usage data fetched successfully",
        shared: shared,
        usage: usageWithEmail,
        status: "1",
      });
    });
  });
};
exports.getallCodetrackSingleDetail = (req, res) => {
  const { id, idd, user_id, discount_code } = req.body;

  const sharedQuery = `
    SELECT 
      sdc.*, 
      c.id AS company_id,
      c.company_name,
      c.email AS company_email
    FROM shared_discount_code sdc
    JOIN company c 
      ON c.email COLLATE utf8mb4_general_ci = sdc.email
    WHERE sdc.id = ? AND sdc.shared_by = 'Company' And sdc.shared_id =?
  `;

  db.query(sharedQuery, [id, user_id], (err, sharedResults) => {
    if (err) {
      return res.status(500).json({
        message: "Error fetching shared data",
        error: err,
      });
    }

    if (sharedResults.length === 0) {
      return res.status(404).json({
        message: "Shared code not found",
      });
    }

    const shared = sharedResults[0];
    const companyId = shared.company_id;
    const companyEmail = shared.company_email;

    const usageQuery = `
      SELECT 
        id AS usage_id,
        payment_type,
        discounts,
        created_at AS used_at,
        discount_code
      FROM used_referral_code
      WHERE user_id = ? AND discount_code = ? And id =?
      ORDER BY created_at DESC
    `;

    db.query(
      usageQuery,
      [companyId, discount_code, idd],
      (err, usageResults) => {
        if (err) {
          return res.status(500).json({
            message: "Error fetching usage data",
            error: err,
          });
        }

        // Inject company_email into each usage result
        const usageWithEmail = usageResults.map((row) => ({
          ...row,
          company_email: companyEmail,
        }));

        res.status(200).json({
          message: "Code tracking and usage data fetched successfully",
          shared: shared,
          usage: usageWithEmail[0],
        });
      },
    );
  });
};

exports.get_SessionMeeting = (req, res) => {
  const module_id = req.body.module_id;
  const user_id = req.body.user_id;

  // Step 1: Fetch ALL meetings
  const allMeetingsQuery =
    "SELECT bs.* FROM broadcastesession bs INNER JOIN session_link_shared sls ON sls.broadcastesession_id = bs.id WHERE bs.module_id = ? AND sls.company_id = ?";
  db.query(allMeetingsQuery, [module_id, user_id], (err, allMeetings) => {
    if (err) {
      console.error("All meeting fetch error", err);
      return res
        .status(500)
        .json({ error: "DB error while fetching meetings" });
    }

    const finalMeetings = allMeetings
      .map((meeting) => {
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        if (!meeting.meeting_date || !meeting.time || !meeting.timezone) {
          console.warn(`Invalid meeting input:`, meeting);
          return null;
        }

        // Ensure date is in correct format (YYYY-MM-DD)
        const dateFormatted = moment(meeting.meeting_date).format("YYYY-MM-DD");
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
            meeting.timezone,
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
          usertimezone: userTimeZone,
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
          zoom_link: meeting.meetingLink,
          isRegistered: [],
          meet_type: "Broadcaste",
          morevng: meeting.session,
        };
      })
      .filter(Boolean);
    // remove any nulls

    return res.status(200).json({
      status: "success",
      meetings: finalMeetings,
    });
  });
};
// Function to generate a random HEX color
function generateRandomColor() {
  const letters = "0123456789ABCDEF";
  let color = "#";
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

exports.companyaddWithSignatory = (req, res) => {
  const {
    user_id,
    company_email,
    country_code,
    state_code,
    company_name,
    signatories,
    ...rest
  } = req.body;
  //console.log(req.body);
  //return;
  if (!company_name || !user_id) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  // Get user email & name
  db.query(
    "SELECT * FROM users WHERE id = ?",
    [user_id],
    (userErr, userResult) => {
      if (userErr || !userResult.length) {
        return res
          .status(500)
          .json({ message: "User not found", error: userErr });
      }

      const userEmail = userResult[0].email;
      const userName = userResult[0].first_name + " " + userResult[0].last_name;

      // Fetch existing company colors
      db.query(
        "SELECT * FROM company where company_email  = ?",
        [company_email],
        (colorErr, checkemail) => {
          if (colorErr) {
            return res.status(500).json({
              message: "Error fetching existing colors",
              error: colorErr,
            });
          }
          if (checkemail.length > 0) {
            return res.status(200).json({
              message: "This company email already exists",
              status: "2",
            });
          } else {
            db.query(
              "SELECT company_color_code FROM company",
              (colorErr, colorResults) => {
                if (colorErr) {
                  return res.status(500).json({
                    message: "Error fetching existing colors",
                    error: colorErr,
                  });
                }

                const usedColors = colorResults.map(
                  (c) => c.company_color_code,
                );

                // Generate a unique random color
                let assignedColor;
                let attempts = 0;
                do {
                  assignedColor = generateRandomColor();
                  attempts++;
                  if (attempts > 50) break; // fallback in case all colors clash
                } while (usedColors.includes(assignedColor));

                // Insert company with dynamic color
                var date = new Date();
                const companyInsertQuery = `
        INSERT INTO company
        (company_email,state_code,country_code,company_name, user_id, company_color_code, company_industory, phone, company_website, employee_number, year_registration, formally_legally, company_street_address, company_country, company_state, company_city, company_postal_code, descriptionStep4, problemStep4, solutionStep4,created_at)
        VALUES (?,?,?,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,?)
      `;

                db.query(
                  companyInsertQuery,
                  [
                    company_email,
                    state_code,
                    country_code,
                    company_name,
                    user_id,
                    assignedColor,
                    rest.company_industory || null,
                    rest.phone || null,
                    rest.company_website || null,
                    rest.employee_number || null,
                    rest.year_registration || null,
                    rest.formally_legally || null,
                    rest.company_street_address || null,
                    rest.company_country || null,
                    rest.company_state || null,
                    rest.city_step2 || null,
                    rest.company_postal_code || null,
                    rest.descriptionStep4 || null,
                    rest.problemStep4 || null,
                    rest.solutionStep4 || null,
                    date,
                  ],
                  (err, companyResult) => {
                    if (err) {
                      return res
                        .status(500)
                        .json({ message: "Company insert error", error: err });
                    }

                    const companyId = companyResult.insertId;

                    // Send email to company creator
                    sendEmailToUser(userEmail, userName, company_name);

                    // Insert signatories (same as before)
                    if (signatories && signatories.length) {
                      let insertedCount = 0;
                      const signatoryInsertQuery = `
              INSERT INTO company_signatories
              (company_id, unique_code, user_id, first_name, last_name, signatory_email, linked_in, signatory_phone, signature_role, access_status, invited_by, invited_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

                      signatories.forEach((s) => {
                        const uniqueCode = generateUniqueCode();
                        db.query(
                          signatoryInsertQuery,
                          [
                            companyId,
                            uniqueCode,
                            user_id,
                            s.first_name || null,
                            s.last_name || null,
                            s.signatory_email || null,
                            s.linked_in || null,
                            s.phone || null,
                            s.signature_role || null,
                            "pending",
                            user_id,
                            new Date(),
                          ],
                          (signErr) => {
                            if (signErr) {
                              return res.status(500).json({
                                message: "Signatory insert error",
                                error: signErr,
                              });
                            }

                            insertedCount++;
                            const inviteLink = `https://capavate.com/signatory/accept/${uniqueCode}`;
                            sendEmailToSignatory(
                              s.signatory_email,
                              `${s.first_name} ${s.last_name}`,
                              inviteLink,
                              company_name,
                            );

                            if (insertedCount === signatories.length) {
                              return res.status(200).json({
                                message:
                                  "Company and signatories added successfully",
                                companyId,
                                status: "1",
                                company_color_code: assignedColor,
                              });
                            }
                          },
                        );
                      });
                    } else {
                      return res.status(200).json({
                        message: "Company added successfully (no signatories)",
                        status: "1",
                        companyId,
                        company_color_code: assignedColor,
                      });
                    }
                  },
                );
              },
            );
          }
        },
      );
    },
  );
};

function sendEmailToUser(to, fullName, companyName) {
  const subject = `Company "${companyName}" Registered Successfully`;

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Company Registration</title>
  </head>
  <body>
    <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; font-family: Verdana, Geneva, sans-serif;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:15px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="Capavate Logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:25px;">
            <h2 style="font-size:18px; color:#111;">Dear ${fullName},</h2>
            <p style="font-size:14px; color:#111; margin-bottom:15px;">
              Your company "<b>${companyName}</b>" has been successfully registered on Capavate.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:15px;">
              You can now manage your company and track your company's progress through your dashboard.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:15px;">
              <a href="https://capavate.com/user/dashboard" style=" background: #CC0000;
                    color: #fff; padding:10px 20px; text-decoration:none; border-radius:5px; font-weight:bold;">Go to Dashboard</a>
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:0;">Regards,<br/>Capavate Team</p>
          </td>
        </tr>
      </table>
      <div style="text-align:center; font-size:12px; color:#999; padding:15px 0;">
        Capavate. Powered by Blueprint Catalyst Limited
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending company creator email:", error);
    else console.log("Company creator email sent:", info.response);
  });
}

function sendEmailToSignatory(to, fullName, inviteLink, company_name) {
  const subject = "You're Invited to Join the Company - Capavate";

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Invitation</title>
  </head>
  <body>
    <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; font-family: Verdana, Geneva, sans-serif; overflow: hidden;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:10px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <h2 style="font-size:16px; color:#111;">Dear ${fullName},</h2>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              You have been invited to join the company <strong>${company_name}</strong> on Capavate.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              Please click the button below to accept the invitation and complete your profile:
            </p>
            <p style="text-align:center; margin:20px 0;">
              <a href="${inviteLink}" style=" background: #CC0000;
                    color: #fff; padding:10px 20px; text-decoration:none; border-radius:5px; font-weight:bold;">
                Accept Invitation
              </a>
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:10px;">
              If you did not expect this email, please ignore it.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:0;">Regards,<br/>Capavate Team</p>
          </td>
        </tr>
      </table>
      <div style="text-align:center; font-size:12px; color:#999; padding:10px 0;">
        Capavate. Powered by Blueprint Catalyst Limited
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending invitation email:", error);
    else console.log("Invitation email sent:", info.response);
  });
}

exports.checkSubscriptionPlan = (req, res) => {
  const module_id = req.body.module_id;
  const user_id = req.body.user_id;

  // Step 1: Fetch ALL meetings
  const allMeetingsQuery =
    "SELECT bs.* FROM broadcastesession bs INNER JOIN session_link_shared sls ON sls.broadcastesession_id = bs.id WHERE bs.module_id = ? AND sls.company_id = ?";
  db.query(allMeetingsQuery, [module_id, user_id], (err, allMeetings) => {
    if (err) {
      console.error("All meeting fetch error", err);
      return res
        .status(500)
        .json({ error: "DB error while fetching meetings" });
    }

    const finalMeetings = allMeetings
      .map((meeting) => {
        const userTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        if (!meeting.meeting_date || !meeting.time || !meeting.timezone) {
          console.warn(`Invalid meeting input:`, meeting);
          return null;
        }

        // Ensure date is in correct format (YYYY-MM-DD)
        const dateFormatted = moment(meeting.meeting_date).format("YYYY-MM-DD");
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
            meeting.timezone,
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
          usertimezone: userTimeZone,
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
          zoom_link: meeting.meetingLink,
          isRegistered: [],
          meet_type: "Broadcaste",
          morevng: meeting.session,
        };
      })
      .filter(Boolean);
    // remove any nulls

    return res.status(200).json({
      status: "success",
      meetings: finalMeetings,
    });
  });
};

// Multer storage configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const company_id = req.body.company_id;
    const uploadPath = path.join(
      __dirname,
      "..",
      "..",
      "upload",
      "docs",
      `doc_${company_id}`,
      "company_profile",
    );
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}_${timestamp}${ext}`);
  },
});

exports.companyProfileUpdate = (req, res) => {
  const upload = multer({ storage }).single("articles");

  upload(req, res, function (err) {
    if (err) {
      console.error("File upload error:", err);
      return res.status(500).json({ error: "File upload failed" });
    }

    const company_id = req.body.company_id;
    // Build file path if uploaded
    const filePath = req.file
      ? path.join(
          "upload",
          "docs",
          `doc_${company_id}`,
          "company_profile",
          req.file.filename,
        )
      : null;
    console.log(req.body);

    // ✅ Update company table explicitly
    const companyUpdateQuery = `
      UPDATE company SET
        company_email = ?,
        company_name = ?,
        state_code = ?,
        country_code = ?,
        company_city = ?,
        company_website = ?,
        company_linkedin = ?,
        phone = ?,
        employee_number = ?,
        company_industory = ?,
        company_street_address = ?,
        company_state = ?,
        company_country = ?,
        company_postal_code = ?,
        descriptionStep4=?,
        problemStep4=?,
        solutionStep4=?
      WHERE id = ?
    `;

    const companyValues = [
      req.body.company_email || null,
      req.body.company_name || null,
      req.body.state_code || null,
      req.body.country_code || null,
      req.body.company_city || null,
      req.body.company_website || null,
      req.body.company_linkedin || null,
      req.body.phone || null,
      req.body.employee_number || null,
      req.body.company_industory || null,
      req.body.company_street_address || null,
      req.body.company_state || null,
      req.body.company_country || null,
      req.body.company_postal_code || null,
      req.body.descriptionStep4 || null,
      req.body.problemStep4 || null,
      req.body.solutionStep4 || null,
      company_id,
    ];

    db.query(companyUpdateQuery, companyValues, (err) => {
      if (err) console.error("Company update error:", err);
      db.query(
        "SELECT id FROM audit_logs WHERE user_id = ? AND company_id = ?",
        [req.body.user_id, company_id],
        (selectErr, rows) => {
          if (selectErr) {
            console.error("Audit log select error:", selectErr);
            return;
          }

          if (rows.length > 0) {
            // Record exists → update
            const logUpdateQuery = `
        UPDATE audit_logs
        SET module = ?, action = ?, entity_id = ?, entity_type = ?, details = ?, ip_address = ?
        WHERE id = ?
      `;
            const logUpdateValues = [
              "company-profile",
              "UPDATE",
              company_id,
              "company",
              JSON.stringify(req.body),
              req.body.ip_address,
              rows[0].id, // update the existing row
            ];

            db.query(logUpdateQuery, logUpdateValues, (updateErr) => {
              if (updateErr)
                console.error("Audit log update error:", updateErr);
              else console.log("Audit log updated successfully");
            });
          } else {
            // Record does not exist → insert new
            const logInsertQuery = `
        INSERT INTO audit_logs 
        (user_id, company_id, module, action, entity_id, entity_type, details, ip_address) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;
            const logInsertValues = [
              req.body.user_id,
              company_id,
              "company-profile",
              "UPDATE",
              company_id,
              "company",
              JSON.stringify(req.body),
              req.body.ip_address,
            ];

            db.query(logInsertQuery, logInsertValues, (insertErr) => {
              if (insertErr)
                console.error("Audit log insert error:", insertErr);
              else console.log("Audit log inserted successfully");
            });
          }
        },
      );
    });

    // ✅ Check if legal info exists
    db.query(
      "SELECT * FROM company_legal_information WHERE company_id = ?",
      [company_id],
      (err, rows) => {
        if (err) {
          console.error("Select error:", err);
          return res
            .status(500)
            .json({ error: "DB select failed", details: err });
        }
        const filename = req.file
          ? req.file.filename
          : rows[0]?.articles || null;
        if (rows.length > 0) {
          // ✅ Update legal info explicitly
          const legalUpdateQuery = `
            UPDATE company_legal_information SET
              user_id = ?,
              company_id = ?,
              articles = ?,
              entity_name = ?,
              business_number = ?,
              jurisdiction_country = ?,
              entity_type = ?,
              date_of_incorporation = ?,
              entity_structure = ?,
              office_address = ?,
              mailing_address = ?,
              created_at = NOW()
            WHERE company_id = ?
          `;
          const legalValues = [
            req.body.user_id,
            company_id,
            filename,
            req.body.entity_name || null,
            req.body.business_number || null,
            req.body.jurisdiction_country || null,
            req.body.entity_type || null,
            req.body.date_of_incorporation || null,
            req.body.entity_structure || null,
            req.body.office_address || null,
            req.body.mailing_address || null,
            company_id,
          ];

          db.query(legalUpdateQuery, legalValues, (err2) => {
            if (err2) {
              console.error("Legal update error:", err2);
              return res
                .status(500)
                .json({ error: "Legal info update failed", details: err2 });
            }
            return res.status(200).json({
              message: "Profile updated successfully",
              file: req.file ? req.file.filename : null,
              path: filePath,
            });
          });
        } else {
          // ✅ Insert legal info explicitly
          const legalInsertQuery = `
            INSERT INTO company_legal_information
  (user_id, company_id, articles, entity_name, business_number, jurisdiction_country, entity_type, date_of_incorporation, entity_structure, office_address, mailing_address, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

          `;
          const legalValues = [
            req.body.user_id,
            req.body.company_id,
            filename,
            req.body.entity_name || null,
            req.body.business_number || null,
            req.body.jurisdiction_country || null,
            req.body.entity_type || null,
            req.body.date_of_incorporation || null,
            req.body.entity_structure || null,
            req.body.office_address || null,
            req.body.mailing_address || null,
            new Date(),
          ];

          db.query(legalInsertQuery, legalValues, (err3) => {
            if (err3) {
              console.error("Legal insert error:", err3);
              return res
                .status(500)
                .json({ error: "Legal info insert failed", details: err3 });
            }
            return res.status(200).json({
              message: "Profile created successfully",
              file: req.file ? req.file.filename : null,
              path: filePath,
            });
          });
        }
      },
    );
  });
};

exports.checkUserLogin = (req, res) => {
  const user_id = req.body.user_id;

  // Step 1: Fetch ALL meetings
  const allMeetingsQuery = "SELECT * from users where id = ?";
  db.query(allMeetingsQuery, [user_id], (err, allMeetings) => {
    if (err) {
      console.error("All meeting fetch error", err);
      return res
        .status(500)
        .json({ error: "DB error while fetching meetings" });
    }

    return res.status(200).json({
      status: "success",
      results: allMeetings,
    });
  });
};
exports.checkSignatoryLogin = (req, res) => {
  const signatory_id = req.body.signatory_id;

  // Step 1: Fetch ALL meetings
  const allMeetingsQuery = "SELECT * from company_signatories where id = ?";
  db.query(allMeetingsQuery, [signatory_id], (err, allMeetings) => {
    if (err) {
      console.error("All meeting fetch error", err);
      return res
        .status(500)
        .json({ error: "DB error while fetching meetings" });
    }

    return res.status(200).json({
      status: "success",
      results: allMeetings,
    });
  });
};

// Multer storage for uploaded signatures
const storageSignature = multer.diskStorage({
  destination: (req, file, cb) => {
    const company_id = req.body.company_id;
    const uploadPath = path.join(
      __dirname,
      "..",
      "..",
      "upload",
      "docs",
      `doc_${company_id}`,
      "signatory",
    );
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    cb(null, `${file.fieldname}_${timestamp}${ext}`);
  },
});

const uploadSignature = multer({ storage: storageSignature }).single("file");
exports.authorizedSignature = (req, res) => {
  uploadSignature(req, res, (err) => {
    if (err) {
      console.error("File upload error:", err);
      return res.status(500).json({
        status: "error",
        message: "File upload failed",
        error: err,
      });
    }

    const {
      email,
      company_id,
      signatory_id,
      ip_address,
      method,
      manual,
      signature_pad,
    } = req.body;

    let signatureValue = "";

    if (method === "upload" && req.file) {
      signatureValue = req.file.filename; // ✅ filename is now available
    } else if (method === "manual" && manual) {
      signatureValue = manual;
    } else if (method === "pad" && signature_pad) {
      signatureValue = signature_pad;
    } else {
      return res.status(400).json({
        status: "error",
        message: "Invalid signature data",
      });
    }

    const checkQuery =
      "SELECT * FROM authorized_signature WHERE company_id = ? AND company_signatories_id = ?";
    db.query(checkQuery, [company_id, signatory_id], (err, rows) => {
      if (err) {
        console.error("DB select error:", err);
        return res
          .status(500)
          .json({ status: "error", message: "DB error", error: err });
      }

      if (rows.length > 0) {
        // Update
        const updateQuery =
          "UPDATE authorized_signature SET type = ?, signature = ? WHERE company_id = ? AND company_signatories_id  = ?";
        db.query(
          updateQuery,
          [method, signatureValue, company_id, signatory_id],
          (err2) => {
            if (err2) {
              console.error("DB update error:", err2);
              return res.status(500).json({
                status: "error",
                message: "DB update failed",
                error: err2,
              });
            }
            return res.status(200).json({
              status: "success",
              message: "Signature updated successfully",
            });
          },
        );
      } else {
        // Insert
        // Get company_signatories id first
        const getSignatoryQuery = `
  SELECT id 
  FROM company_signatories 
  WHERE signatory_email = ? AND company_id = ?
  LIMIT 1
`;

        db.query(
          getSignatoryQuery,
          [email, company_id],
          (errSignatory, signatoryResults) => {
            if (errSignatory) {
              console.error("Error fetching signatory:", errSignatory);
              return res.status(500).json({
                status: "error",
                message: "Error fetching signatory data",
                error: errSignatory,
              });
            }

            if (signatoryResults.length === 0) {
              return res.status(404).json({
                status: "error",
                message: "Signatory not found for this company",
              });
            }

            const company_signatories_id = signatoryResults[0].id;

            // Now get company user_id
            const companyQuery = "SELECT user_id FROM company WHERE id = ?";
            db.query(
              companyQuery,
              [company_id],
              (errCompany, companyResults) => {
                if (errCompany) {
                  console.error("Error fetching company:", errCompany);
                  return res.status(500).json({
                    status: "error",
                    message: "Error fetching company data",
                    error: errCompany,
                  });
                }

                if (companyResults.length === 0) {
                  return res.status(404).json({
                    status: "error",
                    message: "Company not found",
                  });
                }

                const companyOwned_id = companyResults[0].user_id;

                // Insert into authorized_signature with company_signatories_id
                const insertQuery = `
      INSERT INTO authorized_signature 
      (company_id, user_id, company_signatories_id , type, signature) 
      VALUES (?, ?, ?,  ?, ?)
    `;

                db.query(
                  insertQuery,
                  [
                    company_id,
                    companyOwned_id,
                    company_signatories_id,
                    method,
                    signatureValue,
                  ],
                  (err3) => {
                    if (err3) {
                      console.error("DB insert error:", err3);
                      return res.status(500).json({
                        status: "error",
                        message: "DB insert failed",
                        error: err3,
                      });
                    }

                    const auditDetails = "Signature submitted";

                    // 1️⃣ Log into audit_logs
                    const auditQuery = `
          INSERT INTO audit_logs 
          (user_id, company_id, module, action, entity_id, entity_type, details, ip_address, created_at) 
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

                    const auditValues = [
                      signatory_id,
                      company_id,
                      "Authorized Signature",
                      "Create",
                      null,
                      "authorized_signature",
                      JSON.stringify(req.body),
                      ip_address,
                    ];

                    db.query(auditQuery, auditValues, (errAudit) => {
                      if (errAudit) console.error("Audit log error:", errAudit);
                      else console.log("Audit log saved successfully");
                    });

                    // 2️⃣ Notify company owner
                    const userquery =
                      "SELECT * FROM company_signatories WHERE id = ?";
                    db.query(
                      userquery,
                      [company_signatories_id],
                      (err, results) => {
                        if (err) {
                          console.error("Error fetching signatory data:", err);
                        }
                        if (results.length > 0) {
                          const userData = results[0];
                          const userFullName =
                            userData.first_name + " " + userData.last_name;
                          notifyCompanyOwner(company_id, userFullName);
                        }
                      },
                    );

                    // 3️⃣ Return response
                    return res.status(200).json({
                      status: "success",
                      message: "Signature saved successfully",
                    });
                  },
                );
              },
            );
          },
        );
      }
    });
  });
};

exports.getAuthorizedSignature = (req, res) => {
  const company_id = req.body.company_id;
  const user_id = req.body.user_id;

  // Step 1: Fetch ALL meetings
  const allMeetingsQuery =
    "SELECT * from authorized_signature where company_signatories_id  = ? And company_id = ?";
  db.query(allMeetingsQuery, [user_id, company_id], (err, row) => {
    if (err) {
      console.error("All meeting fetch error", err);
      return res
        .status(500)
        .json({ error: "DB error while fetching meetings" });
    }

    return res.status(200).json({
      status: "success",
      results: row,
    });
  });
};

// After saving or updating the signature, fetch company owner details and send email
const notifyCompanyOwner = (company_id, user_name) => {
  const query = `
    SELECT u.first_name, u.last_name, u.email, c.company_name
    FROM company c 
    JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `;

  db.query(query, [company_id], (err, results) => {
    if (err) {
      console.error("Error fetching company owner:", err);
      return;
    }

    if (results.length === 0) return;

    const owner = results[0];
    const fullName = owner.first_name + " " + owner.last_name;
    const companyName = owner.company_name; // added company name

    // Send email
    const subject = `New Signature Submitted for ${companyName} - Approval Required`;

    const htmlBody = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Signature Approval</title>
    </head>
    <body>
      <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; font-family: Verdana, Geneva, sans-serif;">
        <table style="width:100%; border-collapse: collapse;">
          <tr>
            <td style="background:#efefef; padding:10px; text-align:center;">
              <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
            </td>
          </tr>
          <tr>
            <td style="padding:20px;">
              <h2 style="font-size:16px; color:#111;">Dear ${fullName},</h2>
              <p style="font-size:14px; color:#111; margin-bottom:10px;">
                A new signature has been submitted by <b>${user_name}</b> for <b>${companyName}</b> and is pending your approval.
              </p>
              <p style="font-size:14px; color:#111; margin-bottom:10px;">
                Please log in to your dashboard to review and approve this signature.
              </p>
              <p style="font-size:14px; color:#111; margin-bottom:0;">Regards,<br/>Capavate Team</p>
            </td>
          </tr>
        </table>
        <div style="text-align:center; font-size:12px; color:#999; padding:10px 0;">
          Capavate. Powered by Blueprint Catalyst Limited
        </div>
      </div>
    </body>
    </html>
    `;

    const mailOptions = {
      from: '"Capavate" <scale@blueprintcatalyst.com>',
      to: owner.email,
      subject,
      html: htmlBody,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) console.error("Error sending email:", error);
      else console.log("Signature notification email sent:", info.response);
    });
  });
};

exports.getAllUserSignature = (req, res) => {
  const user_id = req.body.user_id;

  // Step 1: Fetch ALL meetings
  const allMeetingsQuery =
    "SELECT authorized_signature.*,company.company_name,company_signatories.first_name,company_signatories.last_name from authorized_signature join company_signatories on company_signatories.id = authorized_signature.company_signatories_id  join company on company.id = authorized_signature.company_id  where authorized_signature.user_id = ? order by authorized_signature.id desc";
  db.query(allMeetingsQuery, [user_id], (err, results) => {
    if (err) {
      console.error("All meeting fetch error", err);
      return res
        .status(500)
        .json({ error: "DB error while fetching meetings" });
    }

    return res.status(200).json({
      status: "success",
      results: results,
    });
  });
};

exports.declineSignature = (req, res) => {
  const { id, reason } = req.body;

  if (!id || !reason) {
    return res
      .status(400)
      .json({ error: "Signature ID and reason are required." });
  }

  // Step 1: Fetch signatory and company info BEFORE deletion
  const selectQuery = `
    SELECT a.id, a.company_id, a.company_signatories_id,
           c.company_name,
           s.first_name AS signatory_first_name, s.last_name AS signatory_last_name, s.signatory_email
    FROM authorized_signature a
    JOIN company_signatories s ON a.company_signatories_id = s.id
    JOIN company c ON a.company_id = c.id
    WHERE a.id = ?
  `;

  db.query(selectQuery, [id], (errSelect, results) => {
    if (errSelect) {
      console.error("Error fetching signature info:", errSelect);
      return res.status(500).json({ error: "Failed to fetch signature info." });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Signature not found." });
    }

    const data = results[0];
    const signatoryFullName = `${data.signatory_first_name} ${data.signatory_last_name}`;
    const companyName = data.company_name;
    const signatoryEmail = data.signatory_email;

    // Step 2: Send decline email
    sendDeclineEmail(signatoryEmail, signatoryFullName, companyName, reason);

    // Step 3: Delete the signature record
    const deleteQuery = `DELETE FROM authorized_signature WHERE id = ?`;
    db.query(deleteQuery, [id], (errDelete) => {
      if (errDelete) {
        console.error("Error deleting signature:", errDelete);
        return res.status(500).json({ error: "Failed to delete signature." });
      }

      return res.status(200).json({
        status: "success",
        message: "Signature declined, email sent, and record deleted.",
      });
    });
  });
};

// Utility function to send decline email
function sendDeclineEmail(to, fullName, companyName, reason) {
  const subject = `Signature Declined for Company "${companyName}"`;

  const htmlBody = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Signature Declined</title>
    </head>
    <body>
      <div style="width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;font-family:Verdana,Geneva,sans-serif;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="background:#efefef;padding:15px;text-align:center;">
              <img src="https://capavate.com/api/upload/images/logo.png" alt="Capavate Logo" style="width:130px;" />
            </td>
          </tr>
          <tr>
            <td style="padding:25px;">
              <h2 style="font-size:18px;color:#111;">Dear ${fullName},</h2>
              <p style="font-size:14px;color:#111;margin-bottom:15px;">
                Your signature for the company "<b>${companyName}</b>" has been <b>declined</b>.
              </p>
              <p style="font-size:14px;color:#111;margin-bottom:15px;">
                Reason for decline: <i>${reason}</i>
              </p>
              <p style="font-size:14px;color:#111;margin-bottom:15px;">
                Please review and submit your signature again if required.
              </p>
              <p style="font-size:14px;color:#111;margin-bottom:15px;">
                <a href="https://capavate.com/authorized-signature" style="background:#CC0000;color:#fff;padding:10px 20px;text-decoration:none;border-radius:5px;font-weight:bold;">Click Here</a>
              </p>
              <p style="font-size:14px;color:#111;margin-bottom:0;">Regards,<br/>Capavate Team</p>
            </td>
          </tr>
        </table>
        <div style="text-align:center;font-size:12px;color:#999;padding:15px 0;">
          Capavate. Powered by Blueprint Catalyst Limited
        </div>
      </div>
    </body>
    </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending decline email:", error);
    else console.log("Decline email sent:", info.response);
  });
}

exports.approveSignature = (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ error: "Signature ID is required." });
  }

  // Step 1: Update the signature to approved
  const updateQuery = `UPDATE authorized_signature SET approve = 'Yes' WHERE id = ?`;

  db.query(updateQuery, [id], (err, result) => {
    if (err) {
      console.error("Error approving signature:", err);
      return res.status(500).json({ error: "Failed to approve signature." });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Signature not found." });
    }

    // Step 2: Fetch signatory and company info to send email
    const selectQuery = `
      SELECT a.id, a.company_id, a.company_signatories_id ,
             c.company_name,
             s.first_name AS signatory_first_name, 
             s.last_name AS signatory_last_name, 
             s.signatory_email
      FROM authorized_signature a
      JOIN company_signatories s ON a.company_signatories_id  = s.id
      JOIN company c ON a.company_id = c.id
      WHERE a.id = ?
    `;

    db.query(selectQuery, [id], (errSelect, results) => {
      if (errSelect) {
        console.error("Error fetching signature info:", errSelect);
        return res
          .status(500)
          .json({ error: "Failed to fetch signature info." });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: "Signature not found." });
      }

      const data = results[0];
      const signatoryFullName = `${data.signatory_first_name} ${data.signatory_last_name}`;
      const companyName = data.company_name;
      const signatoryEmail = data.signatory_email;

      // Step 3: Send approval email
      sendApprovalEmail(signatoryEmail, signatoryFullName, companyName);

      return res.status(200).json({
        status: "success",
        message: "Signature approved and email sent successfully.",
      });
    });
  });
};

// Example function for sending approval email
function sendApprovalEmail(to, fullName, companyName) {
  const subject = `Signature Approved for Company "${companyName}"`;

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Signature Approved</title>
  </head>
  <body>
    <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; font-family: Verdana, Geneva, sans-serif; overflow: hidden;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:15px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="Capavate Logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:25px;">
            <h2 style="font-size:18px; color:#111;">Dear ${fullName},</h2>
            <p style="font-size:14px; color:#111; margin-bottom:15px;">
              Your signature for the company "<b>${companyName}</b>" has been <span style="color:green; font-weight:bold;">approved successfully</span>.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:15px;">
              You can now manage your company and perform all actions available on your dashboard.
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:15px;">
              <a href="https://capavate.com/authorized-signature" style="background:#CC0000; color:#fff; padding:10px 20px; text-decoration:none; border-radius:5px; font-weight:bold;">
                Click Here
              </a>
            </p>
            <p style="font-size:14px; color:#111; margin-bottom:0;">Regards,<br/>Capavate Team</p>
          </td>
        </tr>
      </table>
      <div style="text-align:center; font-size:12px; color:#999; padding:15px 0;">
        Capavate. Powered by Blueprint Catalyst Limited
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to,
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending approval email:", error);
    else console.log("Approval email sent:", info.response);
  });
}

exports.capavatecontact = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, message } = req.body;

    if (!firstName || !lastName || !email || !message) {
      return res
        .status(400)
        .json({ message: "All required fields must be filled" });
    }

    const fullName = `${firstName} ${lastName}`;

    // Send email
    sendContactEmail(email, fullName, phone, message);

    return res.status(200).json({ message: "Message sent successfully" });
  } catch (err) {
    console.error("Error:", err);
    return res.status(500).json({ message: "Something went wrong" });
  }
};
function sendContactEmail(to, fullName, phone, message) {
  const subject = `New Contact Message from ${fullName}`;

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>New Contact Message</title>
  </head>
  <body>
    <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; font-family: Verdana, sans-serif;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:15px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="Capavate Logo" style="width:130px;" />
          </td>
        </tr>

        <tr>
          <td style="padding:25px;">
            <h2 style="font-size:18px; color:#111;">New Contact Form Submission</h2>

            <p style="font-size:14px; color:#111;"><b>Name:</b> ${fullName}</p>
            <p style="font-size:14px; color:#111;"><b>Email:</b> ${to}</p>
            <p style="font-size:14px; color:#111;"><b>Phone:</b> ${
              phone || "Not Provided"
            }</p>

            <p style="font-size:14px; color:#111; margin-top:20px;"><b>Message:</b></p>
            <p style="font-size:14px; color:#111;">${message}</p>

            <p style="font-size:14px; color:#111; margin-top:25px;">Regards,<br/>Capavate Website</p>
          </td>
        </tr>
      </table>

      <div style="text-align:center; font-size:12px; color:#999; padding:15px 0;">
        Capavate. Powered by Blueprint Catalyst Limited
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate" <scale@blueprintcatalyst.com>',
    to: "scale@blueprintcatalyst.com", // Admin receives contact form
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending contact email:", error);
    else console.log("Contact email sent:", info.response);
  });
}

exports.getcountrySymbolLocal = (req, res) => {
  var company_id = req.body.company_id;
  db.query(
    "SELECT * FROM company where id = ?",
    [company_id],
    async (err, row) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        message: "",
        results: row,
      });
    },
  );
};
// Controller: registerController.contactform
exports.contactform = async (req, res) => {
  console.log(req.body);
  try {
    const {
      firstName,
      lastName,
      email,
      mobile,
      companyName,
      companyWebsite,
      city,
      country,
      sectorFocus,
      message,
    } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !mobile) {
      return res.status(400).json({
        success: false,
        message: "Please fill all required fields",
      });
    }

    // Send email - wrapped in try-catch and awaited if async
    try {
      await sendContactFormEmail({
        firstName,
        lastName,
        email,
        mobile,
        companyName,
        companyWebsite,
        city,
        country,
        sectorFocus,
        message,
      });
    } catch (emailError) {
      console.error("Email sending error:", emailError);
      // Continue anyway - you might want to log this but still return success
    }

    return res.status(200).json({
      success: true,
      message: "Your inquiry has been submitted successfully!",
    });
  } catch (error) {
    console.error("Contact form error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again later.",
    });
  }
};
function sendContactFormEmail(data) {
  const {
    firstName,
    lastName,
    email,
    mobile,
    companyName,
    companyWebsite,
    city,
    country,
    sectorFocus,
    message,
  } = data;

  const subject = `New Contact Form Inquiry - ${firstName} ${lastName}`;

  // Format sector focus array
  const sectors = Array.isArray(sectorFocus)
    ? sectorFocus.map((s) => s.label || s.value || s).join(", ")
    : sectorFocus || "Not specified";

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>New Contact Inquiry</title>
  </head>
  <body>
    <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; font-family: Verdana, Geneva, sans-serif;">
      <table style="width:100%; border-collapse: collapse;">
        <tr>
          <td style="background:#efefef; padding:10px; text-align:center;">
            <img src="https://capavate.com/api/upload/images/logo.png" alt="logo" style="width:130px;" />
          </td>
        </tr>
        <tr>
          <td style="padding:20px;">
            <h2 style="font-size:18px; color:#111; margin-bottom:20px;">New Contact Form Submission</h2>
            
            <table style="width:100%; font-size:14px; color:#111;">
              <tr>
                <td style="padding:8px 0; font-weight:bold; width:40%;">Name:</td>
                <td style="padding:8px 0;">${firstName} ${lastName}</td>
              </tr>
              <tr style="background:#f9f9f9;">
                <td style="padding:8px 0; font-weight:bold;">Email:</td>
                <td style="padding:8px 0;">${email}</td>
              </tr>
              <tr>
                <td style="padding:8px 0; font-weight:bold;">Mobile:</td>
                <td style="padding:8px 0;">${mobile}</td>
              </tr>
              ${
                companyName
                  ? `
              <tr style="background:#f9f9f9;">
                <td style="padding:8px 0; font-weight:bold;">Company Name:</td>
                <td style="padding:8px 0;">${companyName}</td>
              </tr>
              `
                  : ""
              }
              ${
                companyWebsite
                  ? `
              <tr>
                <td style="padding:8px 0; font-weight:bold;">Company Website:</td>
                <td style="padding:8px 0;"><a href="${companyWebsite}" target="_blank">${companyWebsite}</a></td>
              </tr>
              `
                  : ""
              }
              ${
                city
                  ? `
              <tr style="background:#f9f9f9;">
                <td style="padding:8px 0; font-weight:bold;">City:</td>
                <td style="padding:8px 0;">${city}</td>
              </tr>
              `
                  : ""
              }
              ${
                country
                  ? `
              <tr>
                <td style="padding:8px 0; font-weight:bold;">Country:</td>
                <td style="padding:8px 0;">${country}</td>
              </tr>
              `
                  : ""
              }
              <tr style="background:#f9f9f9;">
                <td style="padding:8px 0; font-weight:bold;">Sector Focus:</td>
                <td style="padding:8px 0;">${sectors}</td>
              </tr>
              ${
                message
                  ? `
              <tr>
                <td style="padding:8px 0; font-weight:bold; vertical-align:top;">Message:</td>
                <td style="padding:8px 0;">${message}</td>
              </tr>
              `
                  : ""
              }
            </table>

            <p style="font-size:14px; color:#111; margin-top:20px;">
              Submitted on: ${new Date().toLocaleString("en-US", {
                dateStyle: "full",
                timeStyle: "short",
              })}
            </p>
          </td>
        </tr>
      </table>
      <div style="text-align:center; font-size:12px; color:#999; padding:10px 0;">
        Capavate. Powered by Blueprint Catalyst Limited
      </div>
    </div>
  </body>
  </html>
  `;

  const mailOptions = {
    from: '"Capavate Contact Form" <scale@blueprintcatalyst.com>',
    to: "venture@capavate.com",
    replyTo: email, // Allows you to reply directly to the user
    subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending contact form email:", error);
    else console.log("Contact form email sent:", info.response);
  });
}
// ✅ CORRECTED: Handles duplicate device_id without losing data
exports.trackVisitor = (req, res) => {
  try {
    const {
      country = null,
      state = null,
      ip_address = null,
      device_id = null,
      device_type = null,
      is_mobile = 0,
      user_agent = null,
      page_url = null,
      referrer = null,
    } = req.body;

    // Validate required fields
    if (!device_id || !page_url) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: device_id and page_url are required",
      });
    }

    console.log("📊 Tracking attempt for device:", {
      device_id_short: device_id ? `${device_id.substring(0, 10)}...` : null,
      page_url,
    });

    // ✅ STEP 1: Check if device_id already exists
    const checkSql = `
      SELECT id, COUNT(*) as total_visits 
      FROM visitors 
      WHERE device_id = ?
    `;

    db.query(checkSql, [device_id], (err, results) => {
      if (err) {
        console.error("❌ Database check error:", err);
        return res.status(500).json({
          success: false,
          message: "Failed to check visitor data",
          error: err.message,
        });
      }

      // ✅ STEP 2: If device_id already exists, REJECT IT (DO NOT INSERT)
      if (results && results.length > 0 && results[0].total_visits > 0) {
        console.log("❌ Device already exists, rejecting duplicate:", {
          device_id_short: device_id
            ? `${device_id.substring(0, 10)}...`
            : null,
          existing_id: results[0].id,
          total_visits: results[0].total_visits,
        });

        return res.status(409).json({
          success: false,
          message:
            "This device has already been tracked. No duplicate records allowed.",
          existingVisitorId: results[0].id,
          isDuplicate: true,
          totalVisits: results[0].total_visits,
          timestamp: new Date().toISOString(),
        });
      }

      // ✅ STEP 3: If NEW device (doesn't exist), insert it
      const insertSql = `
        INSERT INTO visitors 
        (country, state, ip_address, device_id, device_type, is_mobile, 
         user_agent, page_url, referrer, date, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
      `;

      const values = [
        country,
        state,
        ip_address,
        device_id,
        device_type,
        is_mobile ? 1 : 0,
        user_agent,
        page_url,
        referrer,
      ];

      db.query(insertSql, values, (err, result) => {
        if (err) {
          console.error("❌ Insert error:", err);
          return res.status(500).json({
            success: false,
            message: "Failed to record visitor data",
            error: err.message,
          });
        }

        // ✅ Success - ONLY NEW device saved
        console.log("✅ NEW device recorded (first visit):", {
          visitorId: result.insertId,
          device_id_short: device_id
            ? `${device_id.substring(0, 10)}...`
            : null,
        });

        return res.status(201).json({
          success: true,
          message: "New visitor recorded successfully",
          visitorId: result.insertId,
          isDuplicate: false,
          isReturningVisitor: false,
          totalVisits: 1,
          timestamp: new Date().toISOString(),
        });
      });
    });
  } catch (error) {
    console.error("❌ Visitor tracking error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to record visitor data",
      error: error.message,
    });
  }
};
// controllers/visitorController.js

// ✅ 1. Get all visitors (GET)
exports.visitors = (req, res) => {
  try {
    const { page = 1, limit = 100 } = req.body;
    const offset = (page - 1) * limit;

    // Count total visitors first
    const countSql = `SELECT COUNT(*) as total FROM visitors`;

    db.query(countSql, (err, countResult) => {
      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message,
        });
      }

      const total = countResult[0].total || 0;

      // Get paginated data
      const sql = `
        SELECT 
          id, 
          country, 
          state, 
          ip_address, 
          device_id, 
          device_type, 
          is_mobile,
          user_agent,
          page_url,
          referrer,
          DATE_FORMAT(date, '%Y-%m-%d %H:%i:%s') as date,
          DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
        FROM visitors 
        ORDER BY date DESC 
        LIMIT ? OFFSET ?
      `;

      db.query(sql, [parseInt(limit), offset], (err, results) => {
        if (err) {
          return res.status(500).json({
            success: false,
            error: err.message,
          });
        }

        res.json({
          success: true,
          visitors: results || [],
          total: total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit),
        });
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
exports.visitorstats = (req, res) => {
  try {
    const sql = `
      SELECT 
        COUNT(*) as totalVisitors,
        COUNT(DISTINCT device_id) as uniqueDevices,
        SUM(is_mobile = 1) as mobileVisitors,
        SUM(DATE(date) = CURDATE()) as todayVisitors,
        SUM(DATE(date) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)) as yesterdayVisitors,
        COUNT(DISTINCT country) as countriesCount
      FROM visitors
    `;

    db.query(sql, (err, results) => {
      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message,
        });
      }

      const stats = results[0] || {
        totalVisitors: 0,
        uniqueDevices: 0,
        mobileVisitors: 0,
        todayVisitors: 0,
        yesterdayVisitors: 0,
        countriesCount: 0,
      };

      res.json({
        success: true,
        ...stats, // Flatten the stats object
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
// ✅ 3. Get visitor by ID (GET)
exports.getVisitorById = (req, res) => {
  try {
    const { id } = req.body;

    const sql = `
      SELECT 
        id, 
        country, 
        state, 
        ip_address, 
        device_id, 
        device_type, 
        is_mobile,
        user_agent,
        page_url,
        referrer,
        DATE_FORMAT(date, '%Y-%m-%d %H:%i:%s') as date,
        DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as created_at
      FROM visitors 
      WHERE id = ?
    `;

    db.query(sql, [id], (err, results) => {
      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message,
        });
      }

      if (results.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Visitor not found",
        });
      }

      res.json({
        success: true,
        visitor: results[0],
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
exports.deleteVisitor = (req, res) => {
  try {
    const { deleteId } = req.body;

    const sql = "DELETE FROM visitors WHERE id = ?";

    db.query(sql, [deleteId], (err, result) => {
      if (err) {
        return res.status(500).json({
          success: false,
          error: err.message,
        });
      }

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Visitor not found",
        });
      }

      res.json({
        success: true,
        message: "Visitor deleted successfully",
      });
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};
