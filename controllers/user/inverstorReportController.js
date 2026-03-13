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
const mammoth = require("mammoth");
const PizZip = require("pizzip");
const Docxtemplater = require("docxtemplater");
const mysql = require("mysql2/promise"); // 👈 only used in this API
const cron = require("node-cron");
const ExcelJS = require("exceljs");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const Stripe = require("stripe");
const stripe = new Stripe(
  "sk_test_51RUJzWAx6rm2q3pyUl86ZMypACukdO7IsZ0AbsWOcJqg9xWGccwcQwbQvfCaxQniDCWzNg7z2p4rZS1u4mmDDyou00DM7rK8eY",
);
const upload = require("../../middlewares/uploadMiddleware");

require("dotenv").config();
const JWT_SECRET = process.env.JWT_SECRET;
//All Investor Quatarly Email Send
exports.investorQuatarlyEmailSend = (req, res) => {
  // Get today's date minus 3 months
  const threeMonthsAgo = moment().subtract(3, "months").format("YYYY-MM-DD");

  // Fetch investors who have not updated in the last 3 months
  const query = `SELECT c.id, c.email, iu.last_update FROM company c LEFT JOIN ( SELECT user_id, MAX(created_at) AS last_update FROM investor_updates GROUP BY user_id ) iu ON c.id = iu.user_id WHERE iu.last_update IS NULL OR iu.last_update <= ?`;

  db.query(query, [threeMonthsAgo], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }
    results.forEach((investor) => {
      // Send email to each investor
      sendEmailForInvestorReminder(
        investor.email,
        "Reminder: Submit Your Quarterly Investor Update",
      );
    });

    res.status(200).json({
      message: "Quarterly reminder emails sent",
      count: results.length,
    });
  });
};

// Every day at 9 AM, check for quarterly reminders
// cron.schedule("0 9 * * *", () => {
//   investorQuatarlyEmailSend(); // call the function
// });

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
function sendEmailForInvestorReminder(to, subject) {
  const body = `
Dear Founder,

This is a friendly reminder to submit your **Quarterly Investor Update**.

Regular updates help maintain trust and ensure investors are aligned with your company’s current progress, challenges, and strategic direction.

Please include:
- Your current revenue and key business KPIs
- Notable product improvements or team changes
- Any major wins, learnings, or setbacks this quarter
- A brief summary of what’s coming next or where support is needed

Consistent updates (every 3 months) help everyone stay in sync and are part of our shared commitment to transparency.

If you’ve already submitted your update, you can disregard this message.

Best regards,  
Investor Relations Team  
`;

  const mailOptions = {
    from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
    to,
    subject,
    text: body,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Email sent:", info.response);
  });
}

//All Investor Quatarly Email Send

exports.getInvestorReport = (req, res) => {
  const { user_id } = req.body;

  const query = `
    SELECT iu.*
FROM investor_updates iu
WHERE iu.user_id = ?
  AND iu.is_locked = ?
  AND iu.id NOT IN (
    SELECT investor_updates_id FROM sharereport
  )
ORDER BY iu.id DESC;

  `;

  db.query(query, [user_id, 1], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    const pathname = `upload/docs/doc_${user_id}`;

    const updatedResults = results.map((doc) => {
      // Conditional downloadUrl based on type
      let downloadUrl = null;

      if (doc.document_name) {
        downloadUrl = `https://capavate.com/api/${pathname}/investor_report/${doc.document_name}`;
      }

      return {
        ...doc,
        downloadUrl,
      };
    });

    res.status(200).json({
      message: "Investor report data fetched",
      results: updatedResults,
    });
  });
};
exports.SendreportToinvestor = async (req, res) => {
  const { company_id, emails, records } = req.body;
  if (
    !company_id ||
    !emails ||
    !Array.isArray(emails) ||
    !Array.isArray(records)
  ) {
    return res.status(400).json({ message: "Missing required fields" });
  }

  try {
    const currentDate = new Date();
    const expiredAt = new Date();
    expiredAt.setDate(currentDate.getDate() + 30);

    // 🔍 Get entrepreneur name
    const [userRows] = await db
      .promise()
      .query("SELECT * FROM company WHERE id = ? LIMIT 1", [company_id]);
    const entrepreneurName =
      userRows[0]?.first_name + " " + userRows[0]?.last_name;

    const duplicateReports = [];

    for (const report of records) {
      for (const email of emails) {
        const checkSql = `SELECT 1 FROM sharereport WHERE investor_updates_id = ? AND investor_email = ? LIMIT 1`;
        const [existing] = await db
          .promise()
          .query(checkSql, [report.id, email]);

        if (existing.length > 0) {
          duplicateReports.push({ email, document_name: report.document_name });
        }
      }
    }

    if (duplicateReports.length > 0) {
      const messageText = duplicateReports
        .map(
          (item) =>
            `Report "${item.document_name}" has already been sent to ${item.email}`,
        )
        .join("\n");

      return res.status(200).json({
        message: messageText,
        status: "2",
      });
    }

    // ✅ No duplicates, insert and send email
    for (const report of records) {
      for (const email of emails) {
        const token = crypto.randomBytes(16).toString("hex");

        await db.promise().query(
          `INSERT INTO sharereport 
            (company_id, investor_updates_id, unique_code, investor_email, sent_date, expired_at, report_type)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            company_id,
            report.id,
            token,
            email,
            currentDate,
            expiredAt,
            report.type,
          ],
        );

        // 📧 Send Email
        const query = `SELECT * FROM investor_information WHERE email = ?`;

        db.query(query, [email], async (err, results) => {
          if (err) {
            return res.status(500).json({
              message: "Database query error",
              error: err,
            });
          }

          const url =
            results.length > 0
              ? `https://capavate.com/investor/login`
              : `https://capavate.com/investor/information/${token}`;

          const mailOptions = {
            from: '"BluePrint Catalyst" <scale@blueprintcatalyst.com>',
            to: email,
            subject: `New Report from ${entrepreneurName}`,
            html: `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="UTF-8" />
              <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
              <title>New Report Shared</title>
            </head>
            <body>
              <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse; font-family: Verdana, Geneva, sans-serif;">
                  <tr>
                    <td style="background: #efefef; padding: 10px 0; text-align: center;">
                      <div style="width: 130px; margin: 0 auto;">
                        <img src="https://capavate.com/api/upload/images/logo.png" alt="Blueprint Catalyst" style="width: 100%;" />
                      </div>
                    </td>
                  </tr>
                  <tr>
                    <td>
                      <table style="width: 100%;">
                        <tr>
                          <td style="padding: 20px;">
                            <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #111;">Dear Investor,</h2>
                            <p style="margin: 0 0 15px 0; font-size: 14px; color: #111;">
                              <strong>${entrepreneurName}</strong> has shared a new report with you:
                              <br/><strong>${report.document_name}</strong>
                            </p>
                            <p style="margin: 0 0 15px 0; font-size: 14px; color: #111;">
                              You can view the report by clicking the button below:
                            </p>
                            <div style="text-align: center; margin-bottom: 20px;">
                              <a href="${url}" style="background: #CC0000; color: #ffffff; text-decoration: none; font-size: 14px; padding: 10px 30px; border-radius: 5px; font-weight: bold;">
                                View Report
                              </a>
                            </div>
                            <p style="margin: 0 0 15px 0; font-size: 14px; color: #111;">
                              Thank you,<br/>Startup Portal Team
                            </p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 20px; font-size: 12px; color: #666; text-align: center;">
                            Capavate.com – Powered by Blueprint Catalyst Limited
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </div>
            </body>
          </html>
          `,
          };

          try {
            await transporter.sendMail(mailOptions);
            console.log("Email sent successfully");
            return res.status(200).json({ message: "Email sent successfully" });
          } catch (error) {
            console.error("Error sending email:", error);
            return res
              .status(500)
              .json({ message: "Email send failed", error });
          }
        });
      }
    }

    return res.status(200).json({
      message: "Reports shared and emails sent successfully",
      status: "1",
    });
  } catch (error) {
    console.error("Error sending reports:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getInvestorReportprevious = (req, res) => {
  const { user_id } = req.body;

  const query = `
    SELECT iu.*
FROM investor_updates iu
WHERE iu.user_id = ?
  AND iu.is_locked = ?
  AND iu.id IN (
    SELECT investor_updates_id FROM sharereport
  )
ORDER BY iu.id DESC;

  `;

  db.query(query, [user_id, 1], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    const pathname = `upload/docs/doc_${user_id}`;

    const updatedResults = results.map((doc) => {
      // Conditional downloadUrl based on type
      let downloadUrl = null;

      if (doc.document_name) {
        downloadUrl = `https://capavate.com/api/${pathname}/investor_report/${doc.document_name}`;
      }

      return {
        ...doc,
        downloadUrl,
      };
    });

    res.status(200).json({
      message: "Investor report data fetched",
      results: updatedResults,
    });
  });
};
exports.checkinvestorCode = (req, res) => {
  const { code } = req.body.code;
  const query = `
    SELECT * from investor_information where unique_code =? And expired_at >= CURRENT_DATE`;

  db.query(query, [code], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "Investor report data fetched",
      results: results,
    });
  });
};
async function getPublicIP() {
  try {
    const res = await axios.get("https://api64.ipify.org?format=json");

    return res.data.ip;
  } catch (error) {
    return "";
  }
}
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

const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    // For new registrations, use email as folder name temporarily if ID not available
    const folderName = req.body.id || req.body.email || "temp";
    const sanitizedFolder = folderName.replace(/[^a-zA-Z0-9]/g, "_");

    const userFolder = path.join(
      __dirname,
      "..",
      "..",
      "upload",
      "investor",
      `inv_${sanitizedFolder}`,
    );

    if (!fs.existsSync(userFolder)) {
      fs.mkdirSync(userFolder, { recursive: true });
    }

    cb(null, userFolder);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);

    // Add prefix to identify file type
    let prefix = "file";
    if (
      file.fieldname === "profile_picture" ||
      file.fieldname === "profile_picture[]"
    ) {
      prefix = "profile";
    } else if (
      file.fieldname === "kyc_document" ||
      file.fieldname === "kyc_document[]"
    ) {
      prefix = "kyc";
    }

    cb(null, prefix + "_" + uniqueSuffix + path.extname(file.originalname));
  },
});

// Updated middleware to handle multiple field types
const uploadInvestorFiles = multer({ storage: storage }).fields([
  { name: "kyc_document[]", maxCount: 10 }, // Multiple KYC documents
  { name: "profile_picture", maxCount: 1 }, // Single profile picture
]);

// ============================================
// INVESTOR INFORMATION CONTROLLER
// ============================================

exports.investorInformation = async (req, res) => {
  uploadInvestorFiles(req, res, async function (err) {
    if (err) {
      console.error("File upload error:", err);
      return res.status(500).json({
        message: "File upload error",
        error: err.message,
        status: "2",
      });
    }

    try {
      console.log("Received files:", req.files);
      console.log("Received body:", req.body);

      const data = req.body;

      let code;
      try {
        code =
          typeof data.code === "string" ? JSON.parse(data.code) : data.code;
        code = code.code || code;
      } catch (e) {
        code = data.code;
      }

      if (!code || !data.email) {
        return res.status(400).json({
          message: "Code and email are required",
          status: "2",
        });
      }

      const checkQuery = `SELECT * FROM investor_information WHERE email = ? AND unique_code = ?;`;
      const [existingInvestors] = await db
        .promise()
        .query(checkQuery, [data.email, code]);

      if (existingInvestors.length === 0) {
        return res.status(200).json({
          message: "Investor email not matched with the provided code",
          status: "2",
        });
      }

      const detailsQuery = `
        SELECT investor_information.*, company.company_name 
        FROM investor_information 
        LEFT JOIN company ON company.id = investor_information.company_id 
        WHERE investor_information.unique_code = ? AND investor_information.email = ?
      `;
      const [investorDetails] = await db
        .promise()
        .query(detailsQuery, [code, data.email]);

      const password = generateStrongPassword(8);
      const hashedPassword = await bcrypt.hash(password, 12);
      const ip = await getPublicIP();

      // ============================================
      // HANDLE PROFILE PICTURE - Only if new file uploaded
      // ============================================
      let profilePictureFilename = investorDetails[0]?.profile_picture || null;

      if (
        req.files &&
        req.files["profile_picture"] &&
        req.files["profile_picture"].length > 0
      ) {
        const profilePicFile = req.files["profile_picture"][0];
        profilePictureFilename = profilePicFile.filename;
        console.log(
          "New profile picture uploaded (replaced):",
          profilePictureFilename,
        );
      } else {
        console.log(
          "Keeping existing profile picture:",
          profilePictureFilename,
        );
      }

      // ============================================
      // HANDLE KYC DOCUMENTS - Only new files, no merging
      // ============================================
      let kycFilesJSON = investorDetails[0]?.kyc_document || null;

      if (
        req.files &&
        req.files["kyc_document[]"] &&
        req.files["kyc_document[]"].length > 0
      ) {
        // Only use new files, discard old ones completely
        const newKycFiles = req.files["kyc_document[]"].map((f) => f.filename);
        kycFilesJSON = JSON.stringify(newKycFiles);
        console.log("New KYC documents uploaded (replaced old):", newKycFiles);
      } else {
        console.log("Keeping existing KYC documents:", kycFilesJSON);
      }

      const investorData = investorDetails[0] || {};

      if (investorDetails.length > 0) {
        // UPDATE existing record
        const updateQuery = `
          UPDATE investor_information
          SET 
          capavate_interests=?,
            is_register = ?,
            viewpassword = ?,
            password = ?,
            first_name = ?,
            last_name = ?,
            phone = ?,
            country = ?,
            city = ?,
            ip_address = ?,
            linkedIn_profile = ?,
            type_of_investor = ?,
            accredited_status = ?,
            bio_short = ?,
            mailing_address = ?,
            country_tax = ?,
            tax_id = ?,
            screen_name = ?,
            job_title = ?,
            company_name = ?,
            company_country = ?,
            company_website = ?,
            industry_expertise = ?,
            geo_focus = ?,
            network_bio = ?,
            notes = ?,
            hands_on = ?,
            ma_interests = ?,
            preferred_stages = ?,
            cheque_size = ?,
            profile_picture = ?,
            kyc_document = ?,
            full_address = ?,
            updated_at = NOW()
          WHERE unique_code = ? AND email = ?;
        `;

        const updateData = [
          data.capavate_interests || null,
          "Yes",
          password,
          hashedPassword,
          data.first_name || null,
          data.last_name || null,
          data.phone || null,
          data.country || null,
          data.city || null,
          ip,
          data.linkedIn_profile || null,
          data.type_of_investor || null,
          data.accredited_status || null,
          data.bio_short || null,
          data.mailing_address || null,
          data.country_tax || null,
          data.tax_id || null,
          data.screen_name || null,
          data.job_title || null,
          data.company_name || null,
          data.company_country || null,
          data.company_website || null,
          data.industry_expertise || null,
          data.geo_focus || null,
          data.network_bio || null,
          data.notes || null,
          data.hands_on || null,
          data.ma_interests || null,
          data.preferred_stages || null,
          data.cheque_size || null,
          profilePictureFilename, // Either existing OR new (not merged)
          kycFilesJSON, // Either existing OR new (not merged)
          data.full_address || null,
          code,
          data.email,
        ];

        await db.promise().query(updateQuery, updateData);

        await insertInvestorLog({
          investorId: investorData.id,
          userId: investorData.created_by_id,
          companyId: investorData.company_id,
          companyName: investorData.company_name,
          action: "REGISTER",
          description: `Investor ${data.first_name || ""} ${data.last_name || ""} registered successfully.`,
          ip,
          extraData: {
            email: data.email,
            hasKyc:
              req.files && req.files["kyc_document[]"]
                ? req.files["kyc_document[]"].length > 0
                : false,
            hasProfilePic:
              req.files && req.files["profile_picture"]
                ? req.files["profile_picture"].length > 0
                : false,
          },
        });

        const fullName = (data.first_name || "") + " " + (data.last_name || "");
        await sendEmailInvestorpassword(
          data.email,
          fullName.trim() || "Investor",
          password,
          investorData.company_name || "Capavate",
        );

        return res.status(200).json({
          message:
            "✅ Registration complete! Check your email for your password.",
          status: "1",
          data: {
            email: data.email,
            name: fullName.trim(),
          },
        });
      } else {
        // INSERT new record
        const insertQuery = `
          INSERT INTO investor_information
          (
          capavate_interests,
            password,
            viewpassword,
            user_id,
            unique_code,
            first_name,
            last_name,
            email,
            phone,
            country,
            city,
            linkedIn_profile,
            type_of_investor,
            accredited_status,
            bio_short,
            mailing_address,
            country_tax,
            tax_id,
            screen_name,
            job_title,
            company_name,
            company_country,
            company_website,
            industry_expertise,
            geo_focus,
            network_bio,
            notes,
            hands_on,
            ma_interests,
            preferred_stages,
            cheque_size,
            profile_picture,
            kyc_document,
            full_address,
            ip_address,
            is_register,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `;

        const insertData = [
          data.capavate_interests || null,
          hashedPassword,
          password,
          existingInvestors[0].user_id,
          code,
          data.first_name || null,
          data.last_name || null,
          data.email,
          data.phone || null,
          data.country || null,
          data.city || null,
          data.linkedIn_profile || null,
          data.type_of_investor || null,
          data.accredited_status || null,
          data.bio_short || null,
          data.mailing_address || null,
          data.country_tax || null,
          data.tax_id || null,
          data.screen_name || null,
          data.job_title || null,
          data.company_name || null,
          data.company_country || null,
          data.company_website || null,
          data.industry_expertise || null,
          data.geo_focus || null,
          data.network_bio || null,
          data.notes || null,
          data.hands_on || null,
          data.ma_interests || null,
          data.preferred_stages || null,
          data.cheque_size || null,
          profilePictureFilename,
          kycFilesJSON,
          data.full_address || null,
          ip,
          "Yes",
        ];

        const [insertResult] = await db
          .promise()
          .query(insertQuery, insertData);

        const fullName = (data.first_name || "") + " " + (data.last_name || "");
        await sendEmailInvestorpassword(
          data.email,
          fullName.trim() || "Investor",
          password,
          existingInvestors[0].company_name || "Capavate",
        );

        return res.status(200).json({
          message:
            "✅ Registration complete! Check your email for your password.",
          status: "1",
          data: {
            id: insertResult.insertId,
            email: data.email,
            name: fullName.trim(),
          },
        });
      }
    } catch (error) {
      console.error("Database error:", error);
      return res.status(500).json({
        message: "Internal server error occurred",
        error: error.message,
        status: "2",
      });
    }
  });
};
exports.investorprofile = async (req, res) => {
  uploadInvestorFiles(req, res, async function (err) {
    if (err) {
      console.error("File upload error:", err);
      return res.status(500).json({
        message: "File upload error",
        error: err.message,
        status: "2",
      });
    }

    try {
      console.log("Received files:", req.files);

      const data = req.body;

      // Check if investor exists
      const checkQuery = `SELECT * FROM investor_information WHERE email = ? AND id = ?;`;
      const [existingInvestors] = await db
        .promise()
        .query(checkQuery, [data.email, data.id]);

      if (existingInvestors.length === 0) {
        return res.status(200).json({
          message: "Investor not found",
          status: "2",
        });
      }

      // Get current investor data for existing file references
      const [currentData] = await db
        .promise()
        .query(`SELECT * FROM investor_information WHERE id = ?`, [data.id]);

      const currentInvestor = currentData[0] || {};

      // Handle profile picture - ONLY update if new file is uploaded, otherwise keep existing
      let profilePictureFilename = currentInvestor.profile_picture;
      if (
        req.files &&
        req.files["profile_picture"] &&
        req.files["profile_picture"].length > 0
      ) {
        const profilePicFile = req.files["profile_picture"][0];
        profilePictureFilename = profilePicFile.filename; // Replace with new file only
        console.log(
          "New profile picture uploaded (replaced):",
          profilePictureFilename,
        );
      }

      // Handle KYC documents - ONLY use new files if uploaded, otherwise keep existing
      let kycFilesJSON = currentInvestor.kyc_document;

      if (
        req.files &&
        req.files["kyc_document[]"] &&
        req.files["kyc_document[]"].length > 0
      ) {
        // Only use new files, discard old ones
        const newKycFiles = req.files["kyc_document[]"].map((f) => f.filename);
        kycFilesJSON = JSON.stringify(newKycFiles);
        console.log("New KYC documents uploaded (replaced old):", newKycFiles);
      }

      // Get IP address
      const ip = await getPublicIP();

      // UPDATE query
      const updateQuery = `
        UPDATE investor_information
        SET 
          capavate_interests  =?,
          first_name = ?,
          last_name = ?,
          phone = ?,
          country = ?,
          city = ?,
          ip_address = ?,
          linkedIn_profile = ?,
          type_of_investor = ?,
          accredited_status = ?,
          bio_short = ?,
          mailing_address = ?,
          country_tax = ?,
          tax_id = ?,
          screen_name = ?,
          job_title = ?,
          company_name = ?,
          company_country = ?,
          company_website = ?,
          industry_expertise = ?,
          geo_focus = ?,
          network_bio = ?,
          notes = ?,
          hands_on = ?,
          ma_interests = ?,
          preferred_stages = ?,
          cheque_size = ?,
          profile_picture = ?,
          kyc_document = ?,
          full_address = ?,
          updated_at = NOW()
        WHERE id = ? AND email = ?;
      `;

      const updateData = [
        data.capavate_interests || null,
        data.first_name || null,
        data.last_name || null,
        data.phone || null,
        data.country || null,
        data.city || null,
        ip,
        data.linkedIn_profile || null,
        data.type_of_investor || null,
        data.accredited_status || null,
        data.bio_short || null,
        data.mailing_address || null,
        data.country_tax || null,
        data.tax_id || null,
        data.screen_name || null,
        data.job_title || null,
        data.company_name || null,
        data.company_country || null,
        data.company_website || null,
        data.industry_expertise || null,
        data.geo_focus || null,
        data.network_bio || null,
        data.notes || null,
        data.hands_on || null,
        data.ma_interests || null,
        data.preferred_stages || null,
        data.cheque_size || null,
        profilePictureFilename, // Either existing OR new (not merged)
        kycFilesJSON, // Either existing OR new (not merged)
        data.full_address || null,
        data.id,
        data.email,
      ];

      await db.promise().query(updateQuery, updateData);

      return res.status(200).json({
        message: "✅ Profile updated successfully!",
        status: "1",
        data: {
          id: data.id,
          email: data.email,
          name: (data.first_name || "") + " " + (data.last_name || ""),
        },
      });
    } catch (error) {
      console.error("Database error:", error);
      return res.status(500).json({
        message: "Internal server error occurred",
        error: error.message,
        status: "2",
      });
    }
  });
};
function insertInvestorLog({
  investorId,
  userId,
  companyId,
  companyName,
  action,
  description,
  ip,
  extraData,
}) {
  const sql = `
    INSERT INTO access_logs_investor 
    (investor_id, user_id, company_id, company_name, action, description, ip_address, extra_data) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [
      investorId,
      userId || null,
      companyId || null,
      companyName || null,
      action,
      description,
      ip,
      JSON.stringify(extraData || {}),
    ],
    (err) => {
      if (err) console.error("Investor Log Insert Failed:", err);
      else console.log("Investor Log Added ✅");
    },
  );
}

function sendEmailInvestorpassword(to, fullName, newPassword, companyname) {
  const subject = `Your Capavate Account Has Been Created`;

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Account Created</title>
    </head>
    <body>
      <div style="width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden;">
        <table style="width: 100%; border-collapse: collapse; font-family: Verdana, Geneva, sans-serif;">
          <tr>
            <td style="background: #efefef; padding: 10px 0; text-align: center;">
              <div style="width: 130px; margin: 0 auto;">
                <img src="https://capavate.com/api/upload/images/logo.png" alt="Capavate" style="width: 100%;" />
              </div>
            </td>
          </tr>
          <tr>
            <td>
              <table style="width: 100%;">
                <tr>
                  <td style="padding: 20px;">
                    <h2 style="margin: 0 0 15px 0; font-size: 16px; color: #111;">Dear ${fullName},</h2>
                    <p style="margin: 0 0 15px 0; font-size: 14px; color: #111;">
                      Your investor account on Capavate is now active, created using an invitation from <strong>${companyname}</strong>.
                    </p>
                    <p style="margin: 0 0 15px 0; font-size: 14px; color: #111;">
                      Below are your login credentials:
                    </p>
                    <p style="margin: 0 0 5px 0; font-size: 14px; color: #111;"><b>Email:</b> ${to}</p>
                    <p style="margin: 0 0 15px 0; font-size: 14px; color: #111;"><b>Password:</b> ${newPassword}</p>
                    <p style="margin: 0 0 15px 0; font-size: 14px; color: #111;">
                      Please log in to Capavate.com to view/download documents. For your security, change your password immediately after logging in.
                    </p>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div style="padding: 0 20px 20px 20px; text-align: center;">
                      <a href="https://capavate.com/investor/login" style="background: #CC0000; color: #fff; text-decoration: none; font-size: 14px; padding: 10px 30px; border-radius: 10px;">Login to Your Account</a>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 20px; font-size: 12px; color: #666; text-align: center;">
                    Capavate.com – Powered by Blueprint Catalyst Limited
                  </td>
                </tr>
              </table>
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
    text: `Dear ${fullName}, Your Capavate account has been created. Email: ${to}, Password: ${newPassword}`,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) console.error("Error sending email:", error);
    else console.log("Account credentials email sent:", info.response);
  });
}

exports.investorInformationUpdate = async (req, res) => {
  const data = req.body;
  const { code } = req.body.code;

  if (!code) {
    return res.status(400).json({
      message: "Code and email are required",
      status: "2",
    });
  }

  try {
    const query2 = `SELECT * FROM investor_information WHERE unique_code = ? AND email = ?`;
    const [resultss] = await db.promise().query(query2, [code, data.email]);
    // ✅ Get dynamic IP
    if (resultss.length > 0) {
      const ip = await getPublicIP();

      const updateQuery = `
    UPDATE investor_information
    SET first_name = ?, last_name = ?, phone = ?, country = ?, city = ?, ip_address = ?, updated_at = ?
    WHERE unique_code = ? AND email = ?
  `;

      const updateData = [
        data.first_name,
        data.last_name,
        data.phone,
        data.country,
        data.city,
        ip,
        new Date(),
        code,
        data.email,
      ];

      await db.promise().query(updateQuery, updateData);

      return res.status(200).json({
        message: "Investor information updated successfully",
        status: "1",
      });
    } else {
      const ip = await getPublicIP();

      const insertQuery = `
      INSERT INTO investor_information 
      (unique_code, first_name, last_name, email, phone, country, city, ip_address, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

      const formdata = [
        code,
        data.first_name,
        data.last_name,
        data.email,
        data.phone,
        data.country,
        data.city,
        ip,
        new Date(),
      ];

      const [insertResult] = await db.promise().query(insertQuery, formdata);

      return res.status(200).json({
        message: "Investor information inserted successfully",
        data: insertResult,
        status: "1",
      });
    }
  } catch (error) {
    console.error("Database error:", error);
    return res.status(500).json({
      message: "Internal server error",
      error,
    });
  }
};

exports.getreportForInvestor = (req, res) => {
  const { email } = req.body;
  const query = `
    SELECT sharereport.*, company.first_name, company.last_name, company.company_name, 
           investor_updates.document_name, investor_updates.created_at AS date_report
    FROM sharereport
    JOIN company ON company.id = sharereport.user_id
    LEFT JOIN investor_updates ON investor_updates.id = sharereport.investor_updates_id
    WHERE sharereport.investor_email = ? 
      AND sharereport.expired_at >= CURRENT_DATE
  `;

  db.query(query, [email], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    if (results.length > 0) {
      const filteredResults = results.filter(
        (doc) => doc.document_name && doc.document_name.trim() !== "",
      );

      const updatedResults = filteredResults.map((doc) => ({
        ...doc,
        downloadUrl: `https://capavate.com/api/upload/docs/doc_${doc.user_id}/investor_report/${doc.document_name}`,
      }));

      return res.status(200).json({
        message: "Investor report data fetched",
        results: updatedResults,
      });
    }

    res.status(200).json({
      message: "No investor reports found",
      results: [],
    });
  });
};

exports.viewReport = async (req, res) => {
  const { id } = req.body;

  try {
    const ip = await getPublicIP(); // Ensure this is a promise that returns IP
    console.log(ip);
    const query = `SELECT * FROM sharereport WHERE id = ?`;
    db.query(query, [id], (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      if (results.length === 0) {
        return res.status(404).json({ message: "Report not found" });
      }

      const report = results[0];
      const shouldUpdate = !report.date_view || report.date_view === "null";

      if (shouldUpdate) {
        const dateNow = new Date();

        db.query(
          "UPDATE sharereport SET date_view = ?, investor_ip = ? WHERE id = ?",
          [dateNow, ip, id],
          (updateErr) => {
            if (updateErr) {
              return res.status(500).json({
                message: "Failed to update view data",
                error: updateErr,
              });
            }

            return res.status(200).json({
              message: "Investor report data fetched and updated",
            });
          },
        );
      } else {
        return res.status(200).json({
          message: "Investor report data fetched (already viewed)",
        });
      }
    });
  } catch (error) {
    return res.status(500).json({
      message: "Unexpected server error",
      error,
    });
  }
};

exports.getInvestorReportViewed = (req, res) => {
  const { user_id } = req.body;
  const query = `
    SELECT sharereport.*, investor_information.*, investor_updates.document_name,investor_updates.created_at as date_report FROM sharereport  JOIN investor_information ON investor_information.email = sharereport.investor_email LEFT JOIN investor_updates ON  investor_updates.id = sharereport.investor_updates_id WHERE sharereport.user_id = ?;`;

  db.query(query, [user_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "",
      results: results,
    });
  });
};

exports.exportInvestorExcel = async (req, res) => {
  const { user_id, update_id } = req.body; // update_id is expected to be an array

  if (!Array.isArray(update_id) || update_id.length === 0) {
    return res.status(400).json({ message: "Invalid update_id" });
  }

  const query = `
    SELECT sharereport.*, investor_information.*,investor_updates.document_name
    FROM sharereport
    LEFT JOIN investor_information 
      ON investor_information.email = sharereport.investor_email
    LEFT JOIN investor_updates ON  investor_updates.id = sharereport.investor_updates_id
    WHERE sharereport.user_id = ?
      AND sharereport.investor_updates_id IN (?);
  `;

  try {
    const [rows] = await db.promise().query(query, [user_id, update_id]);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Investor Report");

    worksheet.columns = [
      { header: "Investor Email", key: "investor_email", width: 30 },
      { header: "Report Type", key: "report_type", width: 30 },
      { header: "Document Name", key: "document_name", width: 30 },
      { header: "Sent Date", key: "sent_date", width: 15 },
      { header: "View Report", key: "date_view", width: 15 },
      { header: "IP Address", key: "investor_ip", width: 20 },
      { header: "First Name", key: "first_name", width: 20 },
      { header: "Last Name", key: "last_name", width: 20 },
      { header: "Phone", key: "phone", width: 20 },
      { header: "Country", key: "country", width: 20 },
      { header: "City", key: "city", width: 20 },
    ];

    rows.forEach((row) => {
      worksheet.addRow({
        investor_email: row.investor_email,
        report_type: row.report_type,
        document_name: row.document_name,
        sent_date: row.sent_date,
        date_view: row.date_view,
        investor_ip: row.investor_ip,
        first_name: row.first_name,
        last_name: row.last_name,
        phone: row.phone,
        country: row.country,
        city: row.city,
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=investor_report.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error("Excel export error:", error);
    res.status(500).json({ message: "Failed to export Excel", error });
  }
};

exports.getInvestorInfocheck = (req, res) => {
  const { email } = req.body;
  const query = `
    SELECT * from investor_information where email =?`;

  db.query(query, [email], (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      message: "",
      results: results,
    });
  });
};

exports.investorlogin = async (req, res) => {
  const { email, password } = req.body;

  try {
    db.query(
      "SELECT * FROM investor_information WHERE email = ?",
      [email],
      async (err, rows) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        if (rows.length > 0) {
          const user = rows[0];
          const isPasswordValid = await bcrypt.compare(password, user.password);

          if (!isPasswordValid) {
            return res
              .status(200)
              .json({ status: "2", message: "Invalid email or password" });
          }

          // ✅ Generate JWT token with 1 hour expiry
          const token = jwt.sign(
            { id: user.id, email: user.email, role: "investor" },
            JWT_SECRET,
            { expiresIn: "1h" },
          );

          res.status(200).json({
            message: "Login successfully",
            status: "1",
            id: user.id,
            email: user.email,
            first_name: user.first_name,
            last_name: user.last_name,
            access_token: token,
          });
        } else {
          res
            .status(200)
            .json({ status: "2", message: "Invalid email or password" });
        }
      },
    );
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
};
exports.getreportForInvestorCompany = async (req, res) => {
  const { email } = req.body;

  try {
    // Check if user already exists
    db.query(
      "SELECT c.* FROM sharereport s LEFT JOIN company c ON c.id = s.user_id WHERE s.investor_email = ? GROUP BY s.user_id",
      [email],
      async (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        res.status(200).json({
          message: "Login successfully",
          results: results,
        });
      },
    );
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};

exports.resetPasswordinvestor = async (req, res) => {
  try {
    const { email } = req.body;
    const query = "SELECT * FROM investor_information WHERE email = ?";

    db.query(query, [email], async (err, results) => {
      if (err) {
        return res.status(500).json({
          message: "Database query error",
          error: err,
        });
      }

      if (results.length > 0) {
        if (results[0].is_register === "No") {
          return res.status(200).json({
            status: 2,
            message:
              "Your account is not fully set up yet. Please complete your profile before proceeding.",
          });
        } else {
        }
        const pass = generateStrongPassword(8);
        const hashedPassword = await bcrypt.hash(pass, 12);

        const updateQuery =
          "UPDATE investor_information SET password = ?, viewpassword = ? WHERE email = ?";
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
          },
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

  const htmlBody = `
  <!DOCTYPE html>
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Password Reset</title>
    </head>
    <body>
      <div style="width:600px;margin:0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <table style="width:600px;margin:0 auto;border-collapse:collapse;font-family:Verdana,Geneva,sans-serif;">
          <tr>
            <td style="background:#efefef;padding:10px 0;text-align:center;">
              <img src="logo.png" alt="logo" style="width:130px;" />
            </td>
          </tr>
          <tr>
            <td>
              <table>
                <tr>
                  <td style="padding:20px;">
                    <h2 style="margin:0 0 15px 0;font-size:16px;color:#111;">Dear ${fullName},</h2>
                    <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                      Your password has been successfully reset.
                    </p>
                    <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                      Here is your new login password: <strong>${newPassword}</strong>
                    </p>
                    <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                      We recommend that you log in and change this password immediately for your account's security.
                    </p>
                    <p style="margin:0 0 15px 0;font-size:14px;color:#111;">
                      If you did not request this password reset, please contact our support team immediately.
                    </p>
                    <p style="margin:0 0 15px 0;font-size:14px;color:#111;">Regards,<br/>Startup Portal Team</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </div>

      <div style="width:600px;margin:20px auto 0 auto;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
        <table style="width:600px;margin:0 auto;border-collapse:collapse;font-family:Verdana,Geneva,sans-serif;">
          <tr>
            <td style="padding:20px;text-align:center;font-size:0.9em;color:#666;">
             Capavate. Powered by BluePrint Catalyst Limited
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
    else console.log("Password reset email sent:", info.response);
  });
}

exports.getinvestorData = async (req, res) => {
  const { email } = req.body;

  try {
    // Check if user already exists
    db.query(
      "SELECT * from investor_information where email =?",
      [email],
      async (err, row) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        res.status(200).json({
          message: "Login successfully",
          results: row,
        });
      },
    );
  } catch (err) {
    res.status(500).json({
      message: "Server error",
      error: err.message,
    });
  }
};
exports.investordataUpdate = async (req, res) => {
  const { email, first_name, last_name, phone, city } = req.body;

  if (!email) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  const updateQuery = `
    UPDATE investor_information
    SET first_name = ?,last_name =?, phone = ?, city = ?
    WHERE email = ?
  `;

  db.query(
    updateQuery,
    [first_name, last_name, phone, city, email],
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
          email,
          first_name,
          phone,
          city,
        },
      });
    },
  );
};
exports.getinvestorRecorData = async (req, res) => {
  const { id, email } = req.body;

  if (!id || !email) {
    return res.status(400).json({ message: "Missing required fields." });
  }

  // Investor information query
  const investorQuery = `SELECT * FROM investor_information WHERE email = ?`;

  db.query(investorQuery, [email], (err, investorResult) => {
    if (err) {
      console.error("Investor data error:", err);
      return res.status(500).json({
        message: "Database error fetching investor data",
        error: err,
      });
    }

    if (investorResult.length === 0) {
      return res.status(404).json({
        message: "Investor not found",
        results: [],
      });
    }

    // Share report query
    const shareReportQuery = `
      SELECT * FROM sharereport 
      WHERE investor_email = ? AND investor_id = ?
    `;

    db.query(shareReportQuery, [email, id], (err, shareReportResult) => {
      if (err) {
        console.error("Share report error:", err);
        return res.status(500).json({
          message: "Database error fetching share report",
          error: err,
        });
      }

      // Combine both results
      const investorData = investorResult[0];

      return res.status(200).json({
        message: "Investor data fetched successfully",
        results: [
          {
            total_portfolio_company: investorResult,
            investor_report_reviewed:
              shareReportResult.length > 0 ? shareReportResult : [],
          },
        ],
      });
    });
  });
};
