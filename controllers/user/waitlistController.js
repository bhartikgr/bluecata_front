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

function sendWaitlistConfirmationEmail(to, fullName, companyName, formData) {
  const subject = `Welcome to Capavate Angel Network Waitlist`;

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Welcome to Capavate Waitlist</title>
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
              
              <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #CC0000;">
                <p style="margin: 0 0 10px 0; font-style: italic; color: #555;">
                  "Companies interested in presenting to the Capavate Angel Network are invited to complete the application form to join our waitlist. Once submitted, the Capavate team will review your information and contact you with next steps. Selected companies will be invited to a screening meeting to discuss their opportunity in more detail. The Capavate Angel Network is a global coalition of early-stage investor groups united to connect innovative founders with active angel investors worldwide."
                </p>
              </div>
              
              <p style="margin: 0 0 15px 0;">
                Thank you for your interest in presenting to the <b>Capavate Angel Network</b>.
              </p>
              
              <p style="margin: 20px 0 15px 0; font-size: 16px; color: #CC0000; border-bottom: 2px solid #CC0000; padding-bottom: 5px;">
                <b>Application Details:</b>
              </p>
              
              <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
                <tr>
                  <td style="padding: 10px; background: #f8f9fa; border: 1px solid #e5e7eb; width: 40%;"><b>Company Name:</b></td>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${formData.companyName || companyName}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; background: #f8f9fa; border: 1px solid #e5e7eb;"><b>First Name:</b></td>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${formData.firstName}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; background: #f8f9fa; border: 1px solid #e5e7eb;"><b>Last Name:</b></td>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${formData.lastName}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; background: #f8f9fa; border: 1px solid #e5e7eb;"><b>Email Address:</b></td>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${formData.email}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; background: #f8f9fa; border: 1px solid #e5e7eb;"><b>Phone Number:</b></td>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${formData.phone}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; background: #f8f9fa; border: 1px solid #e5e7eb;"><b>City:</b></td>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${formData.city}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; background: #f8f9fa; border: 1px solid #e5e7eb;"><b>Country:</b></td>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${formData.country}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; background: #f8f9fa; border: 1px solid #e5e7eb;"><b>Application Date:</b></td>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${new Date().toLocaleString()}</td>
                </tr>
              </table>
              
              <p style="margin: 20px 0 15px 0;">
                Your application has been successfully added to our waitlist. Our team will review your information and contact you with next steps within 5-7 business days.
              </p>
              
              <p style="margin: 0 0 20px 0;">
                If you have any questions or need assistance, feel free to contact our support team at <a href="mailto:support@capavate.com" style="color: #CC0000; text-decoration: none;">support@capavate.com</a>.
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
                    display: inline-block;
                  "
                >Visit Capavate</a>
              </div>
              
              <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
              
              <p style="margin: 10px 0 0 0; font-size: 12px; text-align: center; color: #777;">
                <b>Capavate Angel Network</b><br />
                A global coalition of early-stage investor groups<br />
                Connecting innovative founders with active angel investors worldwide
              </p>
              
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
    html: htmlBody,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending waitlist email:", error);
    else console.log("Waitlist confirmation email sent:", info.response);
  });
}
exports.saveJoinwaitlist = async (req, res) => {
  const {
    company_id,
    company_name,
    first_name,
    last_name,
    email,
    phone,
    city,
    country,
    created_at,
  } = req.body;

  // Validate required fields
  if (!company_id) {
    return res.status(400).json({
      status: "2",
      message: "Company ID is required",
    });
  }

  if (!email) {
    return res.status(400).json({
      status: "2",
      message: "Email is required",
    });
  }

  try {
    // Insert into waitlist table
    const query = `
      INSERT INTO waitlist 
      (company_id, company_name, first_name, last_name, email, phone, city, country, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
      company_id,
      company_name,
      first_name,
      last_name,
      email,
      phone,
      city,
      country,
      created_at || new Date(),
    ];

    db.query(query, values, (err, result) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({
          status: "2",
          message: "Database error",
          error: err.message,
        });
      }

      // Send confirmation email to user
      const fullName = `${first_name} ${last_name}`;
      const formData = {
        companyName: company_name,
        firstName: first_name,
        lastName: last_name,
        email: email,
        phone: phone,
        city: city,
        country: country,
      };
      sendWaitlistConfirmationEmail(email, fullName, company_name, formData);

      // Send notification email to admin
      const companyDetails = {
        company_id,
        company_name,
        first_name,
        last_name,
        email,
        phone,
        city,
        country,
      };

      return res.status(200).json({
        status: "1",
        message: "Successfully joined waitlist",
        insertId: result.insertId,
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

exports.getInvestorWaitList = async (req, res) => {
  const { company_id } = req.body;

  // Validate required fields
  if (!company_id) {
    return res.status(400).json({
      status: "2",
      message: "Company ID is required",
    });
  }

  try {
    // Select from waitlist table with company_id filter
    const query = `
      SELECT * FROM waitlist 
      WHERE company_id = ? 
      ORDER BY created_at DESC
    `;

    db.query(query, [company_id], (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({
          status: "2",
          message: "Database error",
          error: err.message,
        });
      }

      return res.status(200).json({
        status: "1",
        message: "Waitlist retrieved successfully",
        results: results,
        count: results.length,
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
