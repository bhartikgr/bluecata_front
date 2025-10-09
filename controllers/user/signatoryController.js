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
exports.signatoryinvitationLink = (req, res) => {
  const code = req.body.code;

  const query = `
    SELECT cs.*, c.company_name 
    FROM company_signatories cs
    JOIN company c ON c.id = cs.company_id
    WHERE cs.unique_code = ?
  `;

  db.query(query, [code], (err, rows) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (rows.length === 0) {
      return res.status(404).json({
        message: "Invalid invitation code",
      });
    }

    const signatory = rows[0];
    const email = signatory.signatory_email;

    // Check globally: same email कहीं और password set है या access_status active है
    const checkQuery = `
      SELECT id 
      FROM company_signatories 
      WHERE signatory_email = ? 
        AND (password IS NOT NULL OR access_status = 'active')
      LIMIT 1
    `;

    db.query(checkQuery, [email], (err2, checkRows) => {
      if (err2) {
        return res.status(500).json({
          message: "Database check error",
          error: err2,
        });
      }

      let status = "";

      if (checkRows.length > 0) {
        status = "already_active";
      } else if (!signatory.password && signatory.access_status === "pending") {
        status = "set_password";
      } else {
        status = "can_activate";
      }

      // response में existing record का access_status भी भेज दो
      return res.status(200).json({
        message: "",
        results: signatory,
        status: status,
        current_record_status: signatory.access_status, // active या pending
      });
    });
  });
};

exports.acceptInvitationSignatory = async (req, res) => {
  try {
    const code = req.body.code;
    const password = req.body.password;
    db.query(
      "SELECT * from company_signatories where viewpassword = ?",
      [password],
      async (err, row) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        if (row.length > 0) {
          return res.status(200).json({
            message: "This password is already in use.",
            status: "2",
          });
        } else {
          const hashedPassword = await bcrypt.hash(password, 12);

          // 1️⃣ Update the user's password
          var date = new Date();
          db.query(
            "UPDATE company_signatories SET viewpassword = ?, password = ?,accepted_at=?,access_status =? WHERE unique_code = ?",
            [password, hashedPassword, date, "active", code],
            (err, result) => {
              if (err) {
                return res.status(500).json({
                  message: "Database query error during password update",
                  error: err,
                });
              }

              // 2️⃣ Fetch user and company details after update
              db.query(
                `SELECT 
                u.id AS user_id, 
                u.first_name AS user_first_name,
                u.last_name AS user_last_name, 
                u.email AS user_email, 
                c.id AS company_id, 
                c.company_name AS company_name,
                cs.first_name AS signatory_first_name,
                cs.last_name AS signatory_last_name
              FROM company_signatories cs
              JOIN users u ON cs.user_id = u.id
              JOIN company c ON cs.company_id = c.id
              WHERE cs.unique_code = ?`,
                [code],
                (err, rows) => {
                  if (err) {
                    return res.status(500).json({
                      message: "Database query error during select",
                      error: err,
                    });
                  }

                  if (rows.length === 0) {
                    return res.status(404).json({
                      message: "No user found with the provided code",
                    });
                  }

                  const user = rows[0];
                  const signatoryName =
                    user.signatory_first_name + " " + user.signatory_last_name;
                  const fullName =
                    user.user_first_name + " " + user.user_last_name;

                  // 3️⃣ Send activation email
                  sendEmailToUserJoinedCompany(
                    user.user_email,
                    fullName,
                    user.company_name,
                    signatoryName
                  );

                  // 4️⃣ Send response
                  res.status(200).json({
                    message: "Successfully joined the company, Please login",
                    status: "1",
                    user: {
                      id: user.user_id,
                      email: user.user_email,
                      full_name: fullName,
                      company_name: user.company_name,
                    },
                  });
                }
              );
            }
          );
        }
      }
    );
    // Hash the password
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

function sendEmailToUserJoinedCompany(to, name, companyname, signatoryname) {
  const subject = "New Signatory Joined Your Company";

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>New Signatory Joined</title>
    </head>
    <body style="background: #f9fafb; padding: 20px; font-family: Verdana, Geneva, sans-serif;">
      <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; background: #fff;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="background: #efefef; padding: 10px 0; text-align: center;">
              <img src="https://blueprintcatalyst.com/api/upload/images/logo.png" alt="logo" style="width: 130px;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 20px; color: #111; font-size: 14px;">
              <h2>Hello ${name},</h2>
              <p>We are excited to inform you that <b>${signatoryname}</b> has joined your company <b>${companyname}</b> as a signatory.</p>
              <p>You can now collaborate with them to manage company activities and documents more efficiently.</p>
              <p>If you have any questions or need assistance, feel free to reach out to our support team.</p>
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
    if (error) {
      console.error("Error sending notification email:", error);
    } else {
      console.log("Notification email sent:", info.response);
    }
  });
}

exports.signatorylogin = async (req, res) => {
  const { email, password } = req.body;

  db.query(
    `SELECT cs.*, c.company_name
     FROM company_signatories cs 
     JOIN company c ON cs.company_id = c.id 
     WHERE cs.signatory_email = ? AND cs.access_status = 'active'`,
    [email],
    async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      if (results.length === 0) {
        return res.status(200).json({
          message: "Invalid credentials or inactive account",
          status: "2",
        });
      }

      // ✅ Find valid signatory password match
      let matchedSignatory = null;
      for (const signatory of results) {
        const match = await bcrypt.compare(password, signatory.password);
        if (match) {
          matchedSignatory = signatory;
          break;
        }
      }

      if (!matchedSignatory) {
        return res
          .status(200)
          .json({ message: "Invalid credentials", status: "2" });
      }

      // ✅ Generate JWT token (1-hour expiry)
      const token = jwt.sign(
        {
          id: matchedSignatory.id,
          email: matchedSignatory.signatory_email,
          role: "signatory",
        },
        JWT_SECRET,
        { expiresIn: "1h" }
      );

      // ✅ Fetch all active companies for this email
      db.query(
        `SELECT c.id, c.company_name
         FROM company_signatories cs
         JOIN company c ON cs.company_id = c.id
         WHERE cs.signatory_email = ? AND cs.access_status = 'active'`,
        [email],
        (err2, companyRows) => {
          if (err2) {
            return res.status(500).json({
              message: "Company fetch error",
              error: err2,
            });
          }

          const companies = companyRows.map((row) => ({
            id: row.id,
            name: row.company_name,
          }));

          // ✅ Send response
          res.status(200).json({
            message: "Login successful",
            status: "1",
            token, // 👈 Send token here
            user: {
              id: matchedSignatory.id,
              email: matchedSignatory.signatory_email,
              role: "signatory",
              companies,
            },
          });
        }
      );
    }
  );
};

exports.joinedCompany = (req, res) => {
  const { code, company_name } = req.body;

  // 1. Find the record by code
  const selectQuery = `
    SELECT * FROM company_signatories
    WHERE unique_code = ?
    LIMIT 1
  `;

  db.query(selectQuery, [code], (err, rows) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    if (rows.length === 0) {
      return res.status(404).json({ message: "Invalid invitation code" });
    }

    const signatory = rows[0];

    // Optional: check if the email already active in another row
    const email = signatory.signatory_email;
    const checkQuery = `
      SELECT * FROM company_signatories
      WHERE signatory_email = ? AND access_status = 'active'
      LIMIT 1
    `;

    db.query(checkQuery, [email], (err2, activeRows) => {
      if (err2) {
        return res
          .status(500)
          .json({ message: "Database check error", error: err2 });
      }
      var datarow = activeRows[0];
      console.log(datarow);
      // 2. Update the record
      const updateQuery = `
        UPDATE company_signatories
        SET access_status = 'active', password = ?, viewpassword = ?
        WHERE unique_code = ?
      `;

      db.query(
        updateQuery,
        [datarow.password, datarow.viewpassword, code],
        (err3, updateResult) => {
          if (err3) {
            return res
              .status(500)
              .json({ message: "Database update error", error: err3 });
          }
          db.query(
            `SELECT 
                u.id AS user_id, 
                u.first_name AS user_first_name,
                u.last_name AS user_last_name, 
                u.email AS user_email, 
                c.id AS company_id, 
                c.company_name AS company_name,
                cs.first_name AS signatory_first_name,
                cs.last_name AS signatory_last_name
              FROM company_signatories cs
              JOIN users u ON cs.user_id = u.id
              JOIN company c ON cs.company_id = c.id
              WHERE cs.unique_code = ?`,
            [code],
            (err, rows) => {
              if (err) {
                return res.status(500).json({
                  message: "Database query error during select",
                  error: err,
                });
              }

              if (rows.length === 0) {
                return res.status(404).json({
                  message: "No user found with the provided code",
                });
              }

              const user = rows[0];
              const signatoryName =
                user.signatory_first_name + " " + user.signatory_last_name;
              const fullName = user.user_first_name + " " + user.user_last_name;

              // 3️⃣ Send activation email
              sendEmailToUserJoinedCompany(
                user.user_email,
                fullName,
                user.company_name,
                signatoryName
              );

              // 4️⃣ Send response
              return res.status(200).json({
                message: "Company Joined successfully",
                results: {
                  ...signatory,
                  access_status: "active",
                },
              });
            }
          );
        }
      );
    });
  });
};
exports.signatoryAccessLastLogin = (req, res) => {
  const { ip_address, detail, companyId } = req.body;

  if (!detail || !detail.id || !detail.email) {
    return res.status(400).json({ message: "Invalid Signatory data" });
  }

  const cioRole =
    "Chief Investment Officer (CIO) – Manages engagements with investors and shareholders";
  const email = detail.email;
  const signatoryId = detail.id;

  // Step 1: Get the CIO record for this email
  const getCIOQuery = `
    SELECT cs.*
    FROM company_signatories cs
    WHERE cs.signatory_email = ? AND cs.signature_role = ? AND cs.company_id = ?
    LIMIT 1
  `;

  db.query(getCIOQuery, [email, cioRole, companyId], (err, results) => {
    if (err) return res.status(500).json({ message: "DB error", error: err });

    if (results.length === 0) {
      // Not a CIO or no record
      return recordLastLogin(email, ip_address, companyId, false, null, null);
    }

    const approvedCIO = results[0];
    console.log(approvedCIO); // ✅ optional logging
    const signt = `${approvedCIO.first_name} ${approvedCIO.last_name}`;

    // Step 2: Check if already exists for this company
    const checkExistingQuery = `
      SELECT id 
      FROM authorized_signature 
      WHERE company_signatories_id = ? AND company_id = ?
      LIMIT 1
    `;

    db.query(
      checkExistingQuery,
      [approvedCIO.id, companyId],
      (err, existingResult) => {
        if (err)
          return res.status(500).json({ message: "DB error", error: err });

        if (existingResult.length === 0) {
          // Insert only once
          const insertQuery = `
          INSERT INTO authorized_signature 
          (company_signatories_id, user_id, company_id, created_by_id, type, signature, approve, created_at)
          VALUES (?, ?, ?, ?, ?, ?, 'Yes', NOW())
          ON DUPLICATE KEY UPDATE approve = 'Yes'
        `;
          db.query(
            insertQuery,
            [
              approvedCIO.id,
              signatoryId,
              companyId,
              signatoryId,
              "manual",
              signt,
            ],
            (err, insertResult) => {
              if (err)
                return res
                  .status(500)
                  .json({ message: "Insert failed", error: err });

              // Record login
              return recordLastLogin(
                email,
                ip_address,
                companyId,
                true,
                insertResult.insertId,
                approvedCIO
              );
            }
          );
        } else {
          // Already exists, no insert
          return recordLastLogin(
            email,
            ip_address,
            companyId,
            false,
            null,
            approvedCIO
          );
        }
      }
    );
  });

  // Helper function to record last login
  function recordLastLogin(
    signatoryEmail,
    ip_address,
    companyId,
    signatureCreated,
    signatureId,
    approvedCIO
  ) {
    const query = `
      INSERT INTO access_logs_sigantory_last_login (signatory_email,company_id, ip_address, created_at)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        ip_address = VALUES(ip_address),
        created_at = NOW()
    `;

    db.query(query, [signatoryEmail, companyId, ip_address], (err, result) => {
      if (err) return res.status(500).json({ message: "DB error", error: err });

      const response = {
        message: "Last login recorded successfully",
        result,
        approvedCIO, // include approvedCIO in response
      };

      if (signatureCreated) {
        response.signatureCreated = true;
        response.signatureId = signatureId;
        response.companyId = companyId;
      }

      return res.status(200).json(response);
    });
  }
};
