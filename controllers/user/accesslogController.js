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
exports.getCompanyLogs = (req, res) => {
  var company_id = req.body.company_id;
  db.query(
    "SELECT * from audit_logs where company_id = ? order by id desc limit 10",
    [company_id],
    async (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      res.status(200).json({
        results: results,
      });
    }
  );
};
exports.deleteLogs = (req, res) => {
  const { id } = req.body;

  if (!id) {
    return res.status(400).json({ message: "Log ID is required" });
  }

  const deleteQuery = "DELETE FROM audit_logs WHERE id = ?";

  db.query(deleteQuery, [id], (err, result) => {
    if (err) {
      console.error("Delete log error:", err);
      return res
        .status(500)
        .json({ message: "Failed to delete log", error: err });
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Log not found" });
    }

    res.status(200).json({ message: "Log deleted successfully" });
  });
};
