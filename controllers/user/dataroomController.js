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

exports.getInvestorDataRoomList = async (req, res) => {
  const { investor_id, company_id } = req.body;

  try {
    // Validate required fields
    if (!investor_id || !company_id) {
      return res.status(400).json({
        status: "0",
        message:
          "Missing required fields: investor_id and company_id are required",
      });
    }

    // Query to get records from sharereport table with company name
    const selectQuery = `
  SELECT 
    sr.*,
    c.company_name,
    c.id as company_id,
    sr.id as report_id,
    sr.report_type as doc_type,
    sr.sent_date,
    sr.access_status,
    sr.date_view as last_viewed,
    iu.document_name
  FROM sharereport sr
  LEFT JOIN company c ON c.id = sr.company_id
  LEFT JOIN investor_updates iu ON iu.id = sr.investor_updates_id
  WHERE sr.investor_id = ? AND sr.company_id = ?
  ORDER BY sr.sent_date DESC, sr.id DESC
`;

    db.query(selectQuery, [investor_id, company_id], (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res.status(500).json({
          status: "0",
          message: "Database query error",
          error: err.message,
        });
      }
      var pathname = "upload/docs/doc_" + company_id;

      // Format the response data
      const formattedResults = results.map((row) => ({
        ...row,
        doc_name: row.report_type || `Report ${row.id}`,
        sent_date_formatted: row.sent_date
          ? new Date(row.sent_date).toLocaleDateString()
          : null,
        status_badge:
          row.access_status === "Download"
            ? "Downloadable"
            : row.access_status === "Only View"
              ? "View Only"
              : "Not Viewed",
        downloadUrl: `http://localhost:5000/api/${pathname}/investor_report/${row.document_name}`,
      }));

      res.json({
        status: "1",
        message: "Records fetched successfully",
        results: formattedResults,
        count: results.length,
      });
    });
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({
      status: "0",
      message: err.message,
    });
  }
};

exports.getreportstatusUpdate = (req, res) => {
  const { sharereport_id } = req.body;

  // Validate sharereport_id
  if (!sharereport_id) {
    return res.status(400).json({
      status: 0,
      message: "sharereport_id is required",
    });
  }

  // Update query to set access_status = 'Download' and date_view = NOW()
  // Only update if access_status is not already 'Download'
  const query = `
    UPDATE sharereport 
    SET access_status = 'Download', 
        date_view = NOW() 
    WHERE id = ? AND access_status != 'Download'
  `;

  db.query(query, [sharereport_id], (err, result) => {
    if (err) {
      return res.status(500).json({
        status: 0,
        message: "Database update error",
        error: err,
      });
    }

    if (result.affectedRows === 0) {
      // Check if the report exists and is already downloaded
      const checkQuery = `SELECT access_status FROM sharereport WHERE id = ?`;

      db.query(checkQuery, [sharereport_id], (checkErr, checkResult) => {
        if (checkErr) {
          return res.status(500).json({
            status: 0,
            message: "Database check error",
            error: checkErr,
          });
        }

        if (checkResult.length === 0) {
          return res.status(404).json({
            status: 0,
            message: "Share report not found",
          });
        }

        if (checkResult[0].access_status === "Download") {
          return res.status(200).json({
            status: 2,
            message: "Report already downloaded. No update performed.",
            alreadyDownloaded: true,
          });
        }

        return res.status(404).json({
          status: 0,
          message: "Share report not found",
        });
      });
    } else {
      return res.status(200).json({
        status: 1,
        message: "Access status updated to Download successfully",
      });
    }
  });
};
