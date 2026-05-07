const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const OpenAI = require("openai");
const multer = require("multer");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Make sure this is set in your .env file
});
const Tesseract = require("tesseract.js");
const xlsx = require("xlsx");
const mammoth = require("mammoth");

require("dotenv").config();
//Email Detail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
//Email Detail

exports.getRoundZeroCurrency = (req, res) => {
  const company_id = req.body.company_id;

  const query = `
    SELECT currency from roundrecord where company_id = ? And round_type = ?`;

  db.query(query, [company_id, "Round 0"], (err, row) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    res.status(200).json({
      results: row,
    });
  });
};
