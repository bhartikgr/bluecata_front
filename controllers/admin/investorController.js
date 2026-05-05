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
exports.getinvestorProfile = (req, res) => {
  const investor_id = req.body.investor_id;
  const query = `SELECT * from investor_information where id =?`;

  db.query(query, [investor_id], (err, results) => {
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
exports.getinvestorTotalCompany = (req, res) => {
  const investor_id = req.body.investor_id;

  if (!investor_id) {
    return res.status(400).json({
      message: "investor_id is required",
    });
  }

  // Query for total companies (distinct companies from company_investor)
  const totalCompaniesQuery = `SELECT COUNT(DISTINCT company_id) as total_companies FROM company_investor WHERE investor_id = ?`;

  // Query for total rounds from sharerecordround
  const totalRoundsQuery = `SELECT COUNT(*) as total_rounds FROM sharerecordround WHERE investor_id = ?`;

  // Query for total reports from sharereport
  const totalReportsQuery = `SELECT COUNT(*) as total_reports FROM sharereport WHERE investor_id = ?`;

  // Execute all three queries in parallel
  Promise.all([
    new Promise((resolve, reject) => {
      db.query(totalCompaniesQuery, [investor_id], (err, results) => {
        if (err) reject(err);
        else resolve(results[0]?.total_companies || 0);
      });
    }),
    new Promise((resolve, reject) => {
      db.query(totalRoundsQuery, [investor_id], (err, results) => {
        if (err) reject(err);
        else resolve(results[0]?.total_rounds || 0);
      });
    }),
    new Promise((resolve, reject) => {
      db.query(totalReportsQuery, [investor_id], (err, results) => {
        if (err) reject(err);
        else resolve(results[0]?.total_reports || 0);
      });
    }),
  ])
    .then(([total_companies, total_rounds, total_reports]) => {
      res.status(200).json({
        success: true,
        investor_id: investor_id,
        total_companies: total_companies,
        total_rounds: total_rounds,
        total_reports: total_reports,
      });
    })
    .catch((err) => {
      return res.status(500).json({
        message: "Database query error",
        error: err,
      });
    });
};

exports.getCompanyInvite = (req, res) => {
  const investor_id = req.body.investor_id;
  const query = `SELECT 
      company_investor.*,
      company.company_name,
      company.company_industory,
      SUM(investorrequest_company.investment_amount) as total_investment_per_company,
      investorrequest_company.roundrecord_id as round_id,
      roundrecord.currency
    FROM company_investor
    LEFT JOIN company ON company.id = company_investor.company_id
    LEFT JOIN investorrequest_company ON investorrequest_company.company_id = company_investor.company_id 
      AND investorrequest_company.investor_id = company_investor.investor_id
    LEFT JOIN roundrecord ON roundrecord.id = investorrequest_company.roundrecord_id
    WHERE company_investor.investor_id = ?
    GROUP BY company_investor.company_id
    ORDER BY company_investor.id DESC`;

  db.query(query, [investor_id], (err, results) => {
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

exports.getRoundParticipating = (req, res) => {
  const investor_id = req.body.investor_id;
  const query = `SELECT 
  sharerecordround.*,
  company.company_name,
  roundrecord.nameOfRound,
  roundrecord.shareClassType,
  roundrecord.roundStatus,
  roundrecord.currency,
  investorrequest_company.investment_amount, 
  investorrequest_company.created_at as investmentdate
FROM sharerecordround
LEFT JOIN company ON company.id = sharerecordround.company_id
LEFT JOIN roundrecord ON roundrecord.id = sharerecordround.roundrecord_id
LEFT JOIN investorrequest_company ON investorrequest_company.roundrecord_id = sharerecordround.roundrecord_id 
  AND investorrequest_company.investor_id = sharerecordround.investor_id
  AND investorrequest_company.company_id = sharerecordround.company_id
WHERE sharerecordround.investor_id = ?
ORDER BY sharerecordround.id DESC`;

  db.query(query, [investor_id], (err, results) => {
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

exports.getInvestorReport = (req, res) => {
  const investor_id = req.body.investor_id;
  const query = `SELECT 
          sharereport.*,
          company.company_name,
          investor_updates.document_name
        FROM sharereport
        LEFT JOIN company ON company.id = sharereport.company_id
        LEFT JOIN investor_updates ON investor_updates.id = sharereport.investor_updates_id
        WHERE sharereport.investor_id = ?
        ORDER BY sharereport.id DESC`;

  db.query(query, [investor_id], (err, results) => {
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
