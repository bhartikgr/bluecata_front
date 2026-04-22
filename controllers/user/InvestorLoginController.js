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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

require("dotenv").config();
const JWT_SECRET = process.env.JWT_SECRET;
const logoBase64 = process.env.LOGO_BASE64;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

// ─── Multer Storage ───────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(
      __dirname,
      "..",
      "..",
      "upload",
      "docs",
      "social_post",
    );
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `post_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
  ];
  allowed.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error("Only image files are allowed"), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
});
exports.uploadMiddleware = upload.array("images", 10);

// ─── Helper: get user name + image ───────────────────────────────────────────
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
