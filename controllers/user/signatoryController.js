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
  var code = req.body.code;
  db.query(
    "SELECT company_signatories.*,company.company_name FROM company_signatories join company on company.id = company_signatories.company_id where company_signatories.unique_code = ? And company_signatories.access_status !=?",
    [code, "active"],
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
    }
  );
};
exports.acceptInvitationSignatory = async (req, res) => {
  try {
    const code = req.body.code;
    const password = req.body.password;

    // Hash the password
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
            const fullName = user.user_first_name + " " + user.user_last_name;

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
              <img src="http://localhost:5000/api/upload/images/logo.png" alt="logo" style="width: 130px;" />
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
