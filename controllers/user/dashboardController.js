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

  // Get all CLOSED rounds in chronological order
  const query = `
    SELECT 
      r.id,
      r.round_type,
      r.instrumentType,
      r.roundStatus,
      r.issuedshares,
      r.optionPoolPercent,
      r.pre_money,
      r.post_money,
      r.currency,
      r.created_at
    FROM roundrecord r
    WHERE r.company_id = ?
      AND (r.roundStatus = 'CLOSED' OR r.round_type = 'Round 0')
    ORDER BY 
      CASE 
        WHEN r.round_type = 'Round 0' THEN 0
        ELSE 1
      END,
      r.created_at ASC
  `;

  db.query(query, [company_id], (err, rounds) => {
    if (err) {
      console.error("Database error:", err);
      return res
        .status(500)
        .json({ message: "Database query error", error: err });
    }

    console.log(`Processing ${rounds.length} rounds for company ${company_id}`);

    // Sequential calculation
    let totalCompanyShares = 0;
    let founderShares = 0;
    let investmentShares = 0;
    let optionPoolShares = 0;
    let latestValuation = 0;
    let latestCurrency = "USD";
    let totalClosedRounds = 0;

    rounds.forEach((round) => {
      console.log(
        `\nProcessing: ${round.round_type} - ${round.instrumentType}`
      );

      if (round.round_type === "Round 0") {
        // Round 0: Founders
        founderShares = parseFloat(round.issuedshares) || 0;
        totalCompanyShares = founderShares;
        console.log(`Founder shares: ${founderShares}`);
      } else if (
        round.round_type === "Investment" &&
        round.roundStatus === "CLOSED"
      ) {
        totalClosedRounds++;

        // Update latest valuation
        const postMoney = parseFloat(round.post_money) || 0;
        const preMoney = parseFloat(round.pre_money) || 0;
        const roundSize = parseFloat(round.roundsize) || 0;

        if (postMoney > 0) {
          latestValuation = postMoney;
          latestCurrency = round.currency || "USD";
          console.log(
            `Updated valuation to: ${latestValuation} ${latestCurrency} (post_money)`
          );
        } else if (preMoney > 0 && roundSize > 0) {
          latestValuation = preMoney + roundSize;
          latestCurrency = round.currency || "USD";
          console.log(
            `Updated valuation to: ${latestValuation} ${latestCurrency} (pre_money + round_size)`
          );
        }

        // Process equity rounds
        if (
          round.instrumentType === "Common Stock" ||
          round.instrumentType === "Preferred Equity"
        ) {
          console.log(`Processing equity round`);

          // Add option pool FIRST
          const optionPoolPercent = parseFloat(round.optionPoolPercent) || 0;
          if (optionPoolPercent > 0 && totalCompanyShares > 0) {
            const newOptionShares = Math.round(
              totalCompanyShares *
                (optionPoolPercent / (100 - optionPoolPercent))
            );

            optionPoolShares += newOptionShares;
            totalCompanyShares += newOptionShares;

            console.log(
              `Added ${newOptionShares} option pool shares (${optionPoolPercent}%)`
            );
          }

          // Add investor shares
          const issuedShares = parseFloat(round.issuedshares) || 0;
          investmentShares += issuedShares;
          totalCompanyShares += issuedShares;

          console.log(`Added ${issuedShares} investor shares`);
        }
      }
    });

    // Calculate price per share
    const pricePerShare =
      totalCompanyShares > 0 ? latestValuation / totalCompanyShares : 0;

    console.log("\n=== FINAL CALCULATION ===");
    console.log(`Total Company Shares: ${totalCompanyShares}`);
    console.log(`- Founder Shares: ${founderShares}`);
    console.log(`- Investment Shares: ${investmentShares}`);
    console.log(`- Option Pool Shares: ${optionPoolShares}`);
    console.log(`Latest Valuation: ${latestValuation} ${latestCurrency}`);
    console.log(`Price per Share: ${pricePerShare}`);
    console.log(`Total Closed Rounds: ${totalClosedRounds}`);

    // Calculate percentages
    const founderOwnershipPercent =
      totalCompanyShares > 0 ? (founderShares / totalCompanyShares) * 100 : 0;

    const investorOwnershipPercent =
      totalCompanyShares > 0
        ? (investmentShares / totalCompanyShares) * 100
        : 0;

    const optionPoolOwnershipPercent =
      totalCompanyShares > 0
        ? (optionPoolShares / totalCompanyShares) * 100
        : 0;

    res.status(200).json({
      message: "Company total shares calculated successfully",
      results: {
        totalCompanyShares: Math.round(totalCompanyShares),
        founderShares: Math.round(founderShares),
        investmentShares: Math.round(investmentShares),
        optionPoolShares: Math.round(optionPoolShares),

        // Ownership percentages
        founderOwnershipPercent: parseFloat(founderOwnershipPercent.toFixed(2)),
        investorOwnershipPercent: parseFloat(
          investorOwnershipPercent.toFixed(2)
        ),
        optionPoolOwnershipPercent: parseFloat(
          optionPoolOwnershipPercent.toFixed(2)
        ),

        // Valuation
        latestValuation: parseFloat(latestValuation.toFixed(2)),
        currency: latestCurrency,
        pricePerShare: parseFloat(pricePerShare.toFixed(4)),

        // Additional info
        totalRounds: totalClosedRounds,
        calculationMethod: "Sequential processing including option pool",
      },
    });
  });
};
exports.getBasicVsFullyDilutedOwnership = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res.status(400).json({
      success: false,
      error: "company_id is required",
    });
  }

  // Get ALL CLOSED rounds including Round 0
  const query = `
    SELECT 
      r.id AS round_id,
      r.nameOfRound,
      r.round_type,
      r.roundStatus,
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
      AND (r.roundStatus = 'CLOSED' OR r.round_type = 'Round 0')
    ORDER BY 
      CASE 
        WHEN r.round_type = 'Round 0' THEN 0
        ELSE 1
      END,
      r.created_at ASC, 
      r.id ASC
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

    console.log(
      `Processing ${rows.length} rows for basic vs fully diluted ownership`
    );

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true,
        labels: ["Basic Ownership %", "Fully Diluted Ownership %"],
        datasets: [
          {
            label: "Founders",
            data: [100, 100],
            backgroundColor: "#081828",
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
      // Step 1: Group data by round
      const rounds = {};
      rows.forEach((row) => {
        if (!rounds[row.round_id]) {
          // Parse instrument data if available
          let instrumentData = {};
          try {
            if (row.instrument_type_data) {
              instrumentData = JSON.parse(row.instrument_type_data);
            }
          } catch (e) {
            console.error("Error parsing instrument data:", e);
          }

          rounds[row.round_id] = {
            id: row.round_id,
            name: row.nameOfRound || `Round`,
            type: row.round_type,
            instrumentType: row.instrumentType,
            status: row.roundStatus,
            issuedShares: parseFloat(row.issuedshares) || 0,
            roundSize: parseFloat(row.roundsize) || 0,
            preMoney: parseFloat(row.pre_money) || 0,
            postMoney: parseFloat(row.post_money) || 0,
            optionPoolPercent: parseFloat(row.optionPoolPercent) || 0,
            founderData: row.founder_data,
            totalFounderShares: parseFloat(row.total_founder_shares) || 0,
            instrumentData: instrumentData,
            investors: [],
            created_at: row.created_at,
          };
        }

        // Add investors to this round
        if (row.investor_id) {
          rounds[row.round_id].investors.push({
            id: row.investor_id,
            name:
              `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
              `Investor_${row.investor_id}`,
            shares: parseFloat(row.investor_shares) || 0,
            investment: parseFloat(row.investment_amount) || 0,
            email: row.email,
          });
        }
      });

      // Step 2: Initialize tracking variables
      let basicTotalShares = 0; // Only issued shares (founders + investors)
      let fullyDilutedTotalShares = 0; // Basic + Option Pool + Convertible securities

      const stakeholders = {
        Founders: { basic: 0, fullyDiluted: 0 },
      };

      const pendingConversions = []; // For SAFE/Convertible notes
      let totalOptionPoolShares = 0;

      console.log("\n=== CALCULATING BASIC VS FULLY DILUTED ===");

      // Step 3: Process rounds chronologically
      const sortedRoundIds = Object.keys(rounds).sort((a, b) => {
        const roundA = rounds[a];
        const roundB = rounds[b];

        // Round 0 always first
        if (roundA.type === "Round 0") return -1;
        if (roundB.type === "Round 0") return 1;

        // Then by creation date
        return new Date(roundA.created_at) - new Date(roundB.created_at);
      });

      sortedRoundIds.forEach((roundId) => {
        const round = rounds[roundId];
        console.log(`\nProcessing: ${round.name} (${round.type})`);

        if (round.type === "Round 0") {
          // Process Round 0 - Founders only
          if (round.founderData) {
            try {
              const founderData = JSON.parse(round.founderData);
              let totalFounderShares = 0;

              // Parse founder data (multiple formats)
              if (Array.isArray(founderData)) {
                founderData.forEach((founder) => {
                  const shares = parseFloat(founder.shares || 0);
                  const name = founder.name || `Founder`;
                  stakeholders[name] = { basic: shares, fullyDiluted: shares };
                  totalFounderShares += shares;
                });
              } else if (typeof founderData === "object") {
                Object.entries(founderData).forEach(([name, data]) => {
                  const shares =
                    typeof data === "object"
                      ? parseFloat(data.shares || 0)
                      : parseFloat(data || 0);
                  stakeholders[name] = { basic: shares, fullyDiluted: shares };
                  totalFounderShares += shares;
                });
              }

              basicTotalShares += totalFounderShares;
              fullyDilutedTotalShares += totalFounderShares;

              console.log(`Founder shares: ${totalFounderShares}`);
            } catch (e) {
              console.error("Error parsing founder data:", e);
            }
          }

          // Fallback to total_founder_shares
          if (Object.keys(stakeholders).length === 1) {
            // Only "Founders" key exists
            const founderShares =
              round.totalFounderShares > 0
                ? round.totalFounderShares
                : round.issuedShares;
            stakeholders["Founders"].basic = founderShares;
            stakeholders["Founders"].fullyDiluted = founderShares;
            basicTotalShares += founderShares;
            fullyDilutedTotalShares += founderShares;
            console.log(`Founder shares (fallback): ${founderShares}`);
          }
        } else if (round.type === "Investment" && round.status === "CLOSED") {
          // Process CLOSED investment rounds

          // Skip SAFE/Convertible for basic calculation
          if (
            round.instrumentType === "Safe" ||
            round.instrumentType === "Convertible Note"
          ) {
            console.log(
              `SAFE/Convertible round - adding to pending conversions`
            );

            // For fully diluted, calculate potential conversion
            round.investors.forEach((investor) => {
              pendingConversions.push({
                roundId: round.id,
                roundName: round.name,
                investorName: investor.name,
                investmentAmount: investor.investment,
                instrumentType: round.instrumentType,
                instrumentData: round.instrumentData,
                optionPoolPercent: round.optionPoolPercent,
              });
            });
          } else if (
            round.instrumentType === "Common Stock" ||
            round.instrumentType === "Preferred Equity"
          ) {
            console.log(`Processing equity round`);

            // Step 1: Calculate option pool for this round
            if (round.optionPoolPercent > 0 && fullyDilutedTotalShares > 0) {
              const newOptionShares = Math.round(
                fullyDilutedTotalShares *
                  (round.optionPoolPercent / (100 - round.optionPoolPercent))
              );

              totalOptionPoolShares += newOptionShares;
              fullyDilutedTotalShares += newOptionShares;

              console.log(
                `Option pool added: ${newOptionShares} shares (${round.optionPoolPercent}%)`
              );
            }

            // Step 2: Process investors
            const roundIssuedShares = round.issuedShares;
            let roundInvestorShares = 0;

            if (round.investors.length > 0) {
              round.investors.forEach((investor) => {
                if (!stakeholders[investor.name]) {
                  stakeholders[investor.name] = { basic: 0, fullyDiluted: 0 };
                }

                stakeholders[investor.name].basic += investor.shares;
                stakeholders[investor.name].fullyDiluted += investor.shares;
                roundInvestorShares += investor.shares;

                console.log(
                  `Added ${investor.shares} shares to ${investor.name}`
                );
              });
            } else {
              // Generic investor
              const genericInvestorName = `Investors (${round.name})`;
              if (!stakeholders[genericInvestorName]) {
                stakeholders[genericInvestorName] = {
                  basic: 0,
                  fullyDiluted: 0,
                };
              }

              stakeholders[genericInvestorName].basic += roundIssuedShares;
              stakeholders[genericInvestorName].fullyDiluted +=
                roundIssuedShares;
              roundInvestorShares = roundIssuedShares;

              console.log(
                `Added ${roundIssuedShares} shares to ${genericInvestorName}`
              );
            }

            // Step 3: Update totals
            basicTotalShares += roundIssuedShares;
            fullyDilutedTotalShares += roundIssuedShares;

            // Step 4: Founder dilution (remaining shares)
            const founderSharesInRound =
              roundIssuedShares - roundInvestorShares;
            if (founderSharesInRound > 0) {
              // Distribute among founders proportionally
              const founderKeys = Object.keys(stakeholders).filter(
                (key) => key.includes("Founder") || key === "Founders"
              );
              if (founderKeys.length > 0) {
                founderKeys.forEach((founderKey) => {
                  const proportion =
                    stakeholders[founderKey].basic / basicTotalShares;
                  const additionalShares = founderSharesInRound * proportion;
                  stakeholders[founderKey].basic += additionalShares;
                  stakeholders[founderKey].fullyDiluted += additionalShares;
                });
              }
            }
          }
        }
      });

      // Step 4: Add Option Pool to stakeholders for fully diluted
      if (totalOptionPoolShares > 0) {
        stakeholders["Employee Option Pool"] = {
          basic: 0,
          fullyDiluted: totalOptionPoolShares,
        };
      }

      // Step 5: Process pending conversions for fully diluted
      pendingConversions.forEach((conversion) => {
        console.log(`\nProcessing conversion for: ${conversion.investorName}`);

        if (!stakeholders[conversion.investorName]) {
          stakeholders[conversion.investorName] = { basic: 0, fullyDiluted: 0 };
        }

        // Calculate conversion price using document formula
        let conversionPrice = 0;
        const currentSharePrice =
          fullyDilutedTotalShares > 0
            ? (conversion.instrumentData?.valuation || 0) /
              fullyDilutedTotalShares
            : 0;

        // Apply discount if available
        const discount = (conversion.instrumentData?.discount || 0) / 100;
        const discountPrice = currentSharePrice * (1 - discount);

        // Apply valuation cap if available
        const cap = conversion.instrumentData?.valuationCap || 0;
        const capPrice = cap > 0 ? cap / fullyDilutedTotalShares : Infinity;

        conversionPrice = Math.min(discountPrice, capPrice);

        // Calculate conversion amount (with interest for notes)
        let conversionAmount = conversion.investmentAmount;
        if (conversion.instrumentType === "Convertible Note") {
          const interestRate =
            (conversion.instrumentData?.interestRate || 0) / 100;
          const years = conversion.instrumentData?.years || 1;
          conversionAmount =
            conversionAmount * Math.pow(1 + interestRate, years);
        }

        // Calculate converted shares
        if (conversionPrice > 0) {
          const convertedShares = Math.round(
            conversionAmount / conversionPrice
          );
          stakeholders[conversion.investorName].fullyDiluted += convertedShares;
          fullyDilutedTotalShares += convertedShares;

          console.log(
            `Converted ${conversionAmount} to ${convertedShares} shares at ${conversionPrice} per share`
          );
        }
      });

      console.log("\n=== FINAL TOTALS ===");
      console.log(`Basic Total Shares: ${basicTotalShares}`);
      console.log(`Fully Diluted Total Shares: ${fullyDilutedTotalShares}`);
      console.log(`Option Pool Shares: ${totalOptionPoolShares}`);
      console.log(`Stakeholders:`, Object.keys(stakeholders));

      // Step 6: Prepare chart datasets
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
        "#6b7280",
      ];

      let colorIndex = 0;

      Object.entries(stakeholders).forEach(([name, data]) => {
        // Calculate percentages
        const basicPercent =
          basicTotalShares > 0 ? (data.basic / basicTotalShares) * 100 : 0;

        const fullyDilutedPercent =
          fullyDilutedTotalShares > 0
            ? (data.fullyDiluted / fullyDilutedTotalShares) * 100
            : 0;

        // Only add if has any ownership
        if (basicPercent > 0.01 || fullyDilutedPercent > 0.01) {
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
          totalOptionPoolShares: totalOptionPoolShares,
          pendingConversions: pendingConversions.length,
          calculationNote:
            "Basic = Issued shares only. Fully Diluted = Basic + Option Pool + Convertible securities.",
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

  // Get ALL data including CLOSED rounds
  const query = `
    SELECT 
      r.id as round_id,
      r.nameOfRound,
      r.round_type,
      r.instrumentType,
      r.roundStatus,
      r.issuedshares as round_issued_shares,
      r.total_founder_shares,
      r.founder_data,
      r.optionPoolPercent,
      r.pre_money,
      r.post_money,
      r.roundsize,
      r.currency,
      r.created_at,
      irc.shares as investor_shares,
      irc.investment_amount,
      ii.first_name,
      ii.last_name
    FROM roundrecord r
    LEFT JOIN investorrequest_company irc 
      ON r.id = irc.roundrecord_id 
      AND irc.request_confirm = 'Yes'
    LEFT JOIN investor_information ii
      ON irc.investor_id = ii.id
    WHERE r.company_id = ?
      AND (r.roundStatus = 'CLOSED' OR r.round_type = 'Round 0')
    ORDER BY 
      CASE 
        WHEN r.round_type = 'Round 0' THEN 0
        ELSE 1
      END,
      r.created_at ASC
  `;

  db.query(query, [company_id], (err, rows) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ error: "Database query error", details: err });
    }

    console.log(`\n=== GENERATING DILUTION FORECAST ===`);
    console.log(`Total rows: ${rows.length}`);

    if (rows.length === 0) {
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

    try {
      // Step 1: Group by round
      const rounds = {};
      rows.forEach((row) => {
        if (!rounds[row.round_id]) {
          rounds[row.round_id] = {
            roundInfo: row,
            investors: [],
          };
        }

        if (row.investor_id && row.investor_shares) {
          rounds[row.round_id].investors.push({
            id: row.investor_id,
            name:
              `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
              `Investor_${row.investor_id}`,
            shares: parseFloat(row.investor_shares) || 0,
            investment: parseFloat(row.investment_amount) || 0,
          });
        }
      });

      // Step 2: Process data sequentially
      const labels = ["Round 0 - Incorporation"];
      const datasets = [];

      let currentTotalShares = 0;
      let founderShares = {};
      let investorShares = {};
      let optionPoolShares = 0;

      // Color palette - SAME as before
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

      // Step 3: Process Round 0 (Founders)
      const round0Id = Object.keys(rounds).find(
        (id) => rounds[id].roundInfo.round_type === "Round 0"
      );

      if (round0Id) {
        const round0 = rounds[round0Id];

        // Parse founder data
        if (round0.roundInfo.founder_data) {
          try {
            const founderData = JSON.parse(round0.roundInfo.founder_data);

            // Handle different founder_data formats
            if (Array.isArray(founderData)) {
              founderData.forEach((founder, index) => {
                const name = founder.name || `Founder ${index + 1}`;
                const shares = parseFloat(
                  founder.shares || founder.shares_count || 0
                );
                founderShares[name] = shares;
                currentTotalShares += shares;
              });
            } else if (typeof founderData === "object") {
              Object.entries(founderData).forEach(([key, data]) => {
                const shares =
                  typeof data === "object"
                    ? data.shares || 0
                    : parseFloat(data || 0);
                const name = key;
                founderShares[name] = shares;
                currentTotalShares += shares;
              });
            }
          } catch (e) {
            console.error("Error parsing founder_data:", e);
          }
        }

        // Fallback if no founder_data parsed
        if (Object.keys(founderShares).length === 0) {
          const totalShares =
            parseFloat(round0.roundInfo.total_founder_shares) ||
            parseFloat(round0.roundInfo.issuedshares) ||
            0;
          founderShares["Founders"] = totalShares;
          currentTotalShares = totalShares;
        }
      }

      console.log(`After Round 0 - Total Shares: ${currentTotalShares}`);
      console.log(`Founder Shares:`, founderShares);

      // Step 4: Add initial datasets for founders
      Object.keys(founderShares).forEach((founderName, index) => {
        const percentage =
          currentTotalShares > 0
            ? (founderShares[founderName] / currentTotalShares) * 100
            : 0;

        datasets.push({
          label: founderName,
          data: [parseFloat(percentage.toFixed(2))],
          backgroundColor:
            index === 0 ? "#081828" : colorPalette[index % colorPalette.length],
          borderColor:
            index === 0 ? "#081828" : colorPalette[index % colorPalette.length],
          borderWidth: 2,
        });
      });

      // Step 5: Process Investment Rounds chronologically
      const investmentRoundIds = Object.keys(rounds)
        .filter((id) => rounds[id].roundInfo.round_type === "Investment")
        .sort(
          (a, b) =>
            new Date(rounds[a].roundInfo.created_at) -
            new Date(rounds[b].roundInfo.created_at)
        );

      investmentRoundIds.forEach((roundId, roundIndex) => {
        const round = rounds[roundId];
        const roundInfo = round.roundInfo;

        // Only process CLOSED equity rounds
        if (roundInfo.roundStatus !== "CLOSED") return;

        if (
          roundInfo.instrumentType !== "Common Stock" &&
          roundInfo.instrumentType !== "Preferred Equity"
        ) {
          return; // Skip SAFE/Convertible
        }

        console.log(`\n--- Processing Round: ${roundInfo.nameOfRound} ---`);

        // Add to labels
        const roundNumber = roundIndex + 1;
        labels.push(`Round ${roundNumber} - ${roundInfo.nameOfRound}`);

        // Step 5A: Calculate option pool for this round (Document Formula)
        const optionPoolPercent = parseFloat(roundInfo.optionPoolPercent) || 0;
        if (optionPoolPercent > 0 && currentTotalShares > 0) {
          const newOptionShares = Math.round(
            currentTotalShares * (optionPoolPercent / (100 - optionPoolPercent))
          );

          optionPoolShares += newOptionShares;
          currentTotalShares += newOptionShares;

          console.log(`Added ${newOptionShares} option pool shares`);
        }

        // Step 5B: Add investor shares
        const roundIssuedShares =
          parseFloat(roundInfo.round_issued_shares) || 0;
        console.log(`Round issued shares: ${roundIssuedShares}`);

        if (round.investors.length > 0) {
          // Specific investors
          round.investors.forEach((investor) => {
            if (!investorShares[investor.name]) {
              investorShares[investor.name] = 0;
            }
            investorShares[investor.name] += investor.shares;
            currentTotalShares += investor.shares;

            console.log(`Added ${investor.shares} shares to ${investor.name}`);
          });
        } else {
          // Generic investor
          const genericInvestorName = `Investors (${roundInfo.nameOfRound})`;
          investorShares[genericInvestorName] = roundIssuedShares;
          currentTotalShares += roundIssuedShares;

          console.log(
            `Added ${roundIssuedShares} shares to ${genericInvestorName}`
          );
        }

        console.log(`Total after round: ${currentTotalShares}`);

        // Step 5C: Calculate NEW ownership percentages
        const newPercentages = {};

        // Founders
        Object.keys(founderShares).forEach((founderName) => {
          newPercentages[founderName] =
            currentTotalShares > 0
              ? (founderShares[founderName] / currentTotalShares) * 100
              : 0;
        });

        // Investors
        Object.keys(investorShares).forEach((investorName) => {
          newPercentages[investorName] =
            currentTotalShares > 0
              ? (investorShares[investorName] / currentTotalShares) * 100
              : 0;
        });

        // Option Pool
        if (optionPoolShares > 0) {
          newPercentages["Employee Option Pool"] =
            currentTotalShares > 0
              ? (optionPoolShares / currentTotalShares) * 100
              : 0;
        }

        // Step 5D: Update existing datasets
        datasets.forEach((dataset) => {
          if (newPercentages[dataset.label]) {
            dataset.data.push(
              parseFloat(newPercentages[dataset.label].toFixed(2))
            );
          } else {
            dataset.data.push(0);
          }
        });

        // Step 5E: Add NEW datasets for new stakeholders
        Object.keys(newPercentages).forEach((stakeholderName) => {
          const existingDataset = datasets.find(
            (ds) => ds.label === stakeholderName
          );

          if (!existingDataset) {
            // Find the first available color
            let colorIndex = datasets.length;
            while (colorIndex >= colorPalette.length) {
              colorIndex -= colorPalette.length;
            }

            // Create dataset with zeros for previous rounds
            const dataArray = Array(labels.length - 1).fill(0);
            dataArray.push(
              parseFloat(newPercentages[stakeholderName].toFixed(2))
            );

            datasets.push({
              label: stakeholderName,
              data: dataArray,
              backgroundColor: colorPalette[colorIndex],
              borderColor: colorPalette[colorIndex],
              borderWidth: 2,
            });

            console.log(`Added new dataset for: ${stakeholderName}`);
          }
        });
      });

      // Step 6: Add Employee Option Pool if exists but not added yet
      if (
        optionPoolShares > 0 &&
        !datasets.find((ds) => ds.label === "Employee Option Pool")
      ) {
        // Calculate option pool data for all rounds
        const optionPoolData = [];
        let tempOptionPool = 0;
        let tempTotalShares = 0;

        // Recalculate for each round
        labels.forEach((label, index) => {
          if (index === 0) {
            optionPoolData.push(0);
          } else {
            // Simulate option pool calculation for each round
            const roundIndex = index - 1;
            if (investmentRoundIds[roundIndex]) {
              const round = rounds[investmentRoundIds[roundIndex]];
              const optionPoolPercent =
                parseFloat(round.roundInfo.optionPoolPercent) || 0;

              if (optionPoolPercent > 0 && tempTotalShares > 0) {
                const newOptionShares = Math.round(
                  tempTotalShares *
                    (optionPoolPercent / (100 - optionPoolPercent))
                );
                tempOptionPool += newOptionShares;
                tempTotalShares += newOptionShares;
              }

              // Add investor shares
              const roundIssuedShares =
                parseFloat(round.roundInfo.round_issued_shares) || 0;
              tempTotalShares += roundIssuedShares;
            }

            const percentage =
              tempTotalShares > 0
                ? (tempOptionPool / tempTotalShares) * 100
                : 0;
            optionPoolData.push(parseFloat(percentage.toFixed(2)));
          }
        });

        datasets.push({
          label: "Employee Option Pool",
          data: optionPoolData,
          backgroundColor: "#6b7280",
          borderColor: "#6b7280",
          borderWidth: 2,
        });
      }

      // Step 7: Ensure all datasets have same length
      const maxLength = labels.length;
      datasets.forEach((dataset) => {
        while (dataset.data.length < maxLength) {
          dataset.data.push(0);
        }
      });

      console.log("\n=== FINAL DATASETS ===");
      console.log(`Labels:`, labels);
      console.log(`Number of datasets: ${datasets.length}`);

      datasets.forEach((ds) => {
        console.log(`${ds.label}:`, ds.data);
      });

      return res.status(200).json({
        labels,
        datasets,
        totalShares: Math.round(currentTotalShares),
        message: "Dilution forecast generated successfully",
      });
    } catch (error) {
      console.error("Error generating dilution forecast:", error);
      return res.status(500).json({
        error: "Error generating dilution forecast",
        details: error.message,
      });
    }
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

  // Step 1: Get all data
  const query = `
    SELECT 
      r.id as round_id,
      r.nameOfRound,
      r.round_type,
      r.instrumentType,
      r.roundStatus,
      r.issuedshares as round_issued_shares, -- Total new shares in round
      r.total_founder_shares,
      r.founder_data,
      r.optionPoolPercent,
      r.pre_money,
      r.post_money,
      r.roundsize,
      r.currency,
      irc.shares as investor_shares, -- PER INVESTOR shares
      irc.investment_amount,
      ii.first_name,
      ii.last_name,
      ii.email
    FROM roundrecord r
    LEFT JOIN investorrequest_company irc 
      ON r.id = irc.roundrecord_id 
      AND irc.request_confirm = 'Yes'
    LEFT JOIN investor_information ii
      ON irc.investor_id = ii.id
    WHERE r.company_id = ?
      AND (r.roundStatus = 'CLOSED' OR r.round_type = 'Round 0')
    ORDER BY 
      CASE 
        WHEN r.round_type = 'Round 0' THEN 0
        ELSE 1
      END,
      r.created_at ASC
  `;

  db.query(query, [company_id], (err, rows) => {
    if (err) {
      console.error(err);
      return res
        .status(500)
        .json({ error: "Database query error", details: err });
    }

    // Step 2: Group by round
    const rounds = {};
    rows.forEach((row) => {
      if (!rounds[row.round_id]) {
        rounds[row.round_id] = {
          roundInfo: row,
          investors: [],
        };
      }

      if (row.investor_id && row.investor_shares) {
        rounds[row.round_id].investors.push({
          id: row.investor_id,
          name:
            `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
            `Investor_${row.investor_id}`,
          shares: parseFloat(row.investor_shares) || 0, // PER INVESTOR shares
          investment: parseFloat(row.investment_amount) || 0,
        });
      }
    });

    // Step 3: Initialize
    let totalCompanyShares = 0;
    let founders = {};
    let investors = {};
    let optionPoolShares = 0;

    // Step 4: Process Round 0 first
    const round0Id = Object.keys(rounds).find(
      (id) => rounds[id].roundInfo.round_type === "Round 0"
    );
    if (round0Id) {
      const round0 = rounds[round0Id];

      // Method 1: Use total_founder_shares field
      if (round0.roundInfo.total_founder_shares > 0) {
        totalCompanyShares = parseFloat(round0.roundInfo.total_founder_shares);

        // Add generic founder entry
        founders["Founders"] = {
          shares: totalCompanyShares,
          type: "Founder",
          securityType: "Common Stock",
        };
      }

      // Method 2: Parse founder_data
      else if (round0.roundInfo.founder_data) {
        try {
          const founderData = JSON.parse(round0.roundInfo.founder_data);

          Object.entries(founderData).forEach(([founderName, data]) => {
            const shares = typeof data === "object" ? data.shares || 0 : data;
            const shareCount = parseInt(shares) || 0;

            founders[founderName] = {
              shares: shareCount,
              type: "Founder",
              securityType: "Common Stock",
            };
            totalCompanyShares += shareCount;
          });
        } catch (e) {
          console.error("Error parsing founder_data:", e);
        }
      }
    }

    // Step 5: Process Investment Rounds chronologically
    const investmentRoundIds = Object.keys(rounds)
      .filter((id) => rounds[id].roundInfo.round_type === "Investment")
      .sort(
        (a, b) =>
          new Date(rounds[a].roundInfo.created_at) -
          new Date(rounds[b].roundInfo.created_at)
      );

    investmentRoundIds.forEach((roundId) => {
      const round = rounds[roundId];
      const roundInfo = round.roundInfo;

      console.log(`\n--- Processing Round: ${roundInfo.nameOfRound} ---`);
      console.log(`Instrument Type: ${roundInfo.instrumentType}`);
      console.log(`Round Issued Shares: ${roundInfo.round_issued_shares}`);
      console.log(`Option Pool %: ${roundInfo.optionPoolPercent}`);
      console.log(`Investors: ${round.investors.length}`);

      // Skip if not CLOSED
      if (roundInfo.roundStatus !== "CLOSED") {
        console.log(`Skipping - Status: ${roundInfo.roundStatus}`);
        return;
      }

      // Process based on instrument type
      if (
        roundInfo.instrumentType === "Common Stock" ||
        roundInfo.instrumentType === "Preferred Equity"
      ) {
        // Step 5A: Add Option Pool
        const optionPoolPercent = parseFloat(roundInfo.optionPoolPercent) || 0;
        if (optionPoolPercent > 0 && totalCompanyShares > 0) {
          // CORRECT FORMULA from documents
          const newOptionShares = Math.round(
            totalCompanyShares * (optionPoolPercent / (100 - optionPoolPercent))
          );

          optionPoolShares += newOptionShares;
          totalCompanyShares += newOptionShares;
        }

        // Step 5B: Add Investors
        const roundIssuedShares =
          parseFloat(roundInfo.round_issued_shares) || 0;

        if (round.investors.length > 0) {
          // Verify total investor shares match round issued shares
          const totalInvestorShares = round.investors.reduce(
            (sum, inv) => sum + inv.shares,
            0
          );

          if (Math.abs(totalInvestorShares - roundIssuedShares) > 1) {
            console.warn(
              `⚠️ Warning: Investor shares (${totalInvestorShares}) don't match round issued shares (${roundIssuedShares})`
            );
          }

          // Add each investor
          round.investors.forEach((investor) => {
            if (!investors[investor.name]) {
              investors[investor.name] = {
                shares: 0,
                type: "Investor",
                securityType:
                  roundInfo.instrumentType === "Common Stock"
                    ? "Common Stock"
                    : "Preferred Stock",
              };
            }

            investors[investor.name].shares += investor.shares;
            totalCompanyShares += investor.shares;
          });
        } else {
          // No specific investors - add generic investor with all issued shares

          const genericInvestorName = `Investors (${roundInfo.nameOfRound})`;

          if (!investors[genericInvestorName]) {
            investors[genericInvestorName] = {
              shares: 0,
              type: "Investor",
              securityType:
                roundInfo.instrumentType === "Common Stock"
                  ? "Common Stock"
                  : "Preferred Stock",
              isGeneric: true,
            };
          }

          investors[genericInvestorName].shares += roundIssuedShares;
          totalCompanyShares += roundIssuedShares;
        }
      } else if (
        roundInfo.instrumentType === "Safe" ||
        roundInfo.instrumentType === "Convertible Note"
      ) {
        // Note: Convertible rounds don't add shares immediately
        // They will be processed when the next equity round occurs
      }
    });

    // Step 6: Prepare final stakeholders
    const allStakeholders = { ...founders, ...investors };

    // Add Option Pool if exists
    if (optionPoolShares > 0) {
      allStakeholders["Employee Option Pool"] = {
        shares: optionPoolShares,
        type: "Option Pool",
        securityType: "Common Stock",
      };
    }

    // Step 7: Calculate percentages
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

    Object.entries(allStakeholders).forEach(([name, data]) => {
      const percentage =
        totalCompanyShares > 0 ? (data.shares / totalCompanyShares) * 100 : 0;

      // Skip if percentage is too small
      if (
        percentage < 0.01 &&
        data.type !== "Founder" &&
        name !== "Employee Option Pool"
      ) {
        return;
      }

      const color =
        data.type === "Founder"
          ? "#081828"
          : name === "Employee Option Pool"
          ? "#6b7280"
          : data.isGeneric
          ? "#3b82f6"
          : colorPalette[colorIndex++ % colorPalette.length];

      shareholderLabels.push(name);
      shareholderData.push(parseFloat(percentage.toFixed(2)));
      shareholderColors.push(color);

      ownershipTable.push({
        stakeholder: name,
        shares: Math.round(data.shares),
        percentage: parseFloat(percentage.toFixed(2)),
        securityType: data.securityType || "Common Stock",
        color: color,
        type: data.type,
        isGeneric: data.isGeneric || false,
      });
    });

    // Sort by shares (descending)
    ownershipTable.sort((a, b) => b.shares - a.shares);

    return res.status(200).json({
      shareholders: {
        labels: shareholderLabels,
        data: shareholderData,
        colors: shareholderColors,
      },
      ownershipTable,
      metadata: {
        totalShares: Math.round(totalCompanyShares),
        founderShares: Object.values(founders).reduce(
          (sum, f) => sum + f.shares,
          0
        ),
        totalInvestors: Object.keys(investors).length,
        totalInvestorShares: Object.values(investors).reduce(
          (sum, i) => sum + i.shares,
          0
        ),
        totalOptionPoolShares: optionPoolShares,
        calculationNote: "Based on sequential round processing",
      },
    });
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

  // SAME query as getShareholder
  const query = `
    SELECT 
      r.id as round_id,
      r.nameOfRound,
      r.round_type,
      r.instrumentType,
      r.roundStatus,
      r.issuedshares as round_issued_shares,
      r.total_founder_shares,
      r.founder_data,
      r.optionPoolPercent,
      r.pre_money,
      r.post_money,
      r.roundsize,
      r.currency,
      r.dateroundclosed,
      r.created_at,
      r.liquidation,
      r.shareClassType,
      irc.shares as investor_shares,
      irc.investment_amount,
      ii.first_name,
      ii.last_name,
      ii.email
    FROM roundrecord r
    LEFT JOIN investorrequest_company irc 
      ON r.id = irc.roundrecord_id 
      AND irc.request_confirm = 'Yes'
    LEFT JOIN investor_information ii
      ON irc.investor_id = ii.id
    WHERE r.company_id = ?
      AND (r.roundStatus = 'CLOSED' OR r.round_type = 'Round 0')
    ORDER BY 
      CASE 
        WHEN r.round_type = 'Round 0' THEN 0
        ELSE 1
      END,
      r.created_at ASC
  `;

  db.query(query, [company_id], (err, rows) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({
        success: false,
        message: "Database query error",
        error: err.message,
      });
    }

    console.log(`Found ${rows.length} rows for company ${company_id}`);

    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true,
        data: {
          latest_valuation: {
            valuation_amount: 0,
            currency: "USD",
            price_per_share: 0,
            total_company_shares: 0,
            based_on_round: null,
            round_date: null,
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
            company_id: company_id,
            total_company_shares: 0,
            latest_valuation: 0,
            option_pool_percentage: 0,
            total_rounds: 0,
            closed_rounds: 0,
            active_rounds: 0,
          },
        },
      });
    }

    try {
      // Step 1: Group by round
      const rounds = {};
      rows.forEach((row) => {
        if (!rounds[row.round_id]) {
          rounds[row.round_id] = {
            roundInfo: row,
            investors: [],
          };
        }

        if (row.investor_id && row.investor_shares) {
          rounds[row.round_id].investors.push({
            id: row.investor_id,
            name:
              `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
              `Investor_${row.investor_id}`,
            shares: parseFloat(row.investor_shares) || 0,
            investment: parseFloat(row.investment_amount) || 0,
          });
        }
      });

      // Step 2: Process rounds sequentially
      let totalCompanyShares = 0;
      let totalFounderShares = 0;
      let totalInvestorShares = 0;
      let totalOptionPoolShares = 0;
      let latestValuation = 0;
      let latestCurrency = "USD";
      let latestRoundName = null;
      let latestRoundDate = null;

      let totalClosedRounds = 0;
      let totalActiveRounds = 0;

      console.log("\n=== Processing Rounds Chronologically ===");

      // Get sorted round IDs
      const sortedRoundIds = Object.keys(rounds).sort((a, b) => {
        const roundA = rounds[a].roundInfo;
        const roundB = rounds[b].roundInfo;

        // Round 0 always first
        if (roundA.round_type === "Round 0") return -1;
        if (roundB.round_type === "Round 0") return 1;

        // Then by creation date
        return new Date(roundA.created_at) - new Date(roundB.created_at);
      });

      // Process each round
      sortedRoundIds.forEach((roundId) => {
        const round = rounds[roundId];
        const roundInfo = round.roundInfo;

        console.log(
          `\n--- Processing: ${roundInfo.nameOfRound} (${roundInfo.round_type}) ---`
        );

        if (roundInfo.round_type === "Round 0") {
          // Process Round 0
          console.log(`Processing Round 0`);

          if (roundInfo.total_founder_shares > 0) {
            totalFounderShares = parseFloat(roundInfo.total_founder_shares);
            totalCompanyShares = totalFounderShares;
            console.log(`Founder shares: ${totalFounderShares}`);
          } else if (roundInfo.founder_data) {
            try {
              const founderData = JSON.parse(roundInfo.founder_data);
              let founderTotal = 0;
              Object.values(founderData).forEach((data) => {
                const shares =
                  typeof data === "object" ? data.shares || 0 : data;
                founderTotal += parseInt(shares) || 0;
              });
              totalFounderShares = founderTotal;
              totalCompanyShares = founderTotal;
              console.log(`Founder shares from data: ${totalFounderShares}`);
            } catch (e) {
              console.error("Error parsing founder_data:", e);
            }
          }
        } else if (roundInfo.round_type === "Investment") {
          // Track rounds
          if (roundInfo.roundStatus === "CLOSED") totalClosedRounds++;
          if (roundInfo.roundStatus === "ACTIVE") totalActiveRounds++;

          // Update latest valuation
          const postMoney = parseFloat(roundInfo.post_money) || 0;
          const preMoney = parseFloat(roundInfo.pre_money) || 0;
          const roundSize = parseFloat(roundInfo.roundsize) || 0;

          if (postMoney > 0 || (preMoney > 0 && roundSize > 0)) {
            latestValuation = postMoney > 0 ? postMoney : preMoney + roundSize;
            latestCurrency = roundInfo.currency || "USD";
            latestRoundName = roundInfo.nameOfRound;
            latestRoundDate = roundInfo.dateroundclosed;
            console.log(
              `Updated valuation: ${latestValuation} ${latestCurrency}`
            );
          }

          // Process CLOSED equity rounds
          if (
            roundInfo.roundStatus === "CLOSED" &&
            (roundInfo.instrumentType === "Common Stock" ||
              roundInfo.instrumentType === "Preferred Equity")
          ) {
            console.log(`Processing CLOSED equity round`);
            console.log(
              `Current total shares before round: ${totalCompanyShares}`
            );
            console.log(
              `Option pool % for this round: ${roundInfo.optionPoolPercent}%`
            );

            // Step 1: Calculate option pool for THIS ROUND (based on pre-investment shares)
            const optionPoolPercent =
              parseFloat(roundInfo.optionPoolPercent) || 0;
            if (optionPoolPercent > 0 && totalCompanyShares > 0) {
              // IMPORTANT: Calculate option pool BEFORE adding investor shares
              // Option pool is based on pre-investment shares
              const newOptionShares = Math.round(
                totalCompanyShares *
                  (optionPoolPercent / (100 - optionPoolPercent))
              );

              totalOptionPoolShares += newOptionShares;
              totalCompanyShares += newOptionShares;

              console.log(
                `Added ${newOptionShares} option pool shares (${optionPoolPercent}%)`
              );
              console.log(`Total after option pool: ${totalCompanyShares}`);
            }

            // Step 2: Add investor shares
            const roundIssuedShares =
              parseFloat(roundInfo.round_issued_shares) || 0;
            console.log(`Round issued shares: ${roundIssuedShares}`);

            // Calculate investor shares from round investors
            let roundInvestorShares = 0;
            if (round.investors.length > 0) {
              round.investors.forEach((investor) => {
                roundInvestorShares += investor.shares;
              });
            } else {
              roundInvestorShares = roundIssuedShares;
            }

            totalInvestorShares += roundInvestorShares;
            totalCompanyShares += roundInvestorShares;

            console.log(`Added ${roundInvestorShares} investor shares`);
            console.log(`Total after investors: ${totalCompanyShares}`);
          }
          // SAFE/Convertible rounds
          else if (
            roundInfo.instrumentType === "Safe" ||
            roundInfo.instrumentType === "Convertible Note"
          ) {
            console.log(`SAFE/Convertible round - no immediate shares`);
          }
        }
      });

      // Calculate price per share
      const pricePerShare =
        totalCompanyShares > 0 ? latestValuation / totalCompanyShares : 0;

      // Calculate percentages
      const optionPoolPercentage =
        totalCompanyShares > 0
          ? (totalOptionPoolShares / totalCompanyShares) * 100
          : 0;

      console.log(parseFloat(optionPoolPercentage.toFixed(2)), "aaaaa");

      // For Option Pool Allocation
      const allocatedOptionShares = 0; // From option grants table
      const availableOptionShares =
        totalOptionPoolShares - allocatedOptionShares;

      const allocatedPercentage =
        totalCompanyShares > 0
          ? (allocatedOptionShares / totalCompanyShares) * 100
          : 0;

      const availablePercentage =
        totalCompanyShares > 0
          ? (availableOptionShares / totalCompanyShares) * 100
          : 0;

      return res.status(200).json({
        success: true,
        data: {
          latest_valuation: {
            valuation_amount: parseFloat(latestValuation.toFixed(2)),
            currency: latestCurrency,
            price_per_share: parseFloat(pricePerShare.toFixed(6)),
            based_on_round: latestRoundName,
            round_date: latestRoundDate,
            total_company_shares: Math.round(totalCompanyShares),
            calculation_basis:
              "Based on most recent CLOSED round with valuation",
            _debug: {
              founder_shares: totalFounderShares,
              investor_shares: totalInvestorShares,
              option_pool_shares: totalOptionPoolShares,
              total_shares: totalCompanyShares,
              option_pool_percentage: optionPoolPercentage,
            },
          },
          option_pool: {
            total_option_pool_shares: Math.round(totalOptionPoolShares),
            total_option_pool_percentage: parseFloat(
              optionPoolPercentage.toFixed(2)
            ),
            allocated_shares: allocatedOptionShares,
            allocated_percentage: parseFloat(allocatedPercentage.toFixed(2)),
            available_shares: Math.round(availableOptionShares),
            available_percentage: parseFloat(availablePercentage.toFixed(2)),
            calculation_note:
              "Option pool calculated BEFORE investor shares are added",
          },
          summary: {
            company_id: company_id,
            total_company_shares: Math.round(totalCompanyShares),
            latest_valuation: parseFloat(latestValuation.toFixed(2)),
            option_pool_percentage: parseFloat(optionPoolPercentage.toFixed(6)),
            total_rounds: Object.keys(rounds).length,
            closed_rounds: totalClosedRounds,
            active_rounds: totalActiveRounds,
            calculation_method:
              "Option pool calculated per round before investor shares",
          },
          round_status_summary: {
            has_closed_rounds: totalClosedRounds > 0,
            has_active_rounds: totalActiveRounds > 0,
            latest_round_status: rows[0]?.roundStatus || "NO_ROUNDS",
            valuation_currency: latestCurrency,
          },
        },
      });
    } catch (error) {
      console.error("Error processing data:", error);
      return res.status(500).json({
        success: false,
        message: "Error processing data",
        error: error.message,
        stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
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
