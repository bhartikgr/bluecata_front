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
        `\nProcessing: ${round.round_type} - ${round.instrumentType}`,
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
            `Updated valuation to: ${latestValuation} ${latestCurrency} (post_money)`,
          );
        } else if (preMoney > 0 && roundSize > 0) {
          latestValuation = preMoney + roundSize;
          latestCurrency = round.currency || "USD";
          console.log(
            `Updated valuation to: ${latestValuation} ${latestCurrency} (pre_money + round_size)`,
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
                (optionPoolPercent / (100 - optionPoolPercent)),
            );

            optionPoolShares += newOptionShares;
            totalCompanyShares += newOptionShares;

            console.log(
              `Added ${newOptionShares} option pool shares (${optionPoolPercent}%)`,
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
          investorOwnershipPercent.toFixed(2),
        ),
        optionPoolOwnershipPercent: parseFloat(
          optionPoolOwnershipPercent.toFixed(2),
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
      `Processing ${rows.length} rows for basic vs fully diluted ownership`,
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
              `SAFE/Convertible round - adding to pending conversions`,
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
                  (round.optionPoolPercent / (100 - round.optionPoolPercent)),
              );

              totalOptionPoolShares += newOptionShares;
              fullyDilutedTotalShares += newOptionShares;

              console.log(
                `Option pool added: ${newOptionShares} shares (${round.optionPoolPercent}%)`,
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
                  `Added ${investor.shares} shares to ${investor.name}`,
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
                `Added ${roundIssuedShares} shares to ${genericInvestorName}`,
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
                (key) => key.includes("Founder") || key === "Founders",
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
            conversionAmount / conversionPrice,
          );
          stakeholders[conversion.investorName].fullyDiluted += convertedShares;
          fullyDilutedTotalShares += convertedShares;

          console.log(
            `Converted ${conversionAmount} to ${convertedShares} shares at ${conversionPrice} per share`,
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
            (inv) => inv.roundrecord_id === round.round_id,
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
              totalRoundShares * (optionPoolPercent / 100),
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
            overallInvestorStakesPercent.toFixed(2),
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
        },
      );
    },
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
        },
      );
    },
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
    },
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
        success: true,
        labels: ["Round 0"],
        datasets: [
          {
            label: "Founders",
            data: [100],
            backgroundColor: "#081828",
            borderColor: "#081828",
            borderWidth: 2,
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

      // Step 2: Initialize
      const labels = [];
      const datasets = [];

      // Track shares at each stage
      let founderShares = 0;
      let investorShares = 0;
      let optionPoolShares = 0;
      let totalShares = 0;

      // For chart ordering - FIXED ORDER as per screenshot
      const stakeholderOrder = [
        "Founders",
        "Investors (Founding Share Allocation)",
        "Employee Option Pool",
      ];

      // Color mapping as per screenshot
      const colorMap = {
        Founders: "#081828",
        "Investors (Founding Share Allocation)": "#1e40af",
        "Employee Option Pool": "#6b7280",
      };

      // Step 3: Sort rounds
      const sortedRoundIds = Object.keys(rounds).sort((a, b) => {
        const roundA = rounds[a].roundInfo;
        const roundB = rounds[b].roundInfo;

        if (roundA.round_type === "Round 0") return -1;
        if (roundB.round_type === "Round 0") return 1;

        return new Date(roundA.created_at) - new Date(roundB.created_at);
      });

      console.log("\n=== CALCULATION START ===");

      // Step 4: Process Round 0
      const round0Id = sortedRoundIds.find(
        (id) => rounds[id].roundInfo.round_type === "Round 0",
      );
      if (round0Id) {
        const round0 = rounds[round0Id];
        labels.push("Round 0 - Incorporation");

        // Get founder shares from Round 0
        if (round0.roundInfo.founder_data) {
          try {
            const founderData = JSON.parse(round0.roundInfo.founder_data);
            if (Array.isArray(founderData)) {
              founderShares = founderData.reduce((sum, founder) => {
                return sum + parseFloat(founder.shares || 0);
              }, 0);
            } else if (typeof founderData === "object") {
              Object.values(founderData).forEach((data) => {
                founderShares +=
                  typeof data === "object"
                    ? parseFloat(data.shares || 0)
                    : parseFloat(data || 0);
              });
            }
          } catch (e) {
            console.error("Error parsing founder_data:", e);
          }
        }

        // Fallback
        if (founderShares === 0) {
          founderShares =
            parseFloat(round0.roundInfo.total_founder_shares) ||
            parseFloat(round0.roundInfo.round_issued_shares) ||
            0;
        }

        totalShares = founderShares;

        console.log(`Round 0: Founders = ${founderShares} shares (100%)`);

        // Initialize datasets with Round 0 data
        stakeholderOrder.forEach((stakeholder) => {
          let percentage = 0;
          if (stakeholder === "Founders") {
            percentage = 100;
          }

          datasets.push({
            label: stakeholder,
            data: [percentage],
            backgroundColor: colorMap[stakeholder],
            borderColor: colorMap[stakeholder],
            borderWidth: 2,
            fill: true,
          });
        });
      }

      // Step 5: Process Round 1 (Founding Share Allocation)
      const round1Id = sortedRoundIds.find(
        (id) =>
          rounds[id].roundInfo.round_type === "Investment" &&
          rounds[id].roundInfo.roundStatus === "CLOSED",
      );

      if (round1Id) {
        const round1 = rounds[round1Id];
        const round1Info = round1.roundInfo;

        labels.push("Round 1 - Founding Share Allocation");

        console.log(`\nProcessing Round 1: ${round1Info.nameOfRound}`);
        console.log(
          `Pre-money: ${round1Info.pre_money}, Post-money: ${round1Info.post_money}`,
        );
        console.log(`Option Pool %: ${round1Info.optionPoolPercent}`);

        // Step 5A: Calculate Option Pool FIRST (as per document)
        const optionPoolPercent = parseFloat(round1Info.optionPoolPercent) || 0;
        if (optionPoolPercent > 0 && totalShares > 0) {
          // Formula: Option shares = Total shares * (optionPool% / (100 - optionPool%))
          optionPoolShares = Math.round(
            totalShares * (optionPoolPercent / (100 - optionPoolPercent)),
          );

          console.log(
            `Option Pool: ${optionPoolShares} shares (${optionPoolPercent}%)`,
          );
        }

        // Step 5B: Calculate Pre-money shares (with option pool)
        const preMoneyShares = totalShares + optionPoolShares;
        console.log(
          `Pre-money total shares: ${preMoneyShares} (Founders: ${founderShares}, Option: ${optionPoolShares})`,
        );

        // Step 5C: Calculate Investor Percentage
        const postMoney = parseFloat(round1Info.post_money) || 0;
        const preMoney = parseFloat(round1Info.pre_money) || 0;
        const investment = parseFloat(round1Info.roundsize) || 0;

        let investorPercentage = 0;
        if (postMoney > 0 && investment > 0) {
          investorPercentage = (investment / postMoney) * 100;
        } else if (preMoney > 0 && investment > 0) {
          investorPercentage = (investment / (preMoney + investment)) * 100;
        }

        console.log(
          `Investor target ownership: ${investorPercentage.toFixed(2)}%`,
        );

        // Step 5D: Calculate Investor Shares (as per document formula)
        if (investorPercentage > 0 && preMoneyShares > 0) {
          // Formula: Total post-money shares = Pre-money shares / (1 - investor%)
          const postMoneyShares = Math.round(
            preMoneyShares / (1 - investorPercentage / 100),
          );

          investorShares = postMoneyShares - preMoneyShares;

          console.log(`Investor shares: ${investorShares}`);
          console.log(`Total post-money shares: ${postMoneyShares}`);

          totalShares = postMoneyShares;
        } else {
          // Fallback: Use issued shares directly
          investorShares = parseFloat(round1Info.round_issued_shares) || 0;
          totalShares = preMoneyShares + investorShares;
          console.log(`Using issued shares: ${investorShares}`);
        }

        // Step 5E: Calculate Final Percentages
        const foundersPercentage = (founderShares / totalShares) * 100;
        const investorsPercentage = (investorShares / totalShares) * 100;
        const optionPoolPercentage = (optionPoolShares / totalShares) * 100;

        console.log(`\nFINAL CALCULATION:`);
        console.log(`Total Shares: ${totalShares}`);
        console.log(
          `Founders: ${founderShares} shares = ${foundersPercentage.toFixed(
            2,
          )}%`,
        );
        console.log(
          `Investors: ${investorShares} shares = ${investorsPercentage.toFixed(
            2,
          )}%`,
        );
        console.log(
          `Option Pool: ${optionPoolShares} shares = ${optionPoolPercentage.toFixed(
            2,
          )}%`,
        );
        console.log(
          `Check Sum: ${(
            foundersPercentage +
            investorsPercentage +
            optionPoolPercentage
          ).toFixed(2)}%`,
        );

        // Step 5F: Update datasets with Round 1 data
        datasets.forEach((dataset) => {
          if (dataset.label === "Founders") {
            dataset.data.push(parseFloat(foundersPercentage.toFixed(2)));
          } else if (
            dataset.label === "Investors (Founding Share Allocation)"
          ) {
            dataset.data.push(parseFloat(investorsPercentage.toFixed(2)));
          } else if (dataset.label === "Employee Option Pool") {
            dataset.data.push(parseFloat(optionPoolPercentage.toFixed(2)));
          }
        });
      }

      // Step 6: Handle additional rounds if any
      const additionalRounds = sortedRoundIds.filter((id) => {
        const round = rounds[id];
        return (
          round.roundInfo.round_type === "Investment" &&
          round.roundInfo.roundStatus === "CLOSED" &&
          id !== round1Id
        );
      });

      additionalRounds.forEach((roundId, index) => {
        const round = rounds[roundId];
        const roundInfo = round.roundInfo;
        const roundNum = index + 2;

        labels.push(`Round ${roundNum} - ${roundInfo.nameOfRound}`);

        // For now, just carry forward same percentages
        // In real implementation, you would calculate dilution for this round
        datasets.forEach((dataset) => {
          const lastValue = dataset.data[dataset.data.length - 1] || 0;
          dataset.data.push(lastValue);
        });
      });

      // Step 7: Ensure all datasets have same length
      const expectedLength = labels.length;
      datasets.forEach((dataset) => {
        while (dataset.data.length < expectedLength) {
          dataset.data.push(0);
        }
      });

      // Step 8: Reorder datasets as per stakeholderOrder
      const orderedDatasets = [];
      stakeholderOrder.forEach((stakeholder) => {
        const dataset = datasets.find((ds) => ds.label === stakeholder);
        if (dataset) {
          orderedDatasets.push(dataset);
        }
      });

      // Add any other stakeholders not in the fixed order
      datasets.forEach((dataset) => {
        if (!stakeholderOrder.includes(dataset.label)) {
          orderedDatasets.push(dataset);
        }
      });

      console.log("\n=== FINAL OUTPUT ===");
      console.log(`Labels:`, labels);
      console.log(`Datasets:`);
      orderedDatasets.forEach((ds) => {
        console.log(
          `  ${ds.label}:`,
          ds.data.map((d) => d.toFixed(2)),
        );
      });

      return res.status(200).json({
        success: true,
        labels: labels,
        datasets: orderedDatasets,
        metadata: {
          totalShares: Math.round(totalShares),
          founderShares: Math.round(founderShares),
          investorShares: Math.round(investorShares),
          optionPoolShares: Math.round(optionPoolShares),
          calculationNote:
            "Based on document formulas: Option pool calculated pre-money, then investor dilution applied",
        },
      });
    } catch (error) {
      console.error("Error generating dilution forecast:", error);
      return res.status(500).json({
        success: false,
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
      (id) => rounds[id].roundInfo.round_type === "Round 0",
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
          new Date(rounds[b].roundInfo.created_at),
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
            totalCompanyShares *
              (optionPoolPercent / (100 - optionPoolPercent)),
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
            0,
          );

          if (Math.abs(totalInvestorShares - roundIssuedShares) > 1) {
            console.warn(
              `⚠️ Warning: Investor shares (${totalInvestorShares}) don't match round issued shares (${roundIssuedShares})`,
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
          0,
        ),
        totalInvestors: Object.keys(investors).length,
        totalInvestorShares: Object.values(investors).reduce(
          (sum, i) => sum + i.shares,
          0,
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
    },
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
    },
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
    },
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
    },
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
    },
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
    },
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
        [company_id, user_id],
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
      { expiresIn: "1h" },
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
    },
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
          `\n--- Processing: ${roundInfo.nameOfRound} (${roundInfo.round_type}) ---`,
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
              `Updated valuation: ${latestValuation} ${latestCurrency}`,
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
              `Current total shares before round: ${totalCompanyShares}`,
            );
            console.log(
              `Option pool % for this round: ${roundInfo.optionPoolPercent}%`,
            );

            // Step 1: Calculate option pool for THIS ROUND (based on pre-investment shares)
            const optionPoolPercent =
              parseFloat(roundInfo.optionPoolPercent) || 0;
            if (optionPoolPercent > 0 && totalCompanyShares > 0) {
              // IMPORTANT: Calculate option pool BEFORE adding investor shares
              // Option pool is based on pre-investment shares
              const newOptionShares = Math.round(
                totalCompanyShares *
                  (optionPoolPercent / (100 - optionPoolPercent)),
              );

              totalOptionPoolShares += newOptionShares;
              totalCompanyShares += newOptionShares;

              console.log(
                `Added ${newOptionShares} option pool shares (${optionPoolPercent}%)`,
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
              optionPoolPercentage.toFixed(2),
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
      },
    );
    // Hash the password
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getRoundCapTableSingleRecord = (req, res) => {
  const { investor_id } = req.body;

  if (!investor_id) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }
  const query = `
  SELECT * FROM sharerecordround 
  WHERE investor_id = ?
  ORDER BY id DESC 
  LIMIT 1
`;

  db.query(query, [investor_id], (err, result) => {
    if (err) {
      console.error("Database error:", err);
      return;
    }
    if (result.length > 0) {
      const latestRecord = result[0]; // Get the first (latest) record
      var round_id = latestRecord.roundrecord_id;
      var company_id = latestRecord.company_id;

      // STEP 1: Round record fetch karo
      db.query(
        `SELECT r.*, c.year_registration
     FROM roundrecord r
     LEFT JOIN company c ON r.company_id = c.id
     WHERE r.id = ? AND r.company_id = ?`,
        [round_id, company_id],
        (err, roundResults) => {
          if (err || !roundResults || roundResults.length === 0) {
            return res
              .status(200)
              .json({ success: false, message: "Round not found" });
          }

          const currentRound = roundResults[0];
          const currency = currentRound.currency || "USD";
          const preMoneyVal = parseFloat(currentRound.pre_money) || 0;
          const postMoneyVal = parseFloat(currentRound.post_money) || 0;

          // Round 0 handling
          if (currentRound.round_type === "Round 0") {
            try {
              if (
                currentRound.founder_data &&
                typeof currentRound.founder_data === "string"
              ) {
                currentRound.founder_data = JSON.parse(
                  currentRound.founder_data,
                );
              }
            } catch (parseErr) {
              console.error("Error parsing Round 0 founder_data:", parseErr);
            }

            const round0CapTable = calculateRound0CapTable(currentRound);

            const response = {
              success: true,
              round: {
                id: currentRound.id,
                name: currentRound.nameOfRound || "Round 0",
                type: currentRound.round_type,
                instrument: "Common Stock",
                status: currentRound.roundStatus || "COMPLETED",
                date: currentRound.created_at,
                incorporation_date: currentRound.year_registration,
                pre_money: "0",
                round_target_money: currentRound.round_target_money,
                post_money: "0",
                investment: "0",
                currency: currentRound.currency || "USD",
                share_price: currentRound.share_price || "0.00",
                share_class_type: currentRound.shareClassType,
                instrument_type_data: currentRound.instrument_type_data,
                issued_shares:
                  currentRound.issuedshares ||
                  currentRound.total_founder_shares,
                total_shares_after:
                  currentRound.total_shares_after ||
                  currentRound.total_founder_shares,
                option_pool_percent: "0",
                investor_post_money: "0",
              },
              cap_table: {
                pre_money: round0CapTable,
                post_money: round0CapTable,
              },
              pending_conversions: [],
              calculations: {
                pre_money_valuation: 0,
                post_money_valuation: 0,
                total_shares_outstanding:
                  round0CapTable?.totals?.total_shares || 0,
                fully_diluted_shares: round0CapTable?.totals?.total_shares,
                share_price: parseFloat(currentRound.share_price) || 0,
              },
            };

            return res.status(200).json(response);
          }

          // HELPERS
          const fmt = (n) => Math.round(n || 0).toLocaleString();
          const money = (n) => `${currency} ${parseFloat(n || 0).toFixed(2)}`;
          const parseDetails = (d) => {
            try {
              return d ? (typeof d === "string" ? JSON.parse(d) : d) : null;
            } catch {
              return null;
            }
          };

          // ✅ Helper to calculate ownership percentage
          const calculatePercentage = (shares, totalShares) => {
            if (!totalShares || totalShares === 0) return 0;
            return (shares / totalShares) * 100;
          };

          const buildPendingItem = (p) => ({
            type: "pending",
            name:
              `${p.first_name || ""} ${p.last_name || ""}`.trim() ||
              p.round_name ||
              "Pending Investor",
            instrument_type: p.instrument_type,
            investment: parseFloat(p.investment_amount) || 0,
            potential_shares: parseInt(p.potential_shares) || 0,
            conversion_price: parseFloat(p.conversion_price) || 0,
            discount_rate: parseFloat(p.discount_rate) || 0,
            valuation_cap: parseFloat(p.valuation_cap) || 0,
            interest_rate: parseFloat(p.interest_rate) || 0,
            years: parseFloat(p.years) || 0,
            interest_accrued: parseFloat(p.interest_accrued) || 0,
            total_conversion_amount:
              parseFloat(p.total_conversion_amount) ||
              parseFloat(p.investment_amount) ||
              0,
            maturity_date: p.maturity_date || null,
            investor_details: parseDetails(p.investor_details),
            is_pending: true,
            shares: 0,
            new_shares: 0,
            total: 0,
            percentage: 0,
            percentage_formatted: "0.00%",
            value: 0,
            value_formatted: money(0),
            email: p.email || "",
            phone: p.phone || "",
            round_id: p.round_id,
            round_name:
              p.name_of_round ||
              p.round_name ||
              (p.instrument_type === "Convertible Note"
                ? "Convertible Note Round"
                : "SAFE Round"),
            pending_instrument_id: p.id,
            shareClassType: p.round_share_class_type || p.instrument_type,
          });

          const groupPendingByRound = (pendingItems) => {
            const groups = {};
            pendingItems.forEach((item) => {
              const key = `${item.round_id}_${item.instrument_type}`;
              if (!groups[key]) {
                groups[key] = {
                  type: "pending_group",
                  round_id: item.round_id,
                  round_name: item.round_name,
                  instrument_type: item.instrument_type,
                  shareClassType: item.shareClassType,
                  is_pending: true,
                  total_investment: 0,
                  total_potential_shares: 0,
                  items: [],
                };
              }
              groups[key].items.push(item);
              groups[key].total_investment += item.investment;
              groups[key].total_potential_shares += item.potential_shares;
            });

            return Object.values(groups).map((group) => ({
              ...group,
              label: `${group.items.length} investor${group.items.length > 1 ? "s" : ""}`,
              shares: 0,
              new_shares: 0,
              percentage: 0,
              percentage_formatted: "0.00%",
              value: 0,
              value_formatted: money(0),
            }));
          };

          // STEP 2: PRE Founders
          db.query(
            `SELECT * FROM round_founders WHERE round_id=? AND company_id=? AND cap_table_type='pre' ORDER BY id ASC`,
            [round_id, company_id],
            (err, preFounders) => {
              if (err)
                return res
                  .status(500)
                  .json({ success: false, message: err.message });

              // STEP 3: PRE Investors
              db.query(
                `SELECT * FROM round_investors WHERE round_id=? AND company_id=? AND cap_table_type='pre' ORDER BY id ASC`,
                [round_id, company_id],
                (err, preInvestors) => {
                  if (err)
                    return res
                      .status(500)
                      .json({ success: false, message: err.message });

                  // STEP 4: PRE Option Pool
                  db.query(
                    `SELECT * FROM round_option_pools WHERE round_id=? AND company_id=? AND cap_table_type='pre'`,
                    [round_id, company_id],
                    (err, preOptionPools) => {
                      if (err)
                        return res
                          .status(500)
                          .json({ success: false, message: err.message });

                      // STEP 5: POST Founders
                      db.query(
                        `SELECT * FROM round_founders WHERE round_id=? AND company_id=? AND cap_table_type='post' ORDER BY id ASC`,
                        [round_id, company_id],
                        (err, postFounders) => {
                          if (err)
                            return res
                              .status(500)
                              .json({ success: false, message: err.message });

                          // STEP 6: POST Investors
                          db.query(
                            `SELECT * FROM round_investors WHERE round_id=? AND company_id=? AND cap_table_type='post' ORDER BY id ASC`,
                            [round_id, company_id],
                            (err, postInvestors) => {
                              if (err)
                                return res.status(500).json({
                                  success: false,
                                  message: err.message,
                                });

                              // STEP 7: POST Option Pool
                              db.query(
                                `SELECT * FROM round_option_pools WHERE round_id=? AND company_id=? AND cap_table_type='post'`,
                                [round_id, company_id],
                                (err, postOptionPools) => {
                                  if (err)
                                    return res.status(500).json({
                                      success: false,
                                      message: err.message,
                                    });

                                  // STEP 8: Pending Instruments (SAFE + Convertible Note)
                                  db.query(
                                    `SELECT ri.*, 
                                  ri.round_name as name_of_round, 
                                  ri.instrument_type as round_instrument_type,
                                  ri.share_class_type as round_share_class_type
                                FROM round_investors ri
                                LEFT JOIN roundrecord r ON r.id = ri.round_id
                                WHERE ri.company_id = ? 
                                  AND ri.round_id = ?
                                  AND ri.investor_type = 'pending'
                                  AND ri.is_pending = 1
                                ORDER BY ri.round_id ASC, ri.id ASC`,
                                    [company_id, round_id],
                                    (err, pendingInstruments) => {
                                      if (err)
                                        return res.status(500).json({
                                          success: false,
                                          message: err.message,
                                        });

                                      // ========== PRE-MONEY BUILD ==========

                                      // ✅ GET PRE-MONEY WARRANTS
                                      const getPreWarrantsQuery = `
                                    SELECT ri.*, w.expiration_date, w.id as warrant_id
                                    FROM round_investors ri
                                    LEFT JOIN warrants w ON w.id = ri.warrant_id
                                    WHERE ri.round_id = ? 
                                      AND ri.company_id = ? 
                                      AND ri.cap_table_type = 'pre'
                                      AND ri.investor_type IN ('warrant', 'warrant not exercised')
                                      AND (w.expiration_date IS NULL OR w.expiration_date >= CURDATE())
                                  `;

                                      db.query(
                                        getPreWarrantsQuery,
                                        [round_id, company_id],
                                        (preWarrantErr, preWarrantResults) => {
                                          if (preWarrantErr) {
                                            console.error(
                                              "Error fetching pre-money warrants:",
                                              preWarrantErr,
                                            );
                                          }

                                          const preValidWarrants =
                                            preWarrantResults || [];

                                          const preFounderItems = (
                                            preFounders || []
                                          ).map((f) => ({
                                            type: "founder",
                                            founder_code: f.founder_code,
                                            name: `${f.first_name || ""} ${f.last_name || ""}`.trim(),
                                            email: f.email,
                                            phone: f.phone,
                                            shares: f.shares,
                                            shares_formatted: fmt(f.shares),
                                            value: parseFloat(f.value || 0),
                                            value_formatted: money(f.value),
                                            share_class_type:
                                              f.share_class_type,
                                            instrument_type: f.instrument_type,
                                            round_name: f.round_name,
                                          }));

                                          const prePool =
                                            (preOptionPools || [])[0] || null;
                                          const prePoolShares = prePool
                                            ? prePool.shares
                                            : 0;
                                          const prePoolValue = prePool
                                            ? parseFloat(prePool.value || 0)
                                            : 0;

                                          const prePrevInv = (
                                            preInvestors || []
                                          ).filter(
                                            (i) =>
                                              i.investor_type === "previous",
                                          );
                                          const preConvInv = (
                                            preInvestors || []
                                          ).filter(
                                            (i) =>
                                              i.investor_type === "converted",
                                          );

                                          // ✅ Calculate pre-warrant totals
                                          const preWarrantShares =
                                            preValidWarrants.reduce(
                                              (s, i) => s + i.shares,
                                              0,
                                            );
                                          const preWarrantValue =
                                            preValidWarrants.reduce(
                                              (s, i) =>
                                                s + parseFloat(i.value || 0),
                                              0,
                                            );

                                          const prePrevShares =
                                            prePrevInv.reduce(
                                              (s, i) => s + i.shares,
                                              0,
                                            );
                                          const prePrevValue =
                                            prePrevInv.reduce(
                                              (s, i) =>
                                                s + parseFloat(i.value || 0),
                                              0,
                                            );
                                          const preConvShares =
                                            preConvInv.reduce(
                                              (s, i) => s + i.shares,
                                              0,
                                            );
                                          const preConvValue =
                                            preConvInv.reduce(
                                              (s, i) =>
                                                s + parseFloat(i.value || 0),
                                              0,
                                            );

                                          const preTotalFounderShares =
                                            preFounderItems.reduce(
                                              (s, f) => s + f.shares,
                                              0,
                                            );
                                          const preTotalFounderValue =
                                            preFounderItems.reduce(
                                              (s, f) => s + f.value,
                                              0,
                                            );
                                          const preTotalShares =
                                            preTotalFounderShares +
                                            prePoolShares +
                                            prePrevShares +
                                            preConvShares +
                                            preWarrantShares; // ✅ Add pre-warrant shares
                                          const preTotalValue =
                                            preTotalFounderValue +
                                            prePoolValue +
                                            prePrevValue +
                                            preConvValue +
                                            preWarrantValue; // ✅ Add pre-warrant value

                                          // Group previous investors by round_name
                                          const prePrevGroups = {};
                                          prePrevInv.forEach((i) => {
                                            const key =
                                              i.round_name ||
                                              "Previous Investors";
                                            if (!prePrevGroups[key]) {
                                              prePrevGroups[key] = {
                                                round_name: key,
                                                round_id_ref: i.round_id_ref,
                                                shareClassType:
                                                  i.share_class_type ||
                                                  i.instrument_type ||
                                                  "",
                                                instrument_type:
                                                  i.instrument_type || "",
                                                items: [],
                                                total_shares: 0,
                                                total_value: 0,
                                              };
                                            }
                                            prePrevGroups[key].items.push(i);
                                            prePrevGroups[key].total_shares +=
                                              i.shares;
                                            prePrevGroups[key].total_value +=
                                              parseFloat(i.value || 0);
                                          });

                                          // ✅ Group pre-warrants by round_name
                                          const preWarrantGroups = {};
                                          preValidWarrants.forEach((i) => {
                                            // Use warrant_id as the unique grouping key
                                            const key = i.warrant_id
                                              ? i.warrant_id.toString()
                                              : `${i.round_name}_${i.investor_type}_${Math.random()}`;

                                            if (!preWarrantGroups[key]) {
                                              preWarrantGroups[key] = {
                                                warrant_id: i.warrant_id,
                                                round_name:
                                                  i.round_name || "Warrant",
                                                round_id_ref: i.round_id_ref,
                                                items: [],
                                                total_shares: 0,
                                                total_value: 0,
                                                investor_type: i.investor_type,
                                              };
                                            }
                                            preWarrantGroups[key].items.push(i);
                                            preWarrantGroups[
                                              key
                                            ].total_shares += i.shares;
                                            preWarrantGroups[key].total_value +=
                                              parseFloat(i.value || 0);
                                          });

                                          const prePendingItems =
                                            groupPendingByRound(
                                              (pendingInstruments || [])
                                                .filter(
                                                  (p) =>
                                                    p.cap_table_type === "pre",
                                                )
                                                .map(buildPendingItem),
                                            );

                                          // Helper function for pre-money warrants
                                          const buildPreWarrantItem = (
                                            warrant,
                                            totalShares,
                                            valuation,
                                          ) => ({
                                            type: "investor",
                                            name:
                                              `${warrant.first_name || ""} ${warrant.last_name || ""}`.trim() ||
                                              "Warrant Holder",
                                            investor_details: {
                                              firstName:
                                                warrant.first_name || "",
                                              lastName: warrant.last_name || "",
                                              email: warrant.email || "",
                                              phone: warrant.phone || "",
                                            },
                                            shares: warrant.shares,
                                            new_shares: warrant.shares,
                                            existing_shares: 0,
                                            total: warrant.shares,
                                            shares_formatted: fmt(
                                              warrant.shares,
                                            ),
                                            percentage: calculatePercentage(
                                              warrant.shares,
                                              totalShares,
                                            ),
                                            percentage_formatted:
                                              calculatePercentage(
                                                warrant.shares,
                                                totalShares,
                                              ).toFixed(2) + "%",
                                            value: parseFloat(
                                              warrant.value || 0,
                                            ),
                                            value_formatted: money(
                                              warrant.value,
                                            ),
                                            investment: parseFloat(
                                              warrant.investment_amount || 0,
                                            ),
                                            share_price: parseFloat(
                                              warrant.share_price || 0,
                                            ),
                                            is_previous: false,
                                            is_warrant: true,
                                            is_new_investment: true,
                                            is_converted: false,
                                            investor_type:
                                              warrant.investor_type,
                                            share_class_type:
                                              warrant.share_class_type,
                                            instrument_type:
                                              warrant.instrument_type,
                                            round_name: warrant.round_name,
                                            round_id: warrant.round_id,
                                            warrant_id: warrant.warrant_id,
                                          });

                                          // ✅ Calculate pre-money percentages
                                          const preMoneyCapTable = {
                                            total_shares: preTotalShares,
                                            pre_money_valuation: preMoneyVal,
                                            currency,
                                            items: [
                                              ...preFounderItems.map(
                                                (item) => ({
                                                  ...item,
                                                  percentage:
                                                    calculatePercentage(
                                                      item.shares,
                                                      preTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      item.shares,
                                                      preTotalShares,
                                                    ).toFixed(2) + "%",
                                                }),
                                              ),
                                              ...(prePool
                                                ? [
                                                    {
                                                      type: "option_pool",
                                                      founder_code: "O",
                                                      name: "Employee Option Pool",
                                                      shares: prePoolShares,
                                                      shares_formatted:
                                                        fmt(prePoolShares),
                                                      percentage:
                                                        calculatePercentage(
                                                          prePoolShares,
                                                          preTotalShares,
                                                        ),
                                                      percentage_formatted:
                                                        calculatePercentage(
                                                          prePoolShares,
                                                          preTotalShares,
                                                        ).toFixed(2) + "%",
                                                      value: prePoolValue,
                                                      value_formatted:
                                                        money(prePoolValue),
                                                      is_option_pool: true,
                                                      existing_shares:
                                                        prePool.existing_shares ||
                                                        prePoolShares,
                                                      new_shares:
                                                        prePool.new_shares || 0,
                                                    },
                                                  ]
                                                : []),
                                              ...Object.values(
                                                prePrevGroups,
                                              ).map((group) => ({
                                                type: "investor",
                                                name: group.round_name,
                                                label: `${group.items.length} investor${group.items.length > 1 ? "s" : ""}`,
                                                round_id_ref:
                                                  group.round_id_ref,
                                                share_class_type: "",
                                                shares: group.total_shares,
                                                shares_formatted: fmt(
                                                  group.total_shares,
                                                ),
                                                percentage: calculatePercentage(
                                                  group.total_shares,
                                                  preTotalShares,
                                                ),
                                                percentage_formatted:
                                                  calculatePercentage(
                                                    group.total_shares,
                                                    preTotalShares,
                                                  ).toFixed(2) + "%",
                                                value: group.total_value,
                                                value_formatted: money(
                                                  group.total_value,
                                                ),
                                                investor_details:
                                                  group.items.map((i) => ({
                                                    type: "investor",
                                                    name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                                    email: i.email,
                                                    phone: i.phone,
                                                    shares: i.shares,
                                                    shares_formatted: fmt(
                                                      i.shares,
                                                    ),
                                                    percentage:
                                                      calculatePercentage(
                                                        i.shares,
                                                        preTotalShares,
                                                      ),
                                                    percentage_formatted:
                                                      calculatePercentage(
                                                        i.shares,
                                                        preTotalShares,
                                                      ).toFixed(2) + "%",
                                                    value: parseFloat(
                                                      i.value || 0,
                                                    ),
                                                    value_formatted: money(
                                                      i.value,
                                                    ),
                                                    share_class_type:
                                                      i.share_class_type,
                                                    instrument_type:
                                                      i.instrument_type,
                                                    round_name: i.round_name,
                                                    round_id_ref:
                                                      i.round_id_ref,
                                                    share_class_type: "in",
                                                    investor_details:
                                                      parseDetails(
                                                        i.investor_details,
                                                      ),
                                                    is_previous: true,
                                                  })),
                                              })),
                                              ...(preConvInv.length > 0
                                                ? [
                                                    {
                                                      type: "investor",
                                                      name: "Converted Notes",
                                                      label: `${preConvInv.length} investor${preConvInv.length > 1 ? "s" : ""}`,
                                                      shares: preConvShares,
                                                      shares_formatted:
                                                        fmt(preConvShares),
                                                      percentage:
                                                        calculatePercentage(
                                                          preConvShares,
                                                          preTotalShares,
                                                        ),
                                                      percentage_formatted:
                                                        calculatePercentage(
                                                          preConvShares,
                                                          preTotalShares,
                                                        ).toFixed(2) + "%",
                                                      value: preConvValue,
                                                      value_formatted:
                                                        money(preConvValue),
                                                      items: preConvInv.map(
                                                        (i) => ({
                                                          type: "investor",
                                                          name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                                          shares: i.shares,
                                                          shares_formatted: fmt(
                                                            i.shares,
                                                          ),
                                                          percentage:
                                                            calculatePercentage(
                                                              i.shares,
                                                              preTotalShares,
                                                            ),
                                                          percentage_formatted:
                                                            calculatePercentage(
                                                              i.shares,
                                                              preTotalShares,
                                                            ).toFixed(2) + "%",
                                                          value: parseFloat(
                                                            i.value || 0,
                                                          ),
                                                          value_formatted:
                                                            money(i.value),
                                                          is_converted: true,
                                                          investor_details:
                                                            parseDetails(
                                                              i.investor_details,
                                                            ),
                                                        }),
                                                      ),
                                                    },
                                                  ]
                                                : []),
                                              // ✅ Add pre-money warrants
                                              ...Object.values(
                                                preWarrantGroups,
                                              ).map((group) => {
                                                const warrant = group.items[0];
                                                let displayName =
                                                  group.round_name;
                                                if (
                                                  warrant.first_name ||
                                                  warrant.last_name
                                                ) {
                                                  displayName =
                                                    `${warrant.first_name || ""} ${warrant.last_name || ""}`.trim();
                                                }
                                                return {
                                                  type: "investor",
                                                  name: displayName,
                                                  label: "1 warrant",
                                                  shares: group.total_shares,
                                                  new_shares:
                                                    group.total_shares,
                                                  existing_shares: 0,
                                                  total: group.total_shares,
                                                  shares_formatted: fmt(
                                                    group.total_shares,
                                                  ),
                                                  percentage:
                                                    calculatePercentage(
                                                      group.total_shares,
                                                      preTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      group.total_shares,
                                                      preTotalShares,
                                                    ).toFixed(2) + "%",
                                                  value: group.total_value,
                                                  value_formatted: money(
                                                    group.total_value,
                                                  ),
                                                  investor_type:
                                                    group.investor_type,
                                                  is_warrant: true,
                                                  is_new_investment: true,
                                                  warrant_id: group.warrant_id,
                                                  investor_details:
                                                    group.items.map((i) => ({
                                                      type: "investor",
                                                      investor_type:
                                                        i.investor_type,
                                                      name:
                                                        `${i.first_name || ""} ${i.last_name || ""}`.trim() ||
                                                        "Warrant Holder",
                                                      email: i.email || "",
                                                      phone: i.phone || "",
                                                      shares: i.shares,
                                                      shares_formatted: fmt(
                                                        i.shares,
                                                      ),
                                                      percentage:
                                                        calculatePercentage(
                                                          i.shares,
                                                          preTotalShares,
                                                        ),
                                                      percentage_formatted:
                                                        calculatePercentage(
                                                          i.shares,
                                                          preTotalShares,
                                                        ).toFixed(2) + "%",
                                                      value: parseFloat(
                                                        i.value || 0,
                                                      ),
                                                      value_formatted: money(
                                                        i.value,
                                                      ),
                                                      is_warrant: true,
                                                      warrant_id: i.warrant_id,
                                                      investment_amount:
                                                        parseFloat(
                                                          i.investment_amount ||
                                                            0,
                                                        ),
                                                      share_price: parseFloat(
                                                        i.share_price || 0,
                                                      ),
                                                    })),
                                                };
                                              }),
                                              ...prePendingItems,
                                            ],
                                            totals: {
                                              total_shares: preTotalShares,
                                              total_shares_formatted:
                                                fmt(preTotalShares),
                                              total_founders:
                                                preTotalFounderShares,
                                              total_option_pool: prePoolShares,
                                              total_investors:
                                                prePrevShares +
                                                preConvShares +
                                                preWarrantShares,
                                              total_value: preTotalValue,
                                              total_value_formatted:
                                                money(preTotalValue),
                                              total_percentage: "100.00%",
                                            },
                                          };

                                          // ========== POST-MONEY BUILD WITH WARRANT EXPIRY CHECK ==========

                                          // Get all investors first
                                          const postPrevInv = (
                                            postInvestors || []
                                          ).filter(
                                            (i) =>
                                              i.investor_type === "previous",
                                          );
                                          const postConvInv = (
                                            postInvestors || []
                                          ).filter(
                                            (i) =>
                                              i.investor_type === "converted",
                                          );
                                          const postCurrInv = (
                                            postInvestors || []
                                          ).filter(
                                            (i) =>
                                              i.investor_type === "current",
                                          );

                                          // ✅ Get warrants and check expiry by joining with warrants table
                                          const postWarrantInv = [];

                                          // We'll use a separate query to get warrants with expiry check
                                          const getWarrantsWithExpiryQuery = `
                                        SELECT ri.*, w.expiration_date 
                                        FROM round_investors ri
                                        LEFT JOIN warrants w ON w.id = ri.warrant_id
                                        WHERE ri.round_id = ? 
                                          AND ri.company_id = ? 
                                          AND ri.cap_table_type = 'post'
                                          AND ri.investor_type IN ('warrant', 'warrant not exercised')
                                          AND (w.expiration_date IS NULL OR w.expiration_date >= CURDATE())
                                      `;

                                          // Execute the query synchronously within the callback
                                          db.query(
                                            getWarrantsWithExpiryQuery,
                                            [round_id, company_id],
                                            (warrantErr, warrantResults) => {
                                              if (warrantErr) {
                                                console.error(
                                                  "Error fetching warrants with expiry:",
                                                  warrantErr,
                                                );
                                              }

                                              const validWarrants =
                                                warrantResults || [];

                                              // Now continue with the rest of the post-money build
                                              const postFounderItems = (
                                                postFounders || []
                                              ).map((f) => ({
                                                type: "founder",
                                                founder_code: f.founder_code,
                                                name: `${f.first_name || ""} ${f.last_name || ""}`.trim(),
                                                email: f.email,
                                                phone: f.phone,
                                                existing_shares: f.shares,
                                                new_shares: 0,
                                                shares: f.shares,
                                                total_shares: f.shares,
                                                shares_formatted: fmt(f.shares),
                                                value: parseFloat(f.value || 0),
                                                value_formatted: money(f.value),
                                                share_class_type:
                                                  f.share_class_type,
                                                instrument_type:
                                                  f.instrument_type,
                                                round_name: f.round_name,
                                              }));

                                              const postPool =
                                                (postOptionPools || [])[0] ||
                                                null;
                                              const postPoolExisting = postPool
                                                ? postPool.existing_shares || 0
                                                : 0;
                                              const postPoolNew = postPool
                                                ? postPool.new_shares || 0
                                                : 0;
                                              const postPoolTotal = postPool
                                                ? postPool.shares
                                                : 0;
                                              const postPoolValue = postPool
                                                ? parseFloat(
                                                    postPool.value || 0,
                                                  )
                                                : 0;

                                              const postPrevShares =
                                                postPrevInv.reduce(
                                                  (s, i) => s + i.shares,
                                                  0,
                                                );
                                              const postPrevValue =
                                                postPrevInv.reduce(
                                                  (s, i) =>
                                                    s +
                                                    parseFloat(i.value || 0),
                                                  0,
                                                );
                                              const postConvShares =
                                                postConvInv.reduce(
                                                  (s, i) => s + i.shares,
                                                  0,
                                                );
                                              const postConvValue =
                                                postConvInv.reduce(
                                                  (s, i) =>
                                                    s +
                                                    parseFloat(i.value || 0),
                                                  0,
                                                );
                                              const postCurrShares =
                                                postCurrInv.reduce(
                                                  (s, i) => s + i.shares,
                                                  0,
                                                );
                                              const postCurrValue =
                                                postCurrInv.reduce(
                                                  (s, i) =>
                                                    s +
                                                    parseFloat(i.value || 0),
                                                  0,
                                                );

                                              // ✅ Calculate warrant totals from valid warrants only
                                              const postWarrantShares =
                                                validWarrants.reduce(
                                                  (s, i) => s + i.shares,
                                                  0,
                                                );
                                              const postWarrantValue =
                                                validWarrants.reduce(
                                                  (s, i) =>
                                                    s +
                                                    parseFloat(i.value || 0),
                                                  0,
                                                );

                                              const postTotalFounderShares =
                                                postFounderItems.reduce(
                                                  (s, f) => s + f.shares,
                                                  0,
                                                );
                                              const postTotalFounderValue =
                                                postFounderItems.reduce(
                                                  (s, f) => s + f.value,
                                                  0,
                                                );

                                              const postTotalShares =
                                                postTotalFounderShares +
                                                postPoolTotal +
                                                postPrevShares +
                                                postConvShares +
                                                postCurrShares +
                                                postWarrantShares; // ✅ Add warrant shares

                                              const postTotalNewShares =
                                                postPoolNew +
                                                postConvShares +
                                                postCurrShares +
                                                postWarrantShares; // ✅ Add warrant shares to new shares

                                              const postTotalValue =
                                                postTotalFounderValue +
                                                postPoolValue +
                                                postPrevValue +
                                                postConvValue +
                                                postCurrValue +
                                                postWarrantValue; // ✅ Add warrant value

                                              const postPendingItems =
                                                groupPendingByRound(
                                                  (pendingInstruments || [])
                                                    .filter(
                                                      (p) =>
                                                        p.cap_table_type ===
                                                        "post",
                                                    )
                                                    .map(buildPendingItem),
                                                );

                                              // Previous investors group by round_name
                                              const postPrevGroups = {};
                                              postPrevInv.forEach((i) => {
                                                const key =
                                                  i.round_name ||
                                                  "Previous Investors";
                                                if (!postPrevGroups[key]) {
                                                  postPrevGroups[key] = {
                                                    round_name: key,
                                                    round_id_ref:
                                                      i.round_id_ref,
                                                    items: [],
                                                    total_shares: 0,
                                                    total_value: 0,
                                                  };
                                                }
                                                postPrevGroups[key].items.push(
                                                  i,
                                                );
                                                postPrevGroups[
                                                  key
                                                ].total_shares += i.shares;
                                                postPrevGroups[
                                                  key
                                                ].total_value += parseFloat(
                                                  i.value || 0,
                                                );
                                              });

                                              // Converted investors group by round_name
                                              const postConvGroups = {};
                                              postConvInv.forEach((i) => {
                                                const key =
                                                  i.round_name ||
                                                  "Converted Notes";
                                                if (!postConvGroups[key]) {
                                                  postConvGroups[key] = {
                                                    round_name: key,
                                                    round_id_ref:
                                                      i.round_id_ref,
                                                    items: [],
                                                    total_shares: 0,
                                                    total_value: 0,
                                                  };
                                                }
                                                postConvGroups[key].items.push(
                                                  i,
                                                );
                                                postConvGroups[
                                                  key
                                                ].total_shares += i.shares;
                                                postConvGroups[
                                                  key
                                                ].total_value += parseFloat(
                                                  i.value || 0,
                                                );
                                              });

                                              // Current (new) investors group by round_name
                                              const postCurrGroups = {};
                                              postCurrInv.forEach((i) => {
                                                const key =
                                                  i.round_name ||
                                                  "New Investors";
                                                if (!postCurrGroups[key]) {
                                                  postCurrGroups[key] = {
                                                    round_name: key,
                                                    round_id_ref:
                                                      i.round_id_ref,
                                                    items: [],
                                                    total_shares: 0,
                                                    total_new_shares: 0,
                                                    total_value: 0,
                                                  };
                                                }
                                                postCurrGroups[key].items.push(
                                                  i,
                                                );
                                                postCurrGroups[
                                                  key
                                                ].total_shares += i.shares;
                                                postCurrGroups[
                                                  key
                                                ].total_new_shares +=
                                                  i.new_shares || i.shares;
                                                postCurrGroups[
                                                  key
                                                ].total_value += parseFloat(
                                                  i.value || 0,
                                                );
                                              });

                                              // ✅ Warrants group by round_name (from valid warrants only)
                                              const postWarrantGroups = {};
                                              validWarrants.forEach((i) => {
                                                // Use warrant_id as the unique grouping key
                                                const key = i.warrant_id
                                                  ? i.warrant_id.toString()
                                                  : `${i.round_name}_${i.investor_type}_${Math.random()}`;

                                                if (!postWarrantGroups[key]) {
                                                  postWarrantGroups[key] = {
                                                    warrant_id: i.warrant_id,
                                                    round_name:
                                                      i.round_name || "Warrant",
                                                    round_id_ref:
                                                      i.round_id_ref,
                                                    items: [],
                                                    total_shares: 0,
                                                    total_value: 0,
                                                    investor_type:
                                                      i.investor_type,
                                                  };
                                                }
                                                postWarrantGroups[
                                                  key
                                                ].items.push(i);
                                                postWarrantGroups[
                                                  key
                                                ].total_shares += i.shares;
                                                postWarrantGroups[
                                                  key
                                                ].total_value += parseFloat(
                                                  i.value || 0,
                                                );
                                              });

                                              // Helper: group → item

                                              const buildGroupItem = (
                                                group,
                                                investorType,
                                                totalShares,
                                              ) => ({
                                                type: "investor",
                                                investor_type: investorType, // ✅ This will be 'warrant' or 'warrant not exercised'
                                                name: group.round_name,
                                                label: `${group.items.length} investor${group.items.length > 1 ? "s" : ""}`,
                                                round_id_ref:
                                                  group.round_id_ref,
                                                share_class_type:
                                                  group.share_class_type,
                                                shares: group.total_shares,
                                                existing_shares:
                                                  investorType === "current" ||
                                                  investorType ===
                                                    "converted" ||
                                                  investorType === "warrant" ||
                                                  investorType ===
                                                    "warrant not exercised" // ✅ Add this
                                                    ? 0
                                                    : group.total_shares,
                                                new_shares:
                                                  investorType === "current" ||
                                                  investorType ===
                                                    "converted" ||
                                                  investorType === "warrant" ||
                                                  investorType ===
                                                    "warrant not exercised" // ✅ Add this
                                                    ? group.total_shares
                                                    : 0,
                                                total_shares:
                                                  group.total_shares,
                                                shares_formatted: fmt(
                                                  group.total_shares,
                                                ),
                                                percentage: calculatePercentage(
                                                  group.total_shares,
                                                  totalShares,
                                                ),
                                                percentage_formatted:
                                                  calculatePercentage(
                                                    group.total_shares,
                                                    totalShares,
                                                  ).toFixed(2) + "%",
                                                value: group.total_value,
                                                value_formatted: money(
                                                  group.total_value,
                                                ),
                                                is_previous:
                                                  investorType === "previous",
                                                is_new_investment:
                                                  investorType === "current",
                                                is_converted:
                                                  investorType === "converted",
                                                is_warrant:
                                                  investorType === "warrant" ||
                                                  investorType ===
                                                    "warrant not exercised", // ✅ Update this line
                                                investor_details:
                                                  group.items.map((i) => ({
                                                    type: "investor",
                                                    investor_type: investorType, // ✅ This will be 'warrant' or 'warrant not exercised'
                                                    name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                                    email: i.email,
                                                    phone: i.phone,
                                                    shares: i.shares,
                                                    existing_shares:
                                                      investorType ===
                                                        "current" ||
                                                      investorType ===
                                                        "converted" ||
                                                      investorType ===
                                                        "warrant" ||
                                                      investorType ===
                                                        "warrant not exercised" // ✅ Add this
                                                        ? 0
                                                        : i.shares,
                                                    new_shares:
                                                      investorType ===
                                                        "current" ||
                                                      investorType ===
                                                        "converted" ||
                                                      investorType ===
                                                        "warrant" ||
                                                      investorType ===
                                                        "warrant not exercised" // ✅ Add this
                                                        ? i.new_shares ||
                                                          i.shares
                                                        : 0,
                                                    shares_formatted: fmt(
                                                      i.shares,
                                                    ),
                                                    percentage:
                                                      calculatePercentage(
                                                        i.shares,
                                                        totalShares,
                                                      ),
                                                    percentage_formatted:
                                                      calculatePercentage(
                                                        i.shares,
                                                        totalShares,
                                                      ).toFixed(2) + "%",
                                                    value: parseFloat(
                                                      i.value || 0,
                                                    ),
                                                    value_formatted: money(
                                                      i.value,
                                                    ),
                                                    investment_amount:
                                                      parseFloat(
                                                        i.investment_amount ||
                                                          0,
                                                      ),
                                                    share_price: parseFloat(
                                                      i.share_price || 0,
                                                    ),
                                                    share_class_type:
                                                      i.share_class_type,
                                                    instrument_type:
                                                      i.instrument_type,
                                                    round_name: i.round_name,
                                                    round_id_ref:
                                                      i.round_id_ref,
                                                    share_class_type:
                                                      i.share_class_type,
                                                    is_previous:
                                                      investorType ===
                                                      "previous",
                                                    is_new_investment:
                                                      investorType ===
                                                      "current",
                                                    is_converted:
                                                      investorType ===
                                                      "converted",
                                                    is_warrant:
                                                      investorType ===
                                                        "warrant" ||
                                                      investorType ===
                                                        "warrant not exercised", // ✅ Update this line
                                                    investor_details:
                                                      parseDetails(
                                                        i.investor_details,
                                                      ),
                                                    potential_shares:
                                                      parseInt(
                                                        i.potential_shares,
                                                      ) || 0,
                                                    conversion_price:
                                                      parseFloat(
                                                        i.conversion_price,
                                                      ) || 0,
                                                    discount_rate:
                                                      parseFloat(
                                                        i.discount_rate,
                                                      ) || 0,
                                                    valuation_cap:
                                                      parseFloat(
                                                        i.valuation_cap,
                                                      ) || 0,
                                                    interest_rate:
                                                      parseFloat(
                                                        i.interest_rate,
                                                      ) || 0,
                                                    years:
                                                      parseFloat(i.years) || 0,
                                                    interest_accrued:
                                                      parseFloat(
                                                        i.interest_accrued,
                                                      ) || 0,
                                                    total_conversion_amount:
                                                      parseFloat(
                                                        i.total_conversion_amount,
                                                      ) ||
                                                      parseFloat(
                                                        i.investment_amount,
                                                      ) ||
                                                      0,
                                                    maturity_date:
                                                      i.maturity_date || null,
                                                    warrant_id: i.warrant_id,
                                                  })),
                                              });

                                              // ========== POST-MONEY CAP TABLE WITH WARRANTS ==========
                                              const postMoneyCapTable = {
                                                total_shares: postTotalShares,
                                                post_money_valuation:
                                                  postMoneyVal,
                                                currency,
                                                items: [
                                                  ...postFounderItems.map(
                                                    (item) => ({
                                                      ...item,
                                                      percentage:
                                                        calculatePercentage(
                                                          item.shares,
                                                          postTotalShares,
                                                        ),
                                                      percentage_formatted:
                                                        calculatePercentage(
                                                          item.shares,
                                                          postTotalShares,
                                                        ).toFixed(2) + "%",
                                                    }),
                                                  ),
                                                  ...(postPool
                                                    ? [
                                                        {
                                                          type: "option_pool",
                                                          name: "Employee Option Pool",
                                                          label: "Options Pool",
                                                          existing_shares:
                                                            postPoolExisting,
                                                          new_shares:
                                                            postPoolNew,
                                                          shares: postPoolTotal,
                                                          total_shares:
                                                            postPoolTotal,
                                                          shares_formatted:
                                                            fmt(postPoolTotal),
                                                          percentage:
                                                            calculatePercentage(
                                                              postPoolTotal,
                                                              postTotalShares,
                                                            ),
                                                          percentage_formatted:
                                                            calculatePercentage(
                                                              postPoolTotal,
                                                              postTotalShares,
                                                            ).toFixed(2) + "%",
                                                          value: postPoolValue,
                                                          value_formatted:
                                                            money(
                                                              postPoolValue,
                                                            ),
                                                          is_option_pool: true,
                                                          instrument_type:
                                                            postPool.instrument_type ||
                                                            "Options",
                                                        },
                                                      ]
                                                    : []),
                                                  ...Object.values(
                                                    postPrevGroups,
                                                  ).map((g) =>
                                                    buildGroupItem(
                                                      g,
                                                      "previous",
                                                      postTotalShares,
                                                    ),
                                                  ),
                                                  ...Object.values(
                                                    postConvGroups,
                                                  ).map((g) =>
                                                    buildGroupItem(
                                                      g,
                                                      "converted",
                                                      postTotalShares,
                                                    ),
                                                  ),
                                                  ...Object.values(
                                                    postCurrGroups,
                                                  ).map((g) =>
                                                    buildGroupItem(
                                                      g,
                                                      "current",
                                                      postTotalShares,
                                                    ),
                                                  ),
                                                  // ✅ Add warrant groups
                                                  ...Object.values(
                                                    postWarrantGroups,
                                                  ).map((g) =>
                                                    buildGroupItem(
                                                      g,
                                                      g.investor_type,
                                                      postTotalShares,
                                                    ),
                                                  ),
                                                  ...postPendingItems.map(
                                                    (item) => ({
                                                      ...item,
                                                      percentage:
                                                        calculatePercentage(
                                                          item.total_potential_shares ||
                                                            0,
                                                          postTotalShares,
                                                        ),
                                                      percentage_formatted:
                                                        calculatePercentage(
                                                          item.total_potential_shares ||
                                                            0,
                                                          postTotalShares,
                                                        ).toFixed(2) + "%",
                                                    }),
                                                  ),
                                                ],
                                                totals: {
                                                  total_shares: postTotalShares,
                                                  total_shares_formatted:
                                                    fmt(postTotalShares),
                                                  total_new_shares:
                                                    postTotalNewShares,
                                                  total_new_shares_formatted:
                                                    fmt(postTotalNewShares),
                                                  total_founders:
                                                    postTotalFounderShares,
                                                  total_option_pool:
                                                    postPoolTotal,
                                                  total_investors:
                                                    postPrevShares +
                                                    postConvShares +
                                                    postCurrShares +
                                                    postWarrantShares,
                                                  total_value: postTotalValue,
                                                  total_value_formatted:
                                                    money(postTotalValue),
                                                  total_percentage: "100.00%",
                                                },
                                              };

                                              // ========== FINAL RESPONSE ==========
                                              return res.status(200).json({
                                                success: true,
                                                round: {
                                                  id: currentRound.id,
                                                  name: currentRound.nameOfRound,
                                                  shareClassType:
                                                    currentRound.shareClassType,
                                                  incorporation_date:
                                                    currentRound.year_registration,
                                                  type: currentRound.round_type,
                                                  instrument:
                                                    currentRound.instrumentType,
                                                  status:
                                                    currentRound.roundStatus,
                                                  date: currentRound.created_at,
                                                  pre_money:
                                                    currentRound.pre_money,
                                                  post_money:
                                                    currentRound.post_money,
                                                  investment:
                                                    currentRound.roundsize,
                                                  currency:
                                                    currentRound.currency,
                                                  share_price:
                                                    currentRound.share_price,
                                                  round_target_money:
                                                    currentRound.round_target_money,
                                                  issued_shares:
                                                    currentRound.issuedshares,
                                                  option_pool_percent:
                                                    currentRound.optionPoolPercent,
                                                  option_pool_percent_post:
                                                    currentRound.optionPoolPercent_post,
                                                  instrument_type_data:
                                                    currentRound.instrument_type_data,
                                                  investor_post_money:
                                                    currentRound.investorPostMoney,
                                                },
                                                cap_table: {
                                                  pre_money: preMoneyCapTable,
                                                  post_money: postMoneyCapTable,
                                                },
                                                calculations: {
                                                  pre_money_valuation:
                                                    preMoneyVal,
                                                  post_money_valuation:
                                                    postMoneyVal,
                                                  total_shares_outstanding:
                                                    postTotalShares,
                                                  fully_diluted_shares:
                                                    postTotalShares,
                                                  share_price:
                                                    parseFloat(
                                                      currentRound.share_price,
                                                    ) || 0,
                                                  total_new_shares:
                                                    postTotalNewShares,
                                                  total_investors:
                                                    postPrevShares +
                                                    postConvShares +
                                                    postCurrShares +
                                                    postWarrantShares,
                                                },
                                              });
                                            },
                                          );
                                        },
                                      );
                                    },
                                  );
                                },
                              );
                            },
                          );
                        },
                      );
                    },
                  );
                },
              );
            },
          );
        },
      );
    }
  });
};

function calculateRound0CapTable(round) {
  if (round.round_type !== "Round 0") return null;

  const capTable = [];
  let totalShares = 0;
  let totalValue = 0;
  const sharePrice = parseFloat(round.share_price) || 0.0;
  const currency = round.currency || "USD";

  // Parse founder_data if it exists
  let founderData = null;

  if (round.founder_data) {
    try {
      if (typeof round.founder_data === "string") {
        founderData = JSON.parse(round.founder_data);
      } else if (typeof round.founder_data === "object") {
        founderData = round.founder_data;
      }
    } catch (error) {
      console.error("Error parsing founder_data in Round 0:", error);
      founderData = null;
    }
  }

  if (
    founderData &&
    founderData.founders &&
    Array.isArray(founderData.founders)
  ) {
    // Process founders from JSON data
    founderData.founders.forEach((founder, idx) => {
      const shares = parseFloat(founder.shares);
      const value = shares * sharePrice;

      // Get founder name
      let founderName = "";

      if (founder.firstName && founder.lastName) {
        founderName = `${founder.firstName} ${founder.lastName}`;
      } else if (founder.firstName) {
        founderName = founder.firstName;
      } else if (founder.lastName) {
        founderName = founder.lastName;
      } else {
        founderName = `F${idx + 1}`;
      }

      const founderCode = `F${idx + 1}`;

      capTable.push({
        type: "founder",
        name: founderName,
        shares: shares,
        percentage: 0,
        round_id: round.id,
        round_name: round.nameOfRound || "Round 0",
        investment: 0,
        share_price: sharePrice,
        value: value,
        founder_id: idx + 1,
        founder_code: founderCode,
        email: founder.email || "",
        phone: founder.phone || "",
        share_type: founder.shareType || "common",
        voting: founder.voting || "voting",
      });

      totalShares += shares;
      totalValue += value;
    });
  } else {
    // Fallback if no founder data found
    const totalFounderShares = parseFloat(round.total_founder_shares) || 100000;
    const defaultShares = Math.floor(totalFounderShares / 3);
    const remaining = totalFounderShares - defaultShares * 2;

    const founders = [
      { name: "F1", shares: defaultShares },
      { name: "F2", shares: defaultShares },
      { name: "F3", shares: remaining },
    ];

    founders.forEach((founder, idx) => {
      const shares = founder.shares;
      const value = shares * sharePrice;

      capTable.push({
        type: "founder",
        name: founder.name,
        shares: shares,
        percentage: 0,
        round_id: round.id,
        round_name: round.nameOfRound || "Round 0",
        investment: 0,
        share_price: sharePrice,
        value: value,
        founder_id: idx + 1,
        founder_code: founder.name,
      });

      totalShares += shares;
      totalValue += value;
    });
  }

  // Calculate percentages
  if (totalShares > 0) {
    capTable.forEach((item) => {
      item.percentage = ((item.shares / totalShares) * 100).toFixed(2);
    });
  }

  // Calculate chart data for Round 0
  const chartData = {
    labels: capTable.map((item) => item.founder_code || item.name),
    datasets: [
      {
        data: capTable.map((item) => item.shares),
        backgroundColor: [
          "#FF6384",
          "#36A2EB",
          "#FFCE56",
          "#4BC0C0",
          "#9966FF",
          "#FF9F40",
          "#8AC926",
          "#1982C4",
        ],
        borderWidth: 1,
      },
    ],
  };

  const totals = {
    total_shares: totalShares,
    total_founders: totalShares,
    total_investors: 0,
    total_option_pool: 0,
    total_value: totalValue,
  };

  return {
    items: capTable,
    totals: totals,
    chart_data: chartData, // Add chart data
  };
}
