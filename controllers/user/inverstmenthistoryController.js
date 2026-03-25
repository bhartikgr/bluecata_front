const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const moment = require("moment-timezone");
const db = require("../../db");
const nodemailer = require("nodemailer");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");
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
const { json } = require("stream/consumers");

require("dotenv").config();
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
//All Investor Quatarly Email Send

exports.getInvestmentHistorylist = (req, res) => {
  const { company_id, investor_id, round_id } = req.body;

  const query = `
   SELECT 
     irc.*,
     rr.nameOfRound,
     rr.shareClassType,
     rr.instrumentType,
     rr.roundsize,
     rr.currency,
     rr.pre_money,
     rr.post_money,
     rr.share_price,
     rr.issuedshares,
     rr.round_type,
     rr.roundStatus,
     rr.created_at as round_created_at
   FROM investorrequest_company irc
   LEFT JOIN roundrecord rr ON rr.id = irc.roundrecord_id
   WHERE irc.company_id = ? 
     AND irc.investor_id = ? 
     AND irc.roundrecord_id = ? 
   ORDER BY irc.id DESC`;

  db.query(query, [company_id, investor_id, round_id], (err, results) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Database query error",
        error: err,
      });
    }

    res.status(200).json({
      success: true,
      message: "Investment history fetched successfully",
      results: results,
    });
  });
};
exports.getInvestmentHistoryWarrantlist = (req, res) => {
  const { company_id, investor_id, round_id, investorrequest_company_id } =
    req.body;

  const query = `
  SELECT 
    iw.*,
    w.warrant_coverage_percentage,
    w.warrant_exercise_type,
    w.warrant_adjustment_percent,
    w.warrant_adjustment_direction,
    w.expiration_date,
    w.issued_date,
    CASE 
      WHEN w.expiration_date IS NOT NULL AND w.expiration_date < CURDATE() THEN 'expired'
      ELSE 'exercised'
    END as exercise_status,
    CASE 
      WHEN w.expiration_date IS NOT NULL AND w.expiration_date < CURDATE() THEN 0
      ELSE 1
    END as is_valid_exercise
  FROM investors_warrants iw
  LEFT JOIN warrants w ON w.id = iw.warrant_id
  WHERE iw.company_id = ? 
    AND iw.investor_id = ? 
    AND iw.exercised_in_round_id = ? 
    AND iw.investorrequest_company_id = ?
  ORDER BY iw.id DESC
`;

  db.query(
    query,
    [company_id, investor_id, round_id, investorrequest_company_id],
    (err, results) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: "Database query error",
          error: err,
        });
      }

      res.status(200).json({
        success: true,
        message: "Investment history fetched successfully",
        results: results,
      });
    },
  );
};
