const db = require("../../db");
const nodemailer = require("nodemailer");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const crypto = require("crypto");
const pdfParse = require("pdf-parse");

require("dotenv").config();
const JWT_SECRET = process.env.JWT_SECRET;
//Email Detail
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});
//Email Detail
exports.getCompanyTotalShares = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({ message: "company_id is required" });
  }

  const query = `
    SELECT 
      -- Get total shares from Round 0 (founder shares)
      (SELECT COALESCE(SUM(issuedshares), 0) 
       FROM roundrecord 
       WHERE company_id = ? AND round_type = 'Round 0') AS founder_shares,
      
      -- Get total shares from investment rounds
      (SELECT COALESCE(SUM(issuedshares), 0) 
       FROM roundrecord 
       WHERE company_id = ? AND round_type = 'Investment' AND roundStatus = 'ACTIVE') AS investment_shares,
      
      -- Get option pool percentage from latest active round
      (SELECT optionPoolPercent 
       FROM roundrecord 
       WHERE company_id = ? AND round_type = 'Investment' AND roundStatus = 'ACTIVE' 
       ORDER BY created_at DESC LIMIT 1) AS option_pool_percent,
      
      -- Get latest valuation
      (SELECT post_money 
       FROM roundrecord 
       WHERE company_id = ? AND round_type = 'Investment' AND roundStatus = 'ACTIVE' 
       ORDER BY created_at DESC LIMIT 1) AS latest_valuation,
      
      -- Get currency
      (SELECT currency 
       FROM roundrecord 
       WHERE company_id = ? 
       ORDER BY created_at DESC LIMIT 1) AS currency,
      
      -- Count total active investment rounds
      (SELECT COUNT(*) 
       FROM roundrecord 
       WHERE company_id = ? AND round_type = 'Investment' AND roundStatus = 'ACTIVE') AS total_rounds
  `;

  db.query(
    query,
    [company_id, company_id, company_id, company_id, company_id, company_id],
    (err, results) => {
      if (err) {
        console.error("Database error:", err);
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      const result = results[0] || {};

      const founderShares = Number(result.founder_shares) || 0;
      const investmentShares = Number(result.investment_shares) || 0;
      const totalCompanyShares = founderShares + investmentShares;

      const optionPoolPercent = Number(result.option_pool_percent) || 0;
      const optionPoolShares = Math.round(
        totalCompanyShares * (optionPoolPercent / 100)
      );

      const latestValuation = Number(result.latest_valuation) || 0;
      const currency = result.currency || "USD";
      const totalRounds = Number(result.total_rounds) || 0;

      // Calculate investor ownership percentage
      const investorOwnershipPercent =
        totalCompanyShares > 0
          ? parseFloat(
              ((investmentShares / totalCompanyShares) * 100).toFixed(2)
            )
          : 0;

      res.status(200).json({
        message: "Company total shares fetched successfully",
        results: {
          totalCompanyShares,
          founderShares,
          investmentShares,
          optionPoolPercent,
          optionPoolShares,
          latestValuation,
          currency,
          totalRounds,
          investorOwnershipPercent,
        },
      });
    }
  );
};
exports.getBasicVsFullyDilutedOwnership = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({
      success: false,
      error: "company_id is required",
    });
  }

  // Enhanced query to get all necessary data
  const query = `
    SELECT 
      r.id AS round_id,
      r.nameOfRound,
      r.round_type,
      r.issuedshares,
      r.roundsize,
      r.pre_money,
      r.post_money,
      r.optionPoolPercent,
      r.shareClassType,
      r.instrumentType,
      r.instrument_type_data,
      r.founder_data,
      r.total_founder_shares,
      r.created_at,
      irc.investor_id,
      irc.shares AS investor_shares,
      irc.investment_amount,
      ii.first_name,
      ii.last_name,
      ii.email
    FROM roundrecord r
    LEFT JOIN investorrequest_company irc 
      ON r.id = irc.roundrecord_id AND irc.request_confirm = 'Yes'
    LEFT JOIN investor_information ii
      ON irc.investor_id = ii.id
    WHERE r.company_id = ? 
      AND (r.roundStatus = 'ACTIVE' OR r.roundStatus IS NULL OR r.roundStatus = '')
    ORDER BY r.created_at ASC, r.id ASC
  `;

  db.query(query, [company_id], (err, rows) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        success: false,
        error: "Database query error",
        details: err.message,
      });
    }

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true,
        labels: ["Basic Ownership %", "Fully Diluted Ownership %"],
        datasets: [
          {
            label: "No Data Available",
            data: [100, 100],
            backgroundColor: "#808080",
          },
        ],
        metadata: {
          basicTotalShares: 0,
          fullyDilutedTotalShares: 0,
          message: "No rounds found for this company",
        },
      });
    }

    try {
      // Process data
      const rounds = {};
      const allStakeholders = new Map(); // name -> { basicShares, fullyDilutedShares }

      // Initialize with Founders
      allStakeholders.set("Founders", {
        basicShares: 0,
        fullyDilutedShares: 0,
      });

      // Group rows by round
      rows.forEach((row) => {
        if (!rounds[row.round_id]) {
          let instrumentData = {};
          try {
            if (row.instrument_type_data) {
              instrumentData = safeJSONParseRepeated(
                row.instrument_type_data,
                3
              );
            }
          } catch (e) {
            instrumentData = {};
          }

          rounds[row.round_id] = {
            id: row.round_id,
            name: row.nameOfRound || `Round ${row.round_id}`,
            type: row.round_type,
            issuedShares: toNumber(row.issuedshares, 0),
            roundSize: toNumber(row.roundsize, 0),
            preMoney: toNumber(row.pre_money, 0),
            postMoney: toNumber(row.post_money, 0),
            optionPoolPercent: toNumber(row.optionPoolPercent, 0),
            instrumentType: row.instrumentType,
            instrumentData: instrumentData,
            investors: [],
            founderData: row.founder_data
              ? safeJSONParseRepeated(row.founder_data, 3)
              : null,
            totalFounderShares: toNumber(row.total_founder_shares, 0),
            created_at: row.created_at,
          };
        }

        // Add investors
        if (row.investor_id) {
          const investorName =
            `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
            `Investor_${row.investor_id}`;

          rounds[row.round_id].investors.push({
            id: row.investor_id,
            name: investorName,
            shares: toNumber(row.investor_shares, 0),
            investmentAmount: toNumber(row.investment_amount, 0),
            email: row.email,
          });

          // Initialize investor in stakeholders
          if (!allStakeholders.has(investorName)) {
            allStakeholders.set(investorName, {
              basicShares: 0,
              fullyDilutedShares: 0,
            });
          }
        }
      });

      // Calculate Basic and Fully Diluted Shares
      let basicTotalShares = 0;
      let fullyDilutedTotalShares = 0;

      // Process each round chronologically
      const sortedRounds = Object.values(rounds).sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );

      // Track SAFE/Convertible notes for conversion
      const pendingConversions = [];

      sortedRounds.forEach((round) => {
        const roundBasicShares = round.issuedShares;
        basicTotalShares += roundBasicShares;
        fullyDilutedTotalShares += roundBasicShares;

        // Calculate price per share for this round
        let pricePerShare = 0;
        if (round.preMoney > 0 && round.issuedShares > 0) {
          pricePerShare = round.preMoney / round.issuedShares;
        } else if (round.postMoney > 0 && round.issuedShares > 0) {
          pricePerShare =
            (round.postMoney - round.roundSize) / round.issuedShares;
        } else if (round.roundSize > 0 && round.issuedShares > 0) {
          pricePerShare = round.roundSize / round.issuedShares;
        }

        // Process investors in this round
        let totalInvestorShares = 0;
        round.investors.forEach((investor) => {
          totalInvestorShares += investor.shares;

          const stakeholder = allStakeholders.get(investor.name);
          if (stakeholder) {
            stakeholder.basicShares += investor.shares;
            stakeholder.fullyDilutedShares += investor.shares;
          }

          // Track SAFE/Convertible notes for fully diluted calculation
          if (
            (round.instrumentType === "Safe" ||
              round.instrumentType === "Convertible Note") &&
            investor.investmentAmount > 0
          ) {
            pendingConversions.push({
              investorName: investor.name,
              investmentAmount: investor.investmentAmount,
              instrumentType: round.instrumentType,
              instrumentData: round.instrumentData,
              pricePerShare: pricePerShare,
              roundId: round.id,
            });
          }
        });

        // Allocate remaining shares to Founders
        const founderShares = roundBasicShares - totalInvestorShares;
        if (founderShares > 0) {
          const founders = allStakeholders.get("Founders");
          founders.basicShares += founderShares;
          founders.fullyDilutedShares += founderShares;
        }
      });

      // Process SAFE/Convertible notes for fully diluted calculation
      pendingConversions.forEach((conversion) => {
        const {
          investorName,
          investmentAmount,
          instrumentType,
          instrumentData,
          pricePerShare,
        } = conversion;

        if (pricePerShare > 0) {
          let conversionPrice = pricePerShare;
          let principalAmount = investmentAmount;

          // Apply discount if available
          if (instrumentData.discountRate) {
            const discount = toNumber(instrumentData.discountRate, 0) / 100;
            conversionPrice = conversionPrice * (1 - discount);
          }

          // Apply valuation cap if available
          if (instrumentData.valuationCap && fullyDilutedTotalShares > 0) {
            const capPrice =
              toNumber(instrumentData.valuationCap, 0) /
              fullyDilutedTotalShares;
            conversionPrice = Math.min(conversionPrice, capPrice);
          }

          // Add interest for Convertible Notes
          if (
            instrumentType === "Convertible Note" &&
            instrumentData.interestRate_note
          ) {
            const interestRate =
              toNumber(instrumentData.interestRate_note, 0) / 100;
            // Assuming 1 year for simplicity - you can make this dynamic based on maturity date
            principalAmount = investmentAmount * (1 + interestRate);
          }

          // Calculate potential shares
          const potentialShares = principalAmount / conversionPrice;

          const stakeholder = allStakeholders.get(investorName);
          if (stakeholder) {
            stakeholder.fullyDilutedShares += potentialShares;
            fullyDilutedTotalShares += potentialShares;
          }
        }
      });

      // Prepare chart datasets
      const datasets = [];
      const colorPalette = [
        "#1e40af",
        "#dc2626",
        "#059669",
        "#7c3aed",
        "#ea580c",
        "#f59e0b",
        "#10b981",
        "#6366f1",
        "#ec4899",
        "#8b5cf6",
        "#081828",
      ];

      let colorIndex = 0;
      allStakeholders.forEach((data, name) => {
        if (data.basicShares > 0 || data.fullyDilutedShares > 0) {
          const basicPercent =
            basicTotalShares > 0
              ? (data.basicShares / basicTotalShares) * 100
              : 0;
          const fullyDilutedPercent =
            fullyDilutedTotalShares > 0
              ? (data.fullyDilutedShares / fullyDilutedTotalShares) * 100
              : 0;

          datasets.push({
            label: name,
            data: [
              parseFloat(basicPercent.toFixed(2)),
              parseFloat(fullyDilutedPercent.toFixed(2)),
            ],
            backgroundColor: colorPalette[colorIndex % colorPalette.length],
            borderColor: colorPalette[colorIndex % colorPalette.length],
            borderWidth: 2,
          });
          colorIndex++;
        }
      });

      return res.status(200).json({
        success: true,
        labels: ["Basic Ownership %", "Fully Diluted Ownership %"],
        datasets: datasets,
        metadata: {
          basicTotalShares: Math.round(basicTotalShares),
          fullyDilutedTotalShares: Math.round(fullyDilutedTotalShares),
          totalRounds: Object.keys(rounds).length,
          totalInvestors: Array.from(allStakeholders.keys()).filter(
            (name) => name !== "Founders"
          ).length,
          pendingConversions: pendingConversions.length,
          calculationDate: new Date().toISOString(),
        },
      });
    } catch (error) {
      console.error("Error processing ownership data:", error);
      return res.status(500).json({
        success: false,
        error: "Error processing ownership data",
        details: error.message,
      });
    }
  });
};
function safeJSONParseRepeated(raw, maxDepth = 3) {
  let cur = raw;
  for (let i = 0; i < maxDepth; i++) {
    if (cur === null || cur === undefined) return null;
    if (typeof cur === "object") return cur;
    if (typeof cur !== "string") return null;
    cur = cur.trim();
    if (cur === "") return null;
    try {
      const parsed = JSON.parse(cur);
      // If parsed is a string again (double-encoded), loop and parse again
      cur = parsed;
      if (typeof cur === "object") return cur;
    } catch (e) {
      // Not JSON parsable as string -> stop
      return null;
    }
  }
  return null;
}
function toNumber(v, fallback = 0) {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const cleaned = v.replace(/[^0-9.\-]/g, "");
    const n = cleaned === "" ? NaN : Number(cleaned);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}
exports.getCompanystokes = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({
      success: false,
      message: "company_id is required",
    });
  }

  // Enhanced query to get all necessary data
  const roundsQuery = `
    SELECT 
      r.id AS round_id, 
      r.nameOfRound, 
      r.issuedshares, 
      r.roundsize,
      r.pre_money,
      r.post_money,
      r.optionPoolPercent,
      r.instrumentType,
      r.founder_data,
      r.total_founder_shares,
      r.created_at
    FROM roundrecord r
    WHERE r.company_id = ? 
      AND (r.roundStatus = 'ACTIVE' OR r.roundStatus IS NULL OR r.roundStatus = '')
    ORDER BY r.created_at ASC
  `;

  db.query(roundsQuery, [company_id], (err, rounds) => {
    if (err) {
      console.error("Error fetching rounds:", err);
      return res.status(500).json({
        success: false,
        message: "Server Error",
      });
    }

    if (!rounds || rounds.length === 0) {
      return res.status(200).json({
        success: true,
        results: [],
      });
    }

    const roundIds = rounds.map((r) => r.round_id);
    const placeholders = roundIds.map(() => "?").join(",");

    const investorQuery = `
      SELECT 
        irc.investor_id, 
        irc.shares, 
        irc.investment_amount, 
        irc.roundrecord_id,
        ii.first_name,
        ii.last_name
      FROM investorrequest_company irc
      LEFT JOIN investor_information ii ON irc.investor_id = ii.id
      WHERE irc.roundrecord_id IN (${placeholders})
        AND irc.request_confirm = 'Yes'
    `;

    db.query(investorQuery, roundIds, (err2, investorData) => {
      if (err2) {
        console.error("Error fetching investor data:", err2);
        return res.status(500).json({
          success: false,
          message: "Server Error",
        });
      }

      try {
        // Calculate totals across all rounds - FIXED LOGIC
        let totalCompanyShares = 0;
        let totalInvestorShares = 0;
        let totalFounderShares = 0;
        let totalOptionPoolShares = 0;

        const response = rounds.map((round) => {
          const totalRoundShares = toNumber(round.issuedshares, 0);
          const roundSize = toNumber(round.roundsize, 0);
          const optionPoolPercent = toNumber(round.optionPoolPercent, 0);

          const investorsInRound = investorData.filter(
            (inv) => inv.roundrecord_id === round.round_id
          );

          // Calculate investor shares for this round
          let roundInvestorShares = 0;
          const investors = investorsInRound.map((inv) => {
            const shares = toNumber(inv.shares, 0);
            roundInvestorShares += shares;
            return {
              investor_id: inv.investor_id,
              name: `${inv.first_name || ""} ${inv.last_name || ""}`.trim(),
              issued_shares: shares,
              investment_amount: toNumber(inv.investment_amount, 0),
              stake_percent: 0, // Will calculate later
            };
          });

          // Calculate founder shares for this round
          let founderShares = totalRoundShares - roundInvestorShares;
          if (founderShares < 0) founderShares = 0;

          // Calculate option pool shares for this round - FIXED
          let optionPoolShares = 0;
          if (optionPoolPercent > 0) {
            // Option pool is created from existing shares, not additional
            optionPoolShares = Math.round(
              totalRoundShares * (optionPoolPercent / 100)
            );
          }

          // Update global totals
          totalCompanyShares += totalRoundShares;
          totalInvestorShares += roundInvestorShares;
          totalFounderShares += founderShares;
          totalOptionPoolShares += optionPoolShares;

          // Calculate percentages for this round
          const totalSharesThisRound = totalRoundShares;
          investors.forEach((inv) => {
            inv.stake_percent =
              totalSharesThisRound > 0
                ? (inv.issued_shares / totalSharesThisRound) * 100
                : 0;
          });

          const founderPercent =
            totalSharesThisRound > 0
              ? (founderShares / totalSharesThisRound) * 100
              : 0;

          return {
            round_id: round.round_id,
            round_name: round.nameOfRound,
            total_issued_shares: totalRoundShares,
            round_size: roundSize,
            option_pool_shares: optionPoolShares,
            option_pool_percent: optionPoolPercent,
            founder_shares: founderShares,
            founder_percent: parseFloat(founderPercent.toFixed(2)),
            investors,
            pre_money_valuation: toNumber(round.pre_money, 0),
            post_money_valuation: toNumber(round.post_money, 0),
            instrument_type: round.instrumentType,
          };
        });

        // Calculate overall investor stakes percentage - FIXED
        // Option pool shares are part of total company shares
        const totalAllShares = totalCompanyShares; // Already includes all shares
        const overallInvestorStakesPercent =
          totalAllShares > 0 ? (totalInvestorShares / totalAllShares) * 100 : 0;

        // Debug logs to see what's happening
        console.log("Total Company Shares:", totalCompanyShares);
        console.log("Total Investor Shares:", totalInvestorShares);
        console.log("Total Founder Shares:", totalFounderShares);
        console.log("Total Option Pool Shares:", totalOptionPoolShares);
        console.log("Investor Stakes %:", overallInvestorStakesPercent);

        // Add summary to response
        const summary = {
          total_company_shares: totalCompanyShares,
          total_investor_shares: totalInvestorShares,
          total_founder_shares: totalFounderShares,
          total_option_pool_shares: totalOptionPoolShares,
          overall_investor_stakes_percent: parseFloat(
            overallInvestorStakesPercent.toFixed(2)
          ),
          total_rounds: rounds.length,
          total_investors: investorData.length,
        };

        res.json({
          success: true,
          results: response,
          summary: summary,
        });
      } catch (error) {
        console.error("Error processing data:", error);
        return res.status(500).json({
          success: false,
          message: "Error processing data",
        });
      }
    });
  });
};

exports.getCompanyopenround = (req, res) => {
  const company_id = req.body.company_id;

  // 1️⃣ Get latest open round
  db.query(
    `SELECT *
     FROM roundrecord
     WHERE company_id = ?
       AND LOWER(roundStatus) = LOWER(?)
       AND is_shared = ?
     ORDER BY id DESC LIMIT 1`,
    [company_id, "ACTIVE", "Yes"],
    (err, rows) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (rows.length === 0) {
        return res.status(200).json({
          message: "No open round found",
          success: true,
          roundInfo: {
            round_type: "",
            target_raise: "",
            raised_to_date: 0,
            expected_close: "",
            fundraising_progress: "0%",
            progresswidth: 0,
          },
        });
      }

      const round = rows[0];
      const roundId = round.id;
      const targetRaise = parseFloat(round.roundsize) || 0;

      // 2️⃣ Raised to Date = sum of investment_amount from investorrequest_company table
      db.query(
        `SELECT 
           SUM(CAST(irc.investment_amount AS DECIMAL(15,2))) as raisedToDate,
           COUNT(*) as totalInvestors
         FROM investorrequest_company irc
         WHERE irc.roundrecord_id = ? 
           AND irc.company_id = ?
           AND irc.request_confirm = ?`,
        [roundId, company_id, "Yes"],
        (err2, investResult) => {
          if (err2) {
            return res
              .status(500)
              .json({ message: "Error fetching investment data", error: err2 });
          }

          const raisedToDate = parseFloat(investResult[0]?.raisedToDate) || 0;
          const totalInvestors = parseInt(investResult[0]?.totalInvestors) || 0;

          // 3️⃣ Fundraising Progress
          const progress =
            targetRaise > 0
              ? ((raisedToDate / targetRaise) * 100).toFixed(2)
              : 0;

          const progresswidth =
            targetRaise > 0 ? (raisedToDate / targetRaise) * 100 : 0;

          // 4️⃣ Expected Close
          const expectedClose = round.dateroundclosed;

          // 5️⃣ Additional calculations
          const remainingAmount = targetRaise - raisedToDate;
          const progressStatus =
            progresswidth >= 100
              ? "Completed"
              : progresswidth >= 75
              ? "Nearly Complete"
              : progresswidth >= 50
              ? "In Progress"
              : "Starting";

          res.status(200).json({
            success: true,
            roundInfo: {
              round_id: roundId,
              round_type: round.nameOfRound + " " + round.shareClassType,
              target_raise: targetRaise,
              raised_to_date: raisedToDate,
              remaining_amount: remainingAmount > 0 ? remainingAmount : 0,
              total_investors: totalInvestors,
              expected_close: expectedClose,
              fundraising_progress: progress + "%",
              progresswidth: progresswidth,
              progress_status: progressStatus,
              currency: round.currency || "USD",
              // Additional round details
              round_details: {
                description: round.description,
                instrument_type: round.instrumentType,
                issued_shares: round.issuedshares,
                general_notes: round.generalnotes,
                created_at: round.created_at,
              },
            },
          });
        }
      );
    }
  );
};

// Alternative version with more detailed investment breakdown
exports.getCompanyopenroundDetailed = (req, res) => {
  const company_id = req.body.company_id;

  // 1️⃣ Get latest open round
  db.query(
    `SELECT *
     FROM roundrecord
     WHERE company_id = ?
       AND LOWER(roundStatus) = LOWER(?)
       AND is_shared = ?
     ORDER BY id DESC LIMIT 1`,
    [company_id, "ACTIVE", "Yes"],
    (err, rows) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      if (rows.length === 0) {
        return res.status(200).json({
          message: "No open round found",
          success: true,
          roundInfo: null,
        });
      }

      const round = rows[0];
      const roundId = round.id;
      const targetRaise = parseFloat(round.roundsize) || 0;

      // 2️⃣ Get detailed investment data
      db.query(
        `SELECT 
           irc.investment_amount,
           irc.shares,
           irc.created_at as investment_date,
           irc.request_confirm,
           COUNT(*) as total_requests,
           SUM(CASE WHEN irc.request_confirm = 'Yes' THEN CAST(irc.investment_amount AS DECIMAL(15,2)) ELSE 0 END) as confirmed_amount,
           SUM(CASE WHEN irc.request_confirm = 'No' THEN CAST(irc.investment_amount AS DECIMAL(15,2)) ELSE 0 END) as pending_amount,
           COUNT(CASE WHEN irc.request_confirm = 'Yes' THEN 1 END) as confirmed_investors,
           COUNT(CASE WHEN irc.request_confirm = 'No' THEN 1 END) as pending_investors
         FROM investorrequest_company irc
         WHERE irc.roundrecord_id = ? 
           AND irc.company_id = ?
         GROUP BY irc.roundrecord_id`,
        [roundId, company_id],
        (err2, investResult) => {
          if (err2) {
            return res
              .status(500)
              .json({ message: "Error fetching investment data", error: err2 });
          }

          const investmentData = investResult[0] || {};
          const raisedToDate = parseFloat(investmentData.confirmed_amount) || 0;
          const pendingAmount = parseFloat(investmentData.pending_amount) || 0;
          const confirmedInvestors =
            parseInt(investmentData.confirmed_investors) || 0;
          const pendingInvestors =
            parseInt(investmentData.pending_investors) || 0;

          // 3️⃣ Progress calculations
          const progress =
            targetRaise > 0
              ? ((raisedToDate / targetRaise) * 100).toFixed(2)
              : 0;
          const progresswidth =
            targetRaise > 0 ? (raisedToDate / targetRaise) * 100 : 0;
          const remainingAmount = targetRaise - raisedToDate;

          res.status(200).json({
            success: true,
            roundInfo: {
              round_id: roundId,
              round_type: round.nameOfRound + " " + round.shareClassType,
              target_raise: targetRaise,
              raised_to_date: raisedToDate,
              pending_amount: pendingAmount,
              remaining_amount: remainingAmount > 0 ? remainingAmount : 0,
              confirmed_investors: confirmedInvestors,
              pending_investors: pendingInvestors,
              total_requests: confirmedInvestors + pendingInvestors,
              expected_close: round.dateroundclosed,
              fundraising_progress: progress + "%",
              progresswidth: progresswidth,
              currency: round.currency || "USD",
              completion_percentage: parseFloat(progress),
              round_status: round.roundStatus,
              is_shared: round.is_shared,
            },
          });
        }
      );
    }
  );
};

exports.getCompanyopenroundUserLog = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT sharerecordround.*,roundrecord.nameOfRound,roundrecord.shareClassType, investor_information.first_name, investor_information.last_name
     FROM sharerecordround
     JOIN investor_information ON investor_information.id = sharerecordround.investor_id
     JOIN roundrecord ON roundrecord.id = sharerecordround.roundrecord_id
     WHERE sharerecordround.company_id = ? 
       AND sharerecordround.access_status IN (?, ?)
     ORDER BY sharerecordround.id DESC Limit 5`,
    [company_id, "Only View", "Download"],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json(results);
    }
  );
};
exports.getDilutionForecast = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({ error: "company_id is required" });
  }

  // First, get Round 0 data for founder shares
  const roundZeroQuery = `
    SELECT 
      founder_data,
      issuedshares,
      total_founder_shares
    FROM roundrecord 
    WHERE company_id = ? AND round_type = 'Round 0'
    LIMIT 1
  `;

  db.query(roundZeroQuery, [company_id], (err, roundZeroResults) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ error: "Database query error", details: err });
    }

    // Get all active investment rounds
    const investmentRoundsQuery = `
      SELECT 
        r.id AS round_id,
        r.nameOfRound,
        r.shareClassType,
        r.round_type,
        r.issuedshares,
        r.roundsize,
        r.pre_money,
        r.post_money,
        r.optionPoolPercent,
        r.instrumentType,
        r.instrument_type_data,
        r.created_at,
        irc.investor_id,
        irc.shares AS investor_shares,
        irc.investment_amount,
        ii.first_name,
        ii.last_name
      FROM roundrecord r
      LEFT JOIN investorrequest_company irc 
        ON r.id = irc.roundrecord_id AND irc.request_confirm = 'Yes'
      LEFT JOIN investor_information ii
        ON irc.investor_id = ii.id
      WHERE r.company_id = ? 
        AND r.round_type = 'Investment'
        AND r.roundStatus = 'ACTIVE'
      ORDER BY r.created_at ASC, r.id ASC
    `;

    db.query(investmentRoundsQuery, [company_id], (err, rows) => {
      if (err) {
        console.error(err);
        return res
          .status(500)
          .json({ error: "Database query error", details: err });
      }

      // Parse Round 0 founder data
      let founderShares = 0;
      let founderNames = ["Founders"];

      if (roundZeroResults.length > 0) {
        const roundZero = roundZeroResults[0];
        founderShares =
          Number(roundZero.issuedshares) ||
          Number(roundZero.total_founder_shares) ||
          0;

        // Try to get founder names from founder_data
        try {
          if (roundZero.founder_data) {
            const founderData = JSON.parse(roundZero.founder_data);
            if (founderData.founders && Array.isArray(founderData.founders)) {
              founderNames = founderData.founders.map(
                (f) =>
                  `${f.firstName || ""} ${f.lastName || ""}`.trim() || "Founder"
              );
            }
          }
        } catch (e) {
          console.error("Error parsing founder data:", e);
        }
      }

      if (founderShares === 0 && rows.length === 0) {
        return res.status(200).json({
          labels: ["Initial"],
          datasets: [
            {
              label: "Founders",
              data: [100],
              backgroundColor: "#081828",
              borderColor: "#081828",
              borderWidth: 1,
            },
          ],
          message: "Only founder shares found",
        });
      }

      // Process investment rounds
      const roundsMap = {};
      const allStakeholders = new Set(founderNames);
      let cumulativeTotalShares = founderShares;

      // Add Round 0 as initial state
      const initialRound = {
        id: "round_0",
        name: "Round 0 - Incorporation",
        issuedShares: founderShares,
        roundSize: 0,
        investors: [],
        isRoundZero: true,
      };
      roundsMap["round_0"] = initialRound;

      rows.forEach((row) => {
        if (!roundsMap[row.round_id]) {
          let instrumentData = {};
          try {
            if (row.instrument_type_data)
              instrumentData = JSON.parse(row.instrument_type_data);
          } catch (e) {
            instrumentData = {};
          }

          roundsMap[row.round_id] = {
            id: row.round_id,
            name: row.nameOfRound || `Round ${Object.keys(roundsMap).length}`,
            issuedShares: Number(row.issuedshares || 0),
            roundSize: Number(row.roundsize || 0),
            preMoney: Number(row.pre_money || 0),
            postMoney: Number(row.post_money || 0),
            optionPoolPercent: Number(row.optionPoolPercent || 0),
            instrumentType: row.instrumentType,
            instrumentData,
            investors: [],
            created_at: row.created_at,
          };
        }

        if (row.investor_id) {
          const investorName =
            `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
            `Investor ${row.investor_id}`;

          roundsMap[row.round_id].investors.push({
            id: row.investor_id,
            name: investorName,
            shares: Number(row.investor_shares || 0),
            investmentAmount: Number(row.investment_amount || 0),
          });
          allStakeholders.add(investorName);
        }
      });

      const rounds = Object.values(roundsMap).sort((a, b) => {
        if (a.id === "round_0") return -1;
        if (b.id === "round_0") return 1;
        return new Date(a.created_at) - new Date(b.created_at);
      });

      // Calculate dilution over time
      const labels = [];
      const datasets = [];
      const stakeholderShares = {};

      // Initialize founder shares
      founderNames.forEach((name) => {
        stakeholderShares[name] = founderShares / founderNames.length;
      });

      // Color palette
      const colorPalette = [
        "#1e40af",
        "#dc2626",
        "#059669",
        "#7c3aed",
        "#ea580c",
        "#f59e0b",
        "#10b981",
        "#6366f1",
        "#ec4899",
        "#8b5cf6",
        "#ef4444",
        "#f97316",
        "#eab308",
        "#84cc16",
        "#06b6d4",
        "#8b5cf6",
        "#d946ef",
        "#f43f5e",
      ];

      // Add initial state (Round 0)
      labels.push("Round 0 - Incorporation");

      // Founder dataset
      datasets.push({
        label: "Founders",
        data: [100], // Start with 100% ownership
        backgroundColor: "#081828",
        borderColor: "#081828",
        borderWidth: 2,
      });

      // Process each investment round
      rounds.forEach((round, roundIndex) => {
        if (roundIndex === 0) return; // Skip Round 0 as we already added it

        labels.push(round.name);

        let totalNewShares = round.issuedShares;
        let investorSharesThisRound = 0;

        // Calculate investor shares for this round
        round.investors.forEach((investor) => {
          const shares = investor.shares || 0;
          stakeholderShares[investor.name] =
            (stakeholderShares[investor.name] || 0) + shares;
          investorSharesThisRound += shares;
        });

        // Update cumulative total shares
        cumulativeTotalShares += totalNewShares;

        // Calculate ownership percentages for all stakeholders
        const currentOwnership = {};
        Object.keys(stakeholderShares).forEach((stakeholder) => {
          currentOwnership[stakeholder] = parseFloat(
            (
              (stakeholderShares[stakeholder] / cumulativeTotalShares) *
              100
            ).toFixed(2)
          );
        });

        // Update datasets
        datasets.forEach((dataset) => {
          const currentValue = currentOwnership[dataset.label] || 0;
          dataset.data.push(currentValue);
        });

        // Add new investors to datasets
        round.investors.forEach((investor) => {
          const existingDataset = datasets.find(
            (ds) => ds.label === investor.name
          );
          if (!existingDataset) {
            const color =
              colorPalette[(datasets.length - 1) % colorPalette.length];
            datasets.push({
              label: investor.name,
              data: Array(roundIndex)
                .fill(0)
                .concat([currentOwnership[investor.name] || 0]),
              backgroundColor: color,
              borderColor: color,
              borderWidth: 2,
            });
          }
        });
      });

      return res.status(200).json({
        labels,
        datasets,
        totalShares: Math.round(cumulativeTotalShares),
        stakeholderBreakdown: stakeholderShares,
        message: "Dilution forecast generated successfully",
      });
    });
  });
};

// Helper function to assign colors to different share classes
function getColorForShareClass(shareClass) {
  const colors = {
    Equity: "#1e40af",
    Preferred: "#dc2626",
    Common: "#059669",
    Convertible: "#7c3aed",
    SAFE: "#ea580c",
  };
  return colors[shareClass] || "#6b7280";
}
exports.getShareholder = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({ error: "company_id is required" });
  }

  // Enhanced query to get proper data
  const query = `
    SELECT 
      r.id AS round_id,
      r.nameOfRound,
      r.round_type,
      r.shareClassType,
      r.issuedshares,
      r.roundsize,
      r.pre_money,
      r.post_money,
      r.optionPoolPercent,
      r.instrumentType,
      r.instrument_type_data,
      r.founder_data,
      r.total_founder_shares,
      r.created_at,
      irc.investor_id,
      irc.shares AS investor_shares,
      irc.investment_amount,
      ii.first_name,
      ii.last_name,
      ii.email
    FROM roundrecord r
    LEFT JOIN investorrequest_company irc 
      ON r.id = irc.roundrecord_id AND irc.request_confirm = 'Yes'
    LEFT JOIN investor_information ii
      ON irc.investor_id = ii.id
    WHERE r.company_id = ? 
      AND (r.roundStatus = 'ACTIVE' OR r.roundStatus IS NULL OR r.roundStatus = '')
    ORDER BY r.created_at ASC, r.id ASC
  `;

  db.query(query, [company_id], (err, rows) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ error: "Database query error", details: err });
    }

    if (!rows.length) {
      return res.status(200).json({
        shareholders: {
          labels: ["Founders"],
          data: [100],
          colors: ["#081828"],
        },
        ownershipTable: [
          {
            stakeholder: "Founders",
            shares: 0,
            percentage: 100,
            securityType: "Common Stock",
            color: "#081828",
          },
        ],
        metadata: {
          totalShares: 0,
          founderShares: 0,
          totalInvestorShares: 0,
          totalOptionPoolShares: 0,
        },
      });
    }

    try {
      // Process data
      const rounds = {};
      const stakeholders = {
        Founders: { shares: 0, type: "Founder", securityType: "Common Stock" },
      };

      let totalCompanyShares = 0;
      let totalOptionPoolShares = 0;

      // Group rows by round
      rows.forEach((row) => {
        if (!rounds[row.round_id]) {
          let instrumentData = {};
          let founderData = {};

          try {
            if (row.instrument_type_data) {
              instrumentData = safeJSONParseRepeated(
                row.instrument_type_data,
                3
              );
            }
            if (row.founder_data) {
              founderData = safeJSONParseRepeated(row.founder_data, 3);
            }
          } catch (e) {
            // Ignore parse errors
          }

          rounds[row.round_id] = {
            id: row.round_id,
            name: row.nameOfRound,
            type: row.round_type,
            issuedShares: toNumber(row.issuedshares, 0),
            roundSize: toNumber(row.roundsize, 0),
            preMoney: toNumber(row.pre_money, 0),
            postMoney: toNumber(row.post_money, 0),
            optionPoolPercent: toNumber(row.optionPoolPercent, 0),
            instrumentType: row.instrumentType,
            instrumentData: instrumentData,
            founderData: founderData,
            investors: [],
            created_at: row.created_at,
          };
        }

        // Add investors
        if (row.investor_id) {
          const investorName =
            `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
            `Investor_${row.investor_id}`;

          rounds[row.round_id].investors.push({
            id: row.investor_id,
            name: investorName,
            shares: toNumber(row.investor_shares, 0),
            investmentAmount: toNumber(row.investment_amount, 0),
            email: row.email,
          });

          // Initialize investor
          if (!stakeholders[investorName]) {
            stakeholders[investorName] = {
              shares: 0,
              type: "Investor",
              securityType:
                row.instrumentType === "Common Stock"
                  ? "Common Stock"
                  : "Preferred Stock",
            };
          }
        }
      });

      // Process rounds chronologically
      const sortedRounds = Object.values(rounds).sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );

      sortedRounds.forEach((round) => {
        const roundShares = round.issuedShares;
        const optionPoolPercent = round.optionPoolPercent;

        // Calculate option pool for this round
        let optionPoolShares = 0;
        if (optionPoolPercent > 0 && totalCompanyShares > 0) {
          optionPoolShares = Math.round(
            (totalCompanyShares * (optionPoolPercent / 100)) /
              (1 - optionPoolPercent / 100)
          );
          totalOptionPoolShares += optionPoolShares;
          totalCompanyShares += optionPoolShares;
        }

        // Add round shares to total
        totalCompanyShares += roundShares;

        // Process investors in this round (only for equity rounds)
        let roundInvestorShares = 0;
        if (
          round.instrumentType === "Common Stock" ||
          round.instrumentType === "Preferred Equity"
        ) {
          round.investors.forEach((investor) => {
            stakeholders[investor.name].shares += investor.shares;
            roundInvestorShares += investor.shares;
          });
        }

        // Calculate founder shares for this round
        const founderShares = roundShares - roundInvestorShares;
        if (founderShares > 0) {
          stakeholders["Founders"].shares += founderShares;
        }

        // For SAFE/Convertible Notes - track but don't add to current shares
        if (
          round.instrumentType === "Safe" ||
          round.instrumentType === "Convertible Note"
        ) {
          round.investors.forEach((investor) => {
            if (!stakeholders[investor.name]) {
              stakeholders[investor.name] = {
                shares: 0,
                type: "Investor",
                securityType: round.instrumentType,
                pendingConversion: true,
              };
            }
            // Note: These shares will be added during conversion in future
          });
        }
      });

      // Add Option Pool to stakeholders
      if (totalOptionPoolShares > 0) {
        stakeholders["Employee Option Pool"] = {
          shares: totalOptionPoolShares,
          type: "Option Pool",
          securityType: "Common Stock",
        };
      }

      // Prepare response data
      const shareholderLabels = [];
      const shareholderData = [];
      const shareholderColors = [];
      const ownershipTable = [];

      const colorPalette = [
        "#1e40af",
        "#dc2626",
        "#059669",
        "#7c3aed",
        "#ea580c",
        "#f59e0b",
        "#10b981",
        "#6366f1",
        "#ec4899",
        "#8b5cf6",
      ];

      let colorIndex = 0;

      Object.entries(stakeholders).forEach(([name, data]) => {
        if (data.shares <= 0 && !data.pendingConversion) return;

        const percentage =
          totalCompanyShares > 0 ? (data.shares / totalCompanyShares) * 100 : 0;

        const color =
          name === "Founders"
            ? "#081828"
            : name === "Employee Option Pool"
            ? "#6b7280"
            : colorPalette[colorIndex++ % colorPalette.length];

        shareholderLabels.push(name);
        shareholderData.push(parseFloat(percentage.toFixed(2)));
        shareholderColors.push(color);

        ownershipTable.push({
          stakeholder: name,
          shares: Math.round(data.shares),
          percentage: parseFloat(percentage.toFixed(2)),
          securityType: data.securityType,
          color: color,
          type: data.type,
          pendingConversion: data.pendingConversion || false,
        });
      });

      return res.status(200).json({
        shareholders: {
          labels: shareholderLabels,
          data: shareholderData,
          colors: shareholderColors,
        },
        ownershipTable,
        metadata: {
          totalShares: Math.round(totalCompanyShares),
          founderShares: Math.round(stakeholders["Founders"]?.shares || 0),
          totalInvestorShares: Object.entries(stakeholders)
            .filter(
              ([name, data]) =>
                data.type === "Investor" && !data.pendingConversion
            )
            .reduce((sum, [name, data]) => sum + data.shares, 0),
          totalOptionPoolShares: totalOptionPoolShares,
          pendingConversions: Object.entries(stakeholders).filter(
            ([name, data]) => data.pendingConversion
          ).length,
        },
      });
    } catch (error) {
      console.error("Error processing shareholder data:", error);
      return res.status(500).json({
        error: "Error processing data",
        details: error.message,
      });
    }
  });
};

exports.getTotalinvestor = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT * from company_investor where company_id  =?`,
    [company_id],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};
exports.getTotalinvestorcontact = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT company_investor.* from company_investor JOIN investor_information ON investor_information.id = company_investor.investor_id where company_investor.company_id  =? And investor_information.is_register = ?`,
    [company_id, "Yes"],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};
exports.getinvestorreportLogs = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT investor_information.first_name,investor_information.last_name,sharereport.*,investor_updates.document_name from  sharereport join investor_updates on investor_updates.id = sharereport.investor_updates_id join investor_information on investor_information.id = sharereport.investor_id where sharereport.company_id  =? And sharereport.report_type =? AND sharereport.date_view IS NOT NULL order by sharereport.date_view desc Limit 10`,
    [company_id, "Investor updates"],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};

exports.getinvestorDatarromreportLogs = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT investor_information.first_name,investor_information.last_name,sharereport.*,investor_updates.document_name from  sharereport join investor_updates on investor_updates.id = sharereport.investor_updates_id join investor_information on investor_information.id = sharereport.investor_id where sharereport.company_id  =? And sharereport.report_type =? AND sharereport.date_view IS NOT NULL order by sharereport.date_view desc Limit 10`,
    [company_id, "Due Diligence Document"],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};
exports.getrecentuploadFile = (req, res) => {
  const company_id = req.body.company_id;

  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT dataroomdocuments.*,dataroomsub_categories.name from dataroomdocuments JOIN dataroomsub_categories On dataroomsub_categories.id = dataroomdocuments.category_id where dataroomdocuments.company_id = ? order by dataroomdocuments.id desc limit 10`,
    [company_id, "Due Diligence Document"],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};
exports.getSignatoryActivity = (req, res) => {
  const user_id = req.body.user_id;
  const companyId = req.body.companyId;
  // Get latest open round with investor info where access_status is 'Only View' or 'Download'
  db.query(
    `SELECT * from company_signatories where user_id = ? And access_status = ? And company_id = ? order by accepted_at desc limit 10`,
    [user_id, "active", companyId],
    (err, results) => {
      if (err) {
        return res
          .status(500)
          .json({ message: "Database query error", error: err });
      }

      return res.status(200).json({
        results: results,
      });
    }
  );
};
exports.getCompanyAccess = async (req, res) => {
  try {
    const { company_id, user_id } = req.body;

    if (!company_id || !user_id) {
      return res.status(400).json({
        message: "Company ID and User ID are required",
        status: "0",
      });
    }

    // 🔹 Step 1: Check if user exists
    const [userResults] = await db
      .promise()
      .query("SELECT * FROM users WHERE id = ?", [user_id]);

    if (userResults.length === 0) {
      return res.status(200).json({
        message: "Invalid User",
        status: "2",
      });
    }

    const user = userResults[0];

    // 🔹 Step 2: Check if company exists and belongs to this user
    const [companyResults] = await db
      .promise()
      .query(
        "SELECT id AS company_id, company_name FROM company WHERE id = ? AND user_id = ?",
        [company_id, user_id]
      );

    if (companyResults.length === 0) {
      return res.status(200).json({
        message: "Invalid Company or No Permission",
        status: "2",
      });
    }

    const company = companyResults[0];

    // 🔹 Step 3: Generate JWT token
    const token = jwt.sign(
      { id: user.id, email: user.email, company_id: company.company_id },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    // 🔹 Step 4: Return response
    res.status(200).json({
      message: "Login successful",
      status: "1",
      token,
      user: {
        id: user.id,
        email: user.email,
        role: "owner",
        companies: [
          {
            id: company.company_id,
            name: company.company_name,
          },
        ],
      },
    });
  } catch (err) {
    console.error("Error in getCompanyAccess:", err);
    res.status(500).json({
      message: "Internal Server Error",
      status: "0",
      error: err.message,
    });
  }
};
exports.getInvestorRequestCompanyInvest = (req, res) => {
  var company_id = req.body.company_id;

  db.query(
    `SELECT access_logs_investor.*,investor_information.first_name,investor_information.last_name from access_logs_investor join investor_information on investor_information.id = access_logs_investor.investor_id where access_logs_investor.company_id = ? order by access_logs_investor.id limit 10`,
    [company_id],
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
    }
  );
};
exports.getCompanyOptionPoolLastestValuation = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({
      success: false,
      message: "Company ID is required",
    });
  }

  // Get all rounds with proper data
  const query = `
    SELECT 
      rr.id,
      rr.nameOfRound,
      rr.round_type,
      rr.issuedshares,
      rr.roundsize,
      rr.pre_money,
      rr.post_money,
      rr.optionPoolPercent,
      rr.currency,
      rr.dateroundclosed,
      rr.created_at,
      rr.founder_data,
      rr.total_founder_shares
    FROM roundrecord rr 
    WHERE rr.company_id = ? 
      AND (rr.roundStatus = 'ACTIVE' OR rr.roundStatus IS NULL OR rr.roundStatus = '')
    ORDER BY rr.created_at DESC
  `;

  db.query(query, [company_id], (err, rounds) => {
    if (err) {
      return res.status(500).json({
        success: false,
        message: "Database query error",
        error: err.message,
      });
    }

    if (!rounds || rounds.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          latest_valuation: {
            valuation_amount: 0,
            currency: "USD",
            price_per_share: 0,
            total_company_shares: 0,
          },
          option_pool: {
            total_option_pool_shares: 0,
            total_option_pool_percentage: 0,
            allocated_shares: 0,
            allocated_percentage: 0,
            available_shares: 0,
            available_percentage: 0,
          },
          summary: {
            total_company_shares: 0,
            latest_valuation: 0,
            option_pool_percentage: 0,
          },
        },
      });
    }

    try {
      // Process rounds chronologically to get current state
      const sortedRounds = [...rounds].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );

      let currentTotalShares = 0;
      let currentOptionPoolShares = 0;
      let latestValuation = 0;
      let latestCurrency = "USD";
      let pricePerShare = 0;

      // Calculate current state by processing each round
      sortedRounds.forEach((round) => {
        const issuedShares = toNumber(round.issuedshares, 0);
        const optionPoolPercent = toNumber(round.optionPoolPercent, 0);
        const preMoney = toNumber(round.pre_money, 0);
        const postMoney = toNumber(round.post_money, 0);
        const roundSize = toNumber(round.roundsize, 0);

        // Calculate option pool for this round
        if (optionPoolPercent > 0 && currentTotalShares > 0) {
          const newOptionPoolShares = Math.round(
            (currentTotalShares * (optionPoolPercent / 100)) /
              (1 - optionPoolPercent / 100)
          );
          currentOptionPoolShares += newOptionPoolShares;
          currentTotalShares += newOptionPoolShares;
        }

        // Add new shares from this round
        currentTotalShares += issuedShares;

        // Update latest valuation
        if (postMoney > 0) {
          latestValuation = postMoney;
          latestCurrency = round.currency || "USD";
          pricePerShare =
            currentTotalShares > 0 ? latestValuation / currentTotalShares : 0;
        } else if (preMoney > 0 && roundSize > 0) {
          latestValuation = preMoney + roundSize;
          latestCurrency = round.currency || "USD";
          pricePerShare =
            currentTotalShares > 0 ? latestValuation / currentTotalShares : 0;
        }
      });

      // Get latest round for additional info
      const latestRound = rounds[0];

      // For Option Pool Allocation - you need a separate table for this
      // For now, assuming 0 allocated (you need to implement option grants)
      const allocatedOptionShares = 0;
      const availableOptionShares =
        currentOptionPoolShares - allocatedOptionShares;

      const optionPoolPercentage =
        currentTotalShares > 0
          ? (currentOptionPoolShares / currentTotalShares) * 100
          : 0;

      const allocatedPercentage =
        currentTotalShares > 0
          ? (allocatedOptionShares / currentTotalShares) * 100
          : 0;

      const availablePercentage =
        currentTotalShares > 0
          ? (availableOptionShares / currentTotalShares) * 100
          : 0;

      return res.status(200).json({
        success: true,
        data: {
          latest_valuation: {
            valuation_amount: latestValuation,
            currency: latestCurrency,
            price_per_share: pricePerShare,
            based_on_round: latestRound?.nameOfRound || null,
            round_date: latestRound?.dateroundclosed || null,
            total_company_shares: currentTotalShares,
          },
          option_pool: {
            total_option_pool_shares: currentOptionPoolShares,
            total_option_pool_percentage: parseFloat(
              optionPoolPercentage.toFixed(2)
            ),
            allocated_shares: allocatedOptionShares,
            allocated_percentage: parseFloat(allocatedPercentage.toFixed(2)),
            available_shares: availableOptionShares,
            available_percentage: parseFloat(availablePercentage.toFixed(2)),
          },
          summary: {
            company_id: company_id,
            total_company_shares: currentTotalShares,
            latest_valuation: latestValuation,
            option_pool_percentage: parseFloat(optionPoolPercentage.toFixed(2)),
          },
        },
      });
    } catch (error) {
      return res.status(500).json({
        success: false,
        message: "Error processing data",
        error: error.message,
      });
    }
  });
};

exports.getCompanyName = async (req, res) => {
  try {
    const company_id = req.body.company_id;

    db.query(
      "SELECT * from company where id = ?",
      [company_id],
      async (err, row) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        return res.status(200).json({
          message: "",
          results: row,
        });
      }
    );
    // Hash the password
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};
