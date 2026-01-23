const bcrypt = require("bcryptjs");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

const { format } = require("date-fns");
require("dotenv").config();
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
exports.getallinvestor = (req, res) => {
  const query = `
    SELECT 
      ii.*, 
      COUNT(ci.company_id) AS total_companies
    FROM investor_information ii
    LEFT JOIN company_investor ci
      ON ci.investor_id = ii.id
    GROUP BY ii.id
    ORDER BY ii.id DESC
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      results: results,
    });
  });
};

exports.getInvestorDetails = (req, res) => {
  const investor_id = req.body.investor_id;
  const query = `
    SELECT 
      * from company_investor where 
  `;

  db.query(query, (err, results) => {
    if (err) {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      results: results,
    });
  });
};
