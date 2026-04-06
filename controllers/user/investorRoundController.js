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
//Email Detail
exports.getcompanyDetails = (req, res) => {
  const { company_id } = req.body;

  // Validate company_id
  if (!company_id) {
    return res.status(400).json({
      status: 0,
      message: "company_id is required",
    });
  }

  // Query with multiple LEFT JOINs
  const query = `
    SELECT 
      c.*,
      cli.entity_type,
      cli.business_number,
      cli.articles,
      cli.entity_name,
      cli.jurisdiction_country,
      cli.entity_structure,
      cli.office_address,
      cli.mailing_address
    FROM company c
    LEFT JOIN company_legal_information cli ON cli.company_id = c.id
    WHERE c.id = ?
  `;

  db.query(query, [company_id], (err, row) => {
    if (err) {
      return res.status(500).json({
        status: 0,
        message: "Database query error",
        error: err,
      });
    }

    return res.status(200).json({
      status: 1,
      message: "Company details fetched successfully",
      data: row,
    });
  });
};
exports.getcompanyRoundSeperateDetail = (req, res) => {
  const { round_id } = req.body;

  // Validate company_id
  if (!round_id) {
    return res.status(400).json({
      status: 0,
      message: "round_id is required",
    });
  }

  // Query to get investors that are NOT linked in company_investor table
  const query = `SELECT * FROM roundrecord where id = ?`;

  db.query(query, [round_id], (err, row) => {
    if (err) {
      return res.status(500).json({
        status: 0,
        message: "Database query error",
        error: err,
      });
    }

    return res.status(200).json({
      status: 1,
      message: "",
      data: row,
    });
  });
};

//Get round
