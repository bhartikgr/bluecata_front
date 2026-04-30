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
const logoBase64 = process.env.LOGO_BASE64;
//Email Detail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

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
          roundcalculation_warning_accepted=?,
            state=?,
            stateCode=?,
            countrycode=?,
            agreement_accepted=?,
            eligibility_accepted=?,
            risk_warning_accepted=?,
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
          "Yes",
          data.state || null,
          data.stateCode || null,
          data.countrycode || null,
          "Yes",
          "Yes",
          "Yes",
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
        console.log(
          "Company Country value being passed:",
          data.company_country,
        );
        console.log("Company Country in updateData array:", updateData[26]);
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

async function getPublicIP() {
  try {
    const res = await axios.get("https://api64.ipify.org?format=json");

    return res.data.ip;
  } catch (error) {
    return "";
  }
}
exports.getallcountrySymbolList = (req, res) => {
  db.query(
    "SELECT * FROM country_symbol order by name asc",
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

exports.getIndustryExpertise = (req, res) => {
  db.query(
    `SELECT *
    FROM industry_expertise
    ORDER BY name ASC`,
    (err, results) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database error",
          error: err.message,
        });
      }

      res.status(200).json({
        results: results,
      });
    },
  );
};
