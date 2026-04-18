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
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${new Date()
                    .toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })
                    .replace(/(\d+)/, (match) => {
                      const day = parseInt(match);
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
                      return day + suffix;
                    })}</td>
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
    from: "Capavate scale@blueprintcatalyst.com",
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
  if (!email) {
    return res.status(400).json({
      status: "2",
      message: "Email is required",
    });
  }

  if (!company_id) {
    return res.status(400).json({
      status: "2",
      message: "Company ID is required",
    });
  }

  try {
    // Check if already exists in waitlist for this company
    const checkQuery = `
      SELECT id FROM waitlist 
      WHERE company_id = ? AND email = ?
    `;

    db.query(checkQuery, [company_id, email], (err, existing) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({
          status: "2",
          message: "Database error",
          error: err.message,
        });
      }

      // If already exists, return message
      if (existing.length > 0) {
        return res.status(200).json({
          status: "2",
          message: `This investor (${email}) is already in the waitlist for ${company_name || "your company"}`,
          alreadyExists: true,
        });
      }

      // Insert into waitlist table
      const insertWaitlistQuery = `
        INSERT INTO waitlist 
        (code, company_id, company_name, first_name, last_name, email, phone, city, country, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const code = crypto.randomBytes(16).toString("hex");
      const waitlistValues = [
        code,
        company_id,
        company_name || null,
        first_name || null,
        last_name || null,
        email,
        phone || null,
        city || null,
        country || null,
        created_at || new Date(),
      ];

      db.query(insertWaitlistQuery, waitlistValues, (err, waitlistResult) => {
        if (err) {
          console.error("Database error:", err);
          return res.status(500).json({
            status: "2",
            message: "Database error",
            error: err.message,
          });
        }

        // Insert into company_add_investors table (silent - no duplicate message)
        const checkInvestorQuery = `
          SELECT id FROM company_add_investors 
          WHERE company_id = ? AND email = ?
        `;

        db.query(
          checkInvestorQuery,
          [company_id, email],
          (err, investorExisting) => {
            if (err) {
              console.error("Error checking company_add_investors:", err);
              // Continue with response even if this fails
            }

            // Only insert if not exists (silent - no message returned)
            if (!investorExisting || investorExisting.length === 0) {
              const insertInvestorQuery = `
              INSERT INTO company_add_investors 
              (company_id, email, first_name, last_name, created_at) 
              VALUES (?, ?, ?, ?, ?)
            `;
              const investorValues = [
                company_id,
                email,
                first_name || null,
                last_name || null,
                created_at || new Date(),
              ];

              db.query(
                insertInvestorQuery,
                investorValues,
                (err, investorResult) => {
                  if (err) {
                    console.error(
                      "Error inserting into company_add_investors:",
                      err,
                    );
                    // Don't return error response, just log it
                  }
                  // Continue to send email and response
                },
              );
            }
          },
        );

        // Send confirmation email to user
        const fullName = `${first_name || ""} ${last_name || ""}`.trim();
        const formData = {
          companyName: company_name,
          firstName: first_name,
          lastName: last_name,
          email: email,
          phone: phone,
          city: city,
          country: country,
        };

        // Send emails (make sure these functions exist)
        if (typeof sendWaitlistConfirmationEmail === "function") {
          sendWaitlistConfirmationEmail(
            email,
            fullName,
            company_name,
            formData,
          );
        }

        return res.status(200).json({
          status: "1",
          message: "Successfully joined waitlist",
          insertId: waitlistResult.insertId,
        });
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
exports.saveAcademypopup = async (req, res) => {
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

  if (!email) {
    return res.status(400).json({
      status: "2",
      message: "Email is required",
    });
  }

  try {
    // Check if already exists in waitlist for this company
    const checkQuery = `
      SELECT id FROM waitlist 
      WHERE company_name = ? AND email = ?
    `;

    db.query(checkQuery, [company_name, email], (err, existing) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({
          status: "2",
          message: "Database error",
          error: err.message,
        });
      }

      // If already exists, return message
      if (existing.length > 0) {
        return res.status(200).json({
          status: "2",
          message: `This investor (${email}) has already been invited to join ${company_name || "your company"}`,
          alreadyExists: true,
        });
      }

      // If not exists, insert into waitlist table
      const insertQuery = `
        INSERT INTO waitlist 
        (code, company_id, company_name, first_name, last_name, email, phone, city, country, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const code = crypto.randomBytes(16).toString("hex");
      const values = [
        code,
        company_id,
        company_name || null,
        first_name || null,
        last_name || null,
        email,
        phone || null,
        city || null,
        country || null,
        created_at || new Date(),
      ];

      db.query(insertQuery, values, (err, result) => {
        if (err) {
          console.error("Database error:", err);
          return res.status(500).json({
            status: "2",
            message: "Database error",
            error: err.message,
          });
        }

        // Send confirmation email to user
        const fullName = `${first_name || ""} ${last_name || ""}`.trim();
        const formData = {
          companyName: company_name,
          firstName: first_name,
          lastName: last_name,
          email: email,
          phone: phone,
          city: city,
          country: country,
        };

        // Send emails (make sure these functions exist)
        if (typeof sendWaitlistConfirmationEmail === "function") {
          sendWaitlistConfirmationEmail(
            email,
            fullName,
            company_name,
            formData,
          );
        }

        return res.status(200).json({
          status: "1",
          message: "Successfully joined waitlist",
          insertId: result.insertId,
        });
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
exports.interestInvestor = async (req, res) => {
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
      SELECT 
      ci.*,
      ii.first_name,
      ii.last_name,
      ii.email,
      ii.phone,
      ii.city,
      ii.country,
      ii.type_of_investor
    FROM company_investor ci
    INNER JOIN investor_information ii ON ii.id = ci.investor_id
    WHERE ci.company_id = ? 
      AND ci.joinstatus = 'Yes'
    ORDER BY ci.id DESC
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
        message: "",
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

exports.joinAngelNetwork = async (req, res) => {
  const {
    investor_id,
    firstName,
    lastName,
    email,
    phone,
    city,
    country,
    portfolio_companies,
  } = req.body;

  try {
    // ── STEP 1: CHECK IF EMAIL ALREADY EXISTS ──
    const checkQuery = `SELECT id, email, code FROM waitlist WHERE email = ? LIMIT 1`;

    db.query(checkQuery, [email], (checkErr, checkResult) => {
      if (checkErr) {
        return res.status(500).json({
          status: "2",
          message: checkErr.message,
        });
      }

      // ── EMAIL ALREADY EXISTS ──
      if (checkResult.length > 0) {
        return res.status(200).json({
          status: "0",
          message:
            "This email is already registered in the Angel Network waitlist.",
          code: checkResult[0].code, // ✅ return existing code
        });
      }

      // ── STEP 2: GENERATE UNIQUE CODE ──
      const uniqueCode = crypto.randomBytes(16).toString("hex");
      // Example output: "6b9b0eb3f23afc0fe30f2285e568a09f"

      // ── STEP 3: INSERT WITH CODE ──
      const insertQuery = `
        INSERT INTO waitlist 
        (first_name, last_name, email, phone, city, country, code, created_at) 
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
      `;

      db.query(
        insertQuery,
        [firstName, lastName, email, phone, city, country, uniqueCode],
        (err, result) => {
          if (err) {
            return res.status(500).json({
              status: "2",
              message: err.message,
            });
          }

          // ── SEND EMAIL TO INVESTOR ──
          const emailContent = `
            <h2>Welcome to Capavate Angel Network!</h2>
            <p>Dear ${firstName} ${lastName},</p>
            <p>You have successfully joined the Capavate Angel Network waitlist.</p>
            <p><strong>Your Unique Member Code:</strong> ${uniqueCode}</p>
            
            <h3>Your Portfolio Companies:</h3>
            <ul>
              ${portfolio_companies
                .map(
                  (company) =>
                    `<li>${company.name} - <a href="${company.profile_link}">View Profile</a></li>`,
                )
                .join("")}
            </ul>
            
            <p>These companies will be notified about your interest.</p>
            <p>View your <a href="https://capavate.com/investor/profile/${investor_id}">Investor Profile</a></p>
          `;

          // sendEmail(email, "Welcome to Capavate Angel Network", emailContent);

          // ── SEND NOTIFICATION TO EACH PORTFOLIO COMPANY ──
          portfolio_companies.forEach((company) => {
            const companyEmail = `
              <h3>Investor Joined Angel Network</h3>
              <p>Investor ${firstName} ${lastName} from your cap table has joined the Capavate Angel Network.</p>
              <p>Member Code: <strong>${uniqueCode}</strong></p>
              <p>View their profile: <a href="https://capavate.com/investor/profile/${investor_id}">Investor Profile</a></p>
            `;
            // sendEmail(company.email, "Investor Joined Angel Network", companyEmail);
          });

          return res.json({
            status: "1",
            message: "Successfully joined Angel Network",
            code: uniqueCode, // ✅ return generated code to frontend
          });
        },
      );
    });
  } catch (err) {
    return res.status(500).json({
      status: "2",
      message: err.message,
    });
  }
};
