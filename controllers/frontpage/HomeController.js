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

exports.saveContact = async (req, res) => {
  const { name, email, phone, message } = req.body;

  // Validate required fields
  if (!name || !email || !phone || !message) {
    return res.status(400).json({
      status: "2",
      message: "All fields are required: name, email, phone, message",
    });
  }

  try {
    // Insert into contactus table
    const insertQuery = `
      INSERT INTO contactus (name, email, phone, message, created_at) 
      VALUES (?, ?, ?, ?, NOW())
    `;

    db.query(insertQuery, [name, email, phone, message], (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({
          status: "2",
          message: "Database error",
          error: err.message,
        });
      }

      // Send confirmation email to admin
      sendContactEmailToAdmin(name, email, phone, message);

      // Send auto-reply to user

      return res.status(200).json({
        status: "1",
        message: "Contact form submitted successfully",
        results: {
          id: result.insertId,
          name,
          email,
          phone,
          message,
        },
      });
    });
  } catch (err) {
    console.error("Server error:", err);
    return res.status(500).json({
      status: "2",
      message: "Server error",
      error: err.message,
    });
  }
};
function formatDate(date) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[date.getMonth()];
  const day = date.getDate();

  // Add ordinal suffix to day
  const suffix =
    day >= 11 && day <= 13
      ? "th"
      : day % 10 === 1
        ? "st"
        : day % 10 === 2
          ? "nd"
          : day % 10 === 3
            ? "rd"
            : "th";

  const year = date.getFullYear();

  return `${month} ${day}${suffix}, ${year}`;
}
// Function to send email to admin
function sendContactEmailToAdmin(name, email, phone, message) {
  var too = "info@capavate.com";
  const subject = `New Contact Form Submission from ${name}`;
  const currentDate = formatDate(new Date());
  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>New Contact Form Submission</title>
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
            <td style="background: #CC0201; padding: 20px 0; text-align: center;">
              <img src="http://localhost:5000/api/upload/images/logo.png" alt="logo" style="width: 130px;" />
            </td>
          </tr>
          <tr>
            <td style="padding: 30px; color: #111; font-size: 14px;">
              <h2 style="margin: 0 0 20px 0; font-size: 20px; color: #CC0201; border-bottom: 2px solid #CC0201; padding-bottom: 10px;">
                New Contact Form Submission
              </h2>
              
              <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #CC0201;">
                <p style="margin: 0 0 10px 0; font-weight: bold; color: #CC0201;">
                  A new message has been received from the contact form:
                </p>
              </div>
              
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <tr>
                  <td style="padding: 12px; background: #f8f9fa; border: 1px solid #e5e7eb; width: 30%; font-weight: bold;">Name:</td>
                  <td style="padding: 12px; border: 1px solid #e5e7eb;">${name}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; background: #f8f9fa; border: 1px solid #e5e7eb; font-weight: bold;">Email:</td>
                  <td style="padding: 12px; border: 1px solid #e5e7eb;">
                    <a href="mailto:${email}" style="color: #CC0201; text-decoration: none;">${email}</a>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px; background: #f8f9fa; border: 1px solid #e5e7eb; font-weight: bold;">Phone:</td>
                  <td style="padding: 12px; border: 1px solid #e5e7eb;">${phone}</td>
                </tr>
                <tr>
                  <td style="padding: 12px; background: #f8f9fa; border: 1px solid #e5e7eb; font-weight: bold;">Message:</td>
                  <td style="padding: 12px; border: 1px solid #e5e7eb;">
                    <div style="background: #fff; padding: 10px; border-radius: 5px;">
                      ${message.replace(/\n/g, "<br>")}
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 12px; background: #f8f9fa; border: 1px solid #e5e7eb; font-weight: bold;">Submitted At:</td>
                  <td style="padding: 12px; border: 1px solid #e5e7eb;">${currentDate}</td>
                </tr>
              </table>
              
              
              
              
              
              <p style="margin: 10px 0 0 0; font-size: 12px; text-align: center; color: #777;">
                <b>Capavate Angel Network</b><br />
                A global coalition of early-stage investor groups<br />
                Connecting innovative founders with active angel investors worldwide
              </p>
              
              <p style="margin: 20px 0 0 0; font-size: 12px; text-align: center; color: #999;">
                This is an automated notification. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </div>
    </body>
  </html>
  `;

  const mailOptions = {
    from: "Capavate <scale@blueprintcatalyst.com>",
    to: too, // Admin email
    subject: subject,
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.error("Error sending admin email:", error);
    } else {
      console.log("Admin email sent:", info.response);
    }
  });
}
