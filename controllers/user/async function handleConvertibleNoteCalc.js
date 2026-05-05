async function handleConvertibleNoteCalculation(params) {
  const {
    id,
    company_id,
    preMoney,
    roundSize,
    optionPoolPercentValue,
    total_shares_before,
    instrumentData,
    isUpdate,
    currentRound,
    round_investments,
  } = params;

  // ==================== PARSE INSTRUMENT DATA ====================
  let parsedInstrumentData = {};
  if (instrumentData) {
    if (typeof instrumentData === "string") {
      try {
        parsedInstrumentData = JSON.parse(instrumentData);
      } catch (e) {
        console.error("Error parsing instrumentData:", e);
      }
    } else if (typeof instrumentData === "object") {
      parsedInstrumentData = instrumentData;
    }
  }
  let effectiveRoundId = id;
  let effectiveRoundName =
    currentRound?.nameOfRound || "Convertible Note Round";
  let effectiveShareClassType =
    currentRound?.shareClassType || "Convertible Note";

  if (!currentRound || !currentRound.id) {
    console.warn("⚠️ currentRound.id is missing, using id from params:", id);
    effectiveRoundId = id;
  } else {
    effectiveRoundId = currentRound.id;
  }
  // ==================== EXTRACT CONVERTIBLE NOTE TERMS ====================
  const discountRate = parseFloat(parsedInstrumentData.discountRate_note) || 0;
  const valuationCap = parseFloat(parsedInstrumentData.valuationCap_note) || 0;
  const interestRate = parseFloat(parsedInstrumentData.interestRate_note) || 0;
  const maturityDate =
    parsedInstrumentData.maturityDate_note ||
    parsedInstrumentData.maturityDate ||
    "";

  // ==================== CALCULATE YEARS ====================
  let years = 0;
  if (maturityDate) {
    const issueDate = new Date();
    const maturity = new Date(maturityDate);
    const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
    years = Math.max(0, (maturity - issueDate) / msPerYear);
  } else {
    years =
      parseFloat(
        parsedInstrumentData.years_to_conversion ||
          parsedInstrumentData.yearsToConversion ||
          parsedInstrumentData.years,
      ) || 1;
  }

  // ==================== VALIDATE INPUTS ====================
  const preMoneyVal = parseFloat(preMoney) || 0;
  const roundSizeVal = parseFloat(roundSize) || 0;
  const optionPoolPercent = parseFloat(optionPoolPercentValue) || 0;
  const round0Shares = parseInt(total_shares_before) || 0;

  // ==================== PARSE INVESTORS LIST ====================
  let investorsList = [];
  try {
    if (round_investments) {
      investorsList =
        typeof round_investments === "string"
          ? JSON.parse(round_investments)
          : round_investments;
    }
  } catch (e) {
    console.error("Error parsing round_investments:", e);
  }

  // ==================== GET FOUNDER DATA ====================
  let founderList = [];
  let round0Name = "Round 0";
  let round0Shareclassstype = "";
  let round0 = null;
  let founderData = null;
  let totalFounderShares = 0;

  try {
    const round0Data = await getFounderDataFromRound0(company_id);
    if (round0Data && round0Data.founder_data) {
      founderData = round0Data.founder_data;
      totalFounderShares = round0Data.total_founder_shares || 0;
      round0Name = round0Data.round0Name || "Round 0";
      round0Shareclassstype = round0Data.shareClassType || "";
      round0 = round0Data;

      if (founderData.founders && Array.isArray(founderData.founders)) {
        founderList = founderData.founders.map((founder, index) => ({
          name:
            `${founder.firstName || ""} ${founder.lastName || ""}`.trim() ||
            `Founder ${index + 1}`,
          shares: parseFloat(founder.shares) || 0,
          email: founder.email || "",
          phone: founder.phone || "",
          voting: founder.voting || "voting",
          share_type: founder.shareType || "common",
          founder_code: `F${index + 1}`,
          shareClassType:
            founder.shareClassType || round0Data.shareClassType || "",
          instrumentType:
            founder.instrumentType || round0Data.instrumentType || "",
          roundName: round0Data.nameOfRound || "Round 0",
          roundId: round0Data.id || null,
          round_id: round0Data.id || null,
          investment: founder.investment || 0,
          share_price: founder.share_price || 0,
          original_founder_data: founder,
        }));
      }
    }
  } catch (error) {
    console.error("❌ Error fetching founder data:", error);
  }

  // ==================== GET PREVIOUS ROUNDS ====================
  const previousRounds = await getPreviousRoundsForCompany(company_id, id);
  const sortedPreviousRounds = [...previousRounds].sort((a, b) => b.id - a.id);
  const latestPreviousRound = sortedPreviousRounds[0];

  // ==================== GET PREVIOUS INVESTORS ====================
  let existingOptionPoolShares = 0;
  let totalPreMoneyShares = round0Shares;
  let previousInvestorsList = [];
  let previousInvestorsTotalShares = 0;
  let previousWarrantsList = [];
  let previousWarrantsTotalShares = 0;

  // ==================== GET CURRENT ROUND WARRANTS ====================
  let currentRoundWarrantsList = [];
  let currentRoundWarrantsTotalShares = 0;

  try {
    const currentRoundWarrants = await new Promise((resolve, reject) => {
      db.query(
        `SELECT w.* 
       FROM warrants w
       WHERE w.roundrecord_id = ? AND w.company_id = ?`,
        [id, company_id],
        (err, results) => {
          if (err) reject(err);
          else resolve(results || []);
        },
      );
    });

    // Parse investors list for names
    let roundInvestorsList = [];
    try {
      if (round_investments) {
        roundInvestorsList =
          typeof round_investments === "string"
            ? JSON.parse(round_investments)
            : round_investments;
      }
    } catch (e) {
      console.error("Error parsing round_investments:", e);
    }

    currentRoundWarrants.forEach((warrant, index) => {
      let investorName = "Warrant Holder";
      let investorEmail = "";
      let investorPhone = "";
      let investorFirstName = "";
      let investorLastName = "";

      // Try to get from round_investments first
      if (roundInvestorsList && roundInvestorsList.length > 0) {
        const investor = roundInvestorsList[0];
        investorFirstName = "Warrant Holder";
        investorLastName = "";
        investorName = "Warrant Holder";
        investorEmail = "";
        investorPhone = "";
      }

      // If still empty, use warrant table data (if stored)
      if (!investorName || investorName === "Warrant Holder") {
        // Check if warrant table has investor details stored
        investorFirstName = "";
        investorLastName = "";
        investorName = "Warrant Holder";
        investorEmail = "";
        investorPhone = "";
      }

      currentRoundWarrantsList.push({
        type: "warrant",
        name: investorName,
        investor_details: {
          firstName: investorFirstName,
          lastName: investorLastName,
          email: investorEmail,
          phone: investorPhone,
        },
        shares: warrant.shares || 0,
        investor_type: "warrant not exercised",
        investment: 0,
        share_price: 0,
        share_class_type: null,
        instrument_type: null,
        round_name: currentRound?.nameOfRound || "",
        round_id: id,
        warrant_id: warrant.id,
        is_previous: false,
      });
    });

    currentRoundWarrantsTotalShares = currentRoundWarrantsList.reduce(
      (sum, warrant) => sum + (warrant.shares || 0),
      0,
    );
  } catch (error) {
    console.error("❌ Error fetching current round warrants:", error);
  }

  if (latestPreviousRound) {
    const round = latestPreviousRound;
    existingOptionPoolShares =
      parseInt(round.total_option_pool) ||
      parseInt(round.option_pool_shares) ||
      0;
    totalPreMoneyShares = parseInt(round.total_shares_after) || round0Shares;

    const allPreviousInvestorRounds = previousRounds.filter(
      (r) =>
        r.instrumentType === "Preferred Equity" ||
        r.instrumentType === "Common Stock" ||
        r.instrumentType === "Safe" ||
        r.instrumentType === "Convertible Note",
    );

    for (const prevRound of allPreviousInvestorRounds) {
      const roundInvestors = await new Promise((resolve, reject) => {
        db.query(
          `SELECT * FROM round_investors 
           WHERE round_id = ? AND company_id = ? AND cap_table_type = 'post' 
           AND (investor_type = 'current' OR investor_type = 'converted' or investor_type = 'previous' or investor_type = 'warrant' or investor_type = 'warrant not exercised')
           ORDER BY id ASC`,
          [prevRound.id, company_id],
          (err, results) => {
            if (err) reject(err);
            else resolve(results || []);
          },
        );
      });

      roundInvestors.forEach((inv) => {
        if (
          inv.investor_type === "warrant" ||
          inv.investor_type === "warrant not exercised"
        ) {
          previousWarrantsList.push({
            type: "warrant",
            name: `${inv.first_name || ""} ${inv.last_name || ""}`.trim(),
            investor_details: {
              firstName: inv.first_name || "",
              lastName: inv.last_name || "",
              email: inv.email || "",
              phone: inv.phone || "",
            },
            shares: inv.shares,
            investor_type: inv.investor_type,
            investment: parseFloat(inv.investment_amount || 0),
            share_price: parseFloat(inv.share_price || 0),
            share_class_type: inv.share_class_type,
            instrument_type: inv.instrument_type,
            round_name: inv.round_name,
            round_id: prevRound.id,
            warrant_id: inv.warrant_id,
            round_id_ref: inv.round_id_ref,
            is_previous: true,
          });
        } else {
          previousInvestorsList.push({
            type: "investor",
            name: `${inv.first_name || ""} ${inv.last_name || ""}`.trim(),
            investor_details: {
              firstName: inv.first_name || "",
              lastName: inv.last_name || "",
              email: inv.email || "",
              phone: inv.phone || "",
            },
            shares: inv.shares,
            investor_type: inv.investor_type,
            investment: parseFloat(inv.investment_amount || 0),
            share_price: parseFloat(inv.share_price || 0),
            share_class_type: inv.share_class_type,
            instrument_type: inv.instrument_type,
            round_name: inv.round_name,
            round_id: prevRound.id,
            is_previous: true,
            warrant_id: inv.warrant_id,
            round_id_ref: inv.round_id_ref,
          });
        }
      });
    }

    previousInvestorsTotalShares = previousInvestorsList.reduce(
      (sum, inv) => sum + (inv.shares || 0),
      0,
    );
    previousWarrantsTotalShares = previousWarrantsList.reduce(
      (sum, warrant) => sum + (warrant.shares || 0),
      0,
    );
  }

  // ==================== CHECK IF FIRST INVESTMENT ROUND ====================
  const isFirstInvestmentRound =
    !latestPreviousRound || latestPreviousRound?.round_type === "Round 0";

  // ==================== STEP 1: PRE-MONEY TOTAL SHARES ====================
  let preMoneyTotalShares;
  let optionPoolShares;

  if (isFirstInvestmentRound) {
    optionPoolShares = Math.round(
      (round0Shares / (1 - optionPoolPercent / 100)) *
        (optionPoolPercent / 100),
    );
    preMoneyTotalShares =
      round0Shares + optionPoolShares + previousWarrantsTotalShares;
  } else {
    optionPoolShares = 0;
    preMoneyTotalShares = totalPreMoneyShares + previousWarrantsTotalShares;
  }

  // ==================== STEP 2: SHARE PRICE ====================
  const sharePrice = preMoneyVal / preMoneyTotalShares;

  // ==================== STEP 3: CONVERSION PRICE ====================
  const discountedPrice = sharePrice * (1 - discountRate / 100);
  const capPrice = valuationCap > 0 ? valuationCap / preMoneyTotalShares : "";
  const conversionPrice = Math.min(discountedPrice, capPrice);

  // ==================== STEP 4: POST-MONEY ====================
  const postMoneyValuation = preMoneyVal;
  const postMoneyTotalShares =
    preMoneyTotalShares + currentRoundWarrantsTotalShares;

  const totalOptionPoolShares =
    existingOptionPoolShares + (isFirstInvestmentRound ? optionPoolShares : 0);
  const newOptionPoolShares = isFirstInvestmentRound ? optionPoolShares : 0;

  const investorPostMoneyOwnership = (roundSizeVal / postMoneyValuation) * 100;

  // ==================== STEP 5: PER INVESTOR PENDING INSTRUMENTS ====================
  const pendingInstruments = investorsList.map((inv, index) => {
    const principal = parseFloat(inv.amount) || roundSizeVal;

    const totalConversionAmount =
      principal * Math.pow(1 + interestRate / 100, years);
    const interestAccrued = totalConversionAmount - principal;

    const potentialShares =
      conversionPrice > 0
        ? Math.round(totalConversionAmount / conversionPrice)
        : 0;

    return {
      type: "pending",
      name:
        `${inv.firstName || ""} ${inv.lastName || ""}`.trim() ||
        inv.name ||
        `Convertible Note Investor ${index + 1}`,
      instrument_type: "Convertible Note",
      shares: 0,
      new_shares: 0,
      existing_shares: 0,
      total: 0,
      principal,
      shareClassType: effectiveShareClassType,
      round_name: effectiveRoundName,
      round_name: currentRound?.nameOfRound || "",
      roundId: effectiveRoundId, // ✅ FIXED: Using effectiveRoundId
      interest_rate: interestRate,
      years: parseFloat(years.toFixed(2)),
      interest_accrued: parseFloat(interestAccrued.toFixed(2)),
      total_conversion_amount: parseFloat(totalConversionAmount.toFixed(2)),
      potential_shares: potentialShares,
      conversion_price: conversionPrice,
      discount_rate: discountRate,
      valuation_cap: valuationCap,
      maturity_date: maturityDate,
      investment: principal,
      investment_amount: principal,
      percentage: 0,
      percentage_formatted: "0.00%",
      value: 0,
      value_formatted: "0.00",
      is_pending: true,
      round_id: id, // ✅ FIXED: Use the round id from params
      round_id_ref: effectiveRoundId, // ✅ FIXED
      investor_details: {
        firstName: inv.firstName || "",
        lastName: inv.lastName || "",
        email: inv.email || "",
        phone: inv.phone || "",
      },
      email: inv.email || "",
      phone: inv.phone || "",
    };
  });

  if (pendingInstruments.length === 0) {
    const principal = roundSizeVal;
    const interestAccrued = principal * (interestRate / 100) * years;
    const totalConversionAmount = principal + interestAccrued;
    const potentialShares =
      conversionPrice > 0
        ? Math.round(totalConversionAmount / conversionPrice)
        : 0;

    pendingInstruments.push({
      type: "pending",
      name: currentRound?.nameOfRound || "Convertible Note Investor",
      instrument_type: "Convertible Note",
      shares: 0,
      new_shares: 0,
      existing_shares: 0,
      total: 0,
      principal,
      interest_rate: interestRate,
      years: parseFloat(years.toFixed(2)),
      interest_accrued: parseFloat(interestAccrued.toFixed(2)),
      total_conversion_amount: parseFloat(totalConversionAmount.toFixed(2)),
      potential_shares: potentialShares,
      conversion_price: conversionPrice,
      discount_rate: discountRate,
      valuation_cap: valuationCap,
      maturity_date: maturityDate,
      investment: principal,
      investment_amount: principal,
      percentage: 0,
      percentage_formatted: "0.00%",
      value: 0,
      value_formatted: "0.00",
      is_pending: true,
      round_id: id,
      shareClassType: "",
      round_name: effectiveRoundName,
      roundId: effectiveRoundId, // ✅ FIXED
      round_id_ref: effectiveRoundId, // ✅ FIXED
      investor_details: {
        firstName: "",
        lastName: "",
        email: "",
        phone: "",
      },
    });
  }

  const conversionShares = pendingInstruments.reduce(
    (sum, inv) => sum + (inv.potential_shares || 0),
    0,
  );

  // ==================== GET ALL PREVIOUS PENDING SAFEs / NOTES ====================
  let previousPendingSafes = [];

  const allPreviousPendingRounds = [...previousRounds]
    .filter(
      (r) =>
        r.instrumentType === "Safe" || r.instrumentType === "Convertible Note",
    )
    .sort((a, b) => a.id - b.id);

  if (
    latestPreviousRound &&
    (latestPreviousRound.instrumentType === "Convertible Note" ||
      latestPreviousRound.instrumentType === "Safe")
  ) {
    try {
      const pendingRows = await new Promise((resolve, reject) => {
        db.query(
          `SELECT ri.*,
                r.nameOfRound    AS round_name_ref,
                r.instrumentType AS round_instrument_type,
                r.shareClassType AS round_share_class_type
         FROM round_investors ri
         LEFT JOIN roundrecord r ON r.id = ri.round_id
         WHERE ri.company_id     = ?
           AND ri.round_id       = ?
           AND ri.investor_type  = 'pending'
           AND ri.is_pending     = 1
           AND ri.cap_table_type = 'post'
         ORDER BY ri.id ASC`,
          [company_id, latestPreviousRound.id],
          (err, results) => {
            if (err) reject(err);
            else resolve(results || []);
          },
        );
      });

      pendingRows.forEach((row) => {
        const inv =
          typeof row.investor_details === "string"
            ? JSON.parse(row.investor_details || "{}")
            : row.investor_details || {};

        previousPendingSafes.push({
          type: "pending",
          name:
            `${row.first_name || ""} ${row.last_name || ""}`.trim() ||
            inv.firstName ||
            "Pending Investor",
          instrument_type:
            row.instrument_type || latestPreviousRound.instrumentType,
          shares: 0,
          new_shares: 0,
          existing_shares: 0,
          total: 0,
          potential_shares: parseInt(row.potential_shares) || 0,
          investment: parseFloat(row.investment_amount) || 0,
          investment_amount: parseFloat(row.investment_amount) || 0,
          principal: parseFloat(row.investment_amount) || 0,
          interest_accrued: parseFloat(row.interest_accrued) || 0,
          total_conversion_amount:
            parseFloat(row.total_conversion_amount) ||
            parseFloat(row.investment_amount) ||
            0,
          conversion_price: parseFloat(row.conversion_price) || 0,
          discount_rate: parseFloat(row.discount_rate) || 0,
          valuation_cap: parseFloat(row.valuation_cap) || 0,
          interest_rate: parseFloat(row.interest_rate) || 0,
          years: parseFloat(row.years) || 0,
          maturity_date: row.maturity_date || "",
          percentage: 0,
          percentage_formatted: "0.00%",
          value: 0,
          value_formatted: "0.00",
          is_pending: true,
          is_converted: false,
          shareClassType:
            row.round_share_class_type ||
            row.share_class_type ||
            row.instrument_type ||
            latestPreviousRound.instrumentType ||
            "",
          instrument_type:
            row.instrument_type || latestPreviousRound.instrumentType || "",
          round_id: row.round_id,
          round_id_ref: row?.round_id_ref,
          round_name:
            row.round_name_ref || latestPreviousRound.nameOfRound || "",
          pending_instrument_id: row.id,

          roundId: row.round_id,
          investor_details: {
            firstName: row.first_name || inv.firstName || "",
            lastName: row.last_name || inv.lastName || "",
            email: row.email || inv.email || "",
            phone: row.phone || inv.phone || "",
          },
          email: row.email || inv.email || "",
          phone: row.phone || inv.phone || "",
        });
      });
    } catch (error) {
      console.error("❌ Error fetching pending instruments:", error);
      previousPendingSafes = [];
    }
  }

  const allPendingInstruments = [
    ...previousPendingSafes,
    ...pendingInstruments,
  ];

  const currency = currentRound?.currency || "";

  // ==================== HELPER FUNCTIONS ====================
  const buildFounderItem = (f, totalShares, valuation, cur) => {
    const ownership = f.shares / totalShares;
    const rawPercentage = ownership * 100;
    return {
      type: "founder",
      name: f.name,
      shares: f.shares,
      new_shares: 0,
      existing_shares: f.shares,
      total: f.shares,
      email: f.email,
      phone: f.phone,
      founder_code: f.founder_code,
      percentage: rawPercentage.toFixed(2) + "%",
      percentage_formatted: rawPercentage.toFixed(2) + "%",
      value: parseFloat(((rawPercentage * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((rawPercentage * valuation) / 100).toFixed(2)}`,
      shareClassType: f.shareClassType || "",
      instrumentType: f.instrumentType || "",
      roundName: round0Name,
      round_id: f.round_id || null,
      round_id_ref: f.round_id_ref,
      is_option_pool: false,
      is_previous: false,
      is_converted: false,
    };
  };

  const buildOptionPoolItem = (
    optShares,
    totalShares,
    valuation,
    cur,
    newShares,
    existingShares,
  ) => {
    const pct = (optShares / totalShares) * 100;
    return {
      type: "option_pool",
      founder_code: "O",
      name: "Employee Option Pool",
      label: "Options Pool",
      shares: optShares,
      new_shares: newShares,
      existing_shares: existingShares,
      total: optShares,
      is_option_pool: true,
      percentage: pct.toFixed(2) + "%",
      percentage_formatted: pct.toFixed(2) + "%",
      value: parseFloat(((pct * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((pct * valuation) / 100).toFixed(2)}`,
      shareClassType: "Option Pool",
      instrumentType: "Options",
      roundName: "Option Pool",
    };
  };

  const buildPrevInvestorItem = (inv, totalShares, valuation, cur) => {
    const ownership = inv.shares / totalShares;
    const rawPercentage = ownership * 100;
    let investorType = "previous";
    if (inv.investor_type === "warrant") {
      investorType = "warrant";
    } else if (inv.investor_type === "warrant not exercised") {
      investorType = "warrant not exercised";
    }
    return {
      type: "investor",
      name: inv.name,
      investor_details: inv.investor_details,
      shares: inv.shares,
      new_shares: 0,
      existing_shares: inv.shares,
      total: inv.shares,
      email: inv.investor_details?.email || inv.email || "",
      phone: inv.investor_details?.phone || inv.phone || "",
      percentage: rawPercentage.toFixed(2) + "%",
      percentage_formatted: rawPercentage.toFixed(2) + "%",
      value: parseFloat(((rawPercentage * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((rawPercentage * valuation) / 100).toFixed(2)}`,
      investment: inv.investment,
      investment_amount: inv.investment,
      share_price: inv.share_price,
      is_previous: true,
      is_new_investment: false,
      is_converted: false,
      investor_type: investorType,
      share_class_type: inv.share_class_type,
      instrument_type: inv.instrument_type,
      round_name: inv.round_name,
      round_id: inv.round_id,
      round_id_ref: inv.round_id_ref,
    };
  };

  const buildWarrantItem = (warrant, totalShares, valuation, cur) => {
    const ownership = warrant.shares / totalShares;
    const rawPercentage = ownership * 100;
    let investorType = "warrant";
    if (warrant.investor_type === "warrant not exercised") {
      investorType = "warrant not exercised";
    }
    return {
      type: "investor",
      name: warrant.name,
      investor_details: warrant.investor_details,
      shares: warrant.shares,
      new_shares: warrant.shares,
      existing_shares: 0,
      total: warrant.shares,
      email: warrant.investor_details?.email || "",
      phone: warrant.investor_details?.phone || "",
      percentage: rawPercentage.toFixed(2) + "%",
      percentage_formatted: rawPercentage.toFixed(2) + "%",
      value: parseFloat(((rawPercentage * valuation) / 100).toFixed(2)),
      value_formatted: `${cur} ${((rawPercentage * valuation) / 100).toFixed(2)}`,
      investment: warrant.investment,
      investment_amount: warrant.investment,
      share_price: warrant.share_price,
      is_previous: false,
      is_warrant: true,
      is_new_investment: true,
      is_converted: false,
      investor_type: investorType,
      share_class_type: warrant.share_class_type,
      instrument_type: warrant.instrument_type,
      round_name: warrant.round_name,
      round_id: warrant.round_id,
      warrant_id: warrant.warrant_id,
    };
  };

  // ==================== PRE-MONEY CAP TABLE ====================
  let previousRoundPostCapTable = null;
  if (latestPreviousRound) {
    try {
      const prevRoundData = await new Promise((resolve, reject) => {
        db.query(
          `SELECT post_money_cap_table FROM roundrecord WHERE id = ? AND company_id = ?`,
          [latestPreviousRound.id, company_id],
          (err, results) => {
            if (err) reject(err);
            else resolve(results?.[0] || null);
          },
        );
      });

      if (prevRoundData?.post_money_cap_table) {
        previousRoundPostCapTable =
          typeof prevRoundData.post_money_cap_table === "string"
            ? JSON.parse(prevRoundData.post_money_cap_table)
            : prevRoundData.post_money_cap_table;
      }
    } catch (error) {
      console.error("❌ Error fetching previous round post cap table:", error);
    }
  }

  const preMoneyCapTable = previousRoundPostCapTable
    ? {
        ...previousRoundPostCapTable,
        pending_instruments: previousPendingSafes,
        items: [
          ...(previousRoundPostCapTable.items || []).filter(
            (item) => !item.is_pending,
          ),

          ...previousPendingSafes,
        ],
      }
    : {
        total_shares: preMoneyTotalShares,
        pre_money_valuation: preMoneyVal,
        currency,
        share_price: sharePrice.toFixed(4),
        pending_instruments: previousPendingSafes,

        founders: {
          list: founderList.map((f) => {
            const ownership = f.shares / preMoneyTotalShares;
            const rawPercentage = ownership * 100;
            return {
              ...f,
              roundName: round0Name,
              share_class_type: round0Shareclassstype,
              percentage: rawPercentage.toFixed(2) + "%",
              value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
            };
          }),
          total_shares: round0Shares,
          total_percentage:
            ((round0Shares / preMoneyTotalShares) * 100).toFixed(2) + "%",
          total_value: (
            ((round0Shares / preMoneyTotalShares) * 100 * preMoneyVal) /
            100
          ).toFixed(2),
          roundName: round0Name,
          share_class_type: round0Shareclassstype,
        },

        option_pool: {
          shares: totalOptionPoolShares,
          existing_shares: existingOptionPoolShares,
          new_shares: newOptionPoolShares,
          total: totalOptionPoolShares,
          percentage:
            ((totalOptionPoolShares / preMoneyTotalShares) * 100).toFixed(2) +
            "%",
          value: (
            ((totalOptionPoolShares / preMoneyTotalShares) *
              100 *
              preMoneyVal) /
            100
          ).toFixed(2),
          shareClassType: "Option Pool",
          instrumentType: "Options",
          roundName: "Option Pool",
          is_option_pool: true,
        },

        previous_investors:
          previousInvestorsList.length > 0
            ? {
                name: "Previous Investors",
                total_shares: previousInvestorsTotalShares,
                percentage:
                  (
                    (previousInvestorsTotalShares / preMoneyTotalShares) *
                    100
                  ).toFixed(2) + "%",
                total_value: (
                  ((previousInvestorsTotalShares / preMoneyTotalShares) *
                    100 *
                    preMoneyVal) /
                  100
                ).toFixed(2),
                items: previousInvestorsList.map((inv) => {
                  const ownership = inv.shares / preMoneyTotalShares;
                  const rawPercentage = ownership * 100;
                  return {
                    ...inv,
                    percentage: rawPercentage.toFixed(2) + "%",
                    value: ((rawPercentage * preMoneyVal) / 100).toFixed(2),
                  };
                }),
                is_grouped: false,
              }
            : null,

        converted: null,

        items: [
          ...founderList.map((f) =>
            buildFounderItem(f, preMoneyTotalShares, preMoneyVal, currency),
          ),
          buildOptionPoolItem(
            totalOptionPoolShares,
            preMoneyTotalShares,
            preMoneyVal,
            currency,
            newOptionPoolShares,
            existingOptionPoolShares,
          ),
          ...previousInvestorsList.map((inv) =>
            buildPrevInvestorItem(
              inv,
              preMoneyTotalShares,
              preMoneyVal,
              currency,
            ),
          ),
          ...previousWarrantsList.map((w) =>
            buildWarrantItem(w, preMoneyTotalShares, preMoneyVal, currency),
          ),
          ...previousPendingSafes,
        ],
      };

  // ==================== POST-MONEY CAP TABLE ====================
  const postMoneyCapTable = {
    total_shares: postMoneyTotalShares,
    post_money_valuation: postMoneyValuation,
    currency,
    share_price: sharePrice.toFixed(4),
    pending_instruments: allPendingInstruments,

    founders: {
      list: founderList.map((f) => {
        const ownership = f.shares / postMoneyTotalShares;
        const rawPercentage = ownership * 100;
        return {
          ...f,
          roundName: currentRound?.nameOfRound,
          share_class_type: round0Shareclassstype,
          shares: f.shares,
          new_shares: 0,
          total: f.shares,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          shareClassType: f.shareClassType || "",
          instrumentType: f.instrumentType || "",
          round_id: round0?.id || null,
        };
      }),
      total_shares: round0Shares,
      total_percentage:
        ((round0Shares / postMoneyTotalShares) * 100).toFixed(2) + "%",
      total_value: (
        ((round0Shares / postMoneyTotalShares) * 100 * postMoneyValuation) /
        100
      ).toFixed(2),
    },

    option_pool: {
      shares: totalOptionPoolShares,
      existing_shares: totalOptionPoolShares,
      new_shares: 0,
      total: totalOptionPoolShares,
      percentage:
        ((totalOptionPoolShares / postMoneyTotalShares) * 100).toFixed(2) + "%",
      value: (
        ((totalOptionPoolShares / postMoneyTotalShares) *
          100 *
          postMoneyValuation) /
        100
      ).toFixed(2),
      shareClassType: "Option Pool",
      instrumentType: "Options",
      roundName: "Option Pool",
      is_option_pool: true,
    },

    previous_investors:
      previousInvestorsList.length > 0
        ? {
            name: "Previous Investors",
            total_shares: previousInvestorsTotalShares,
            new_shares: 0,
            total: previousInvestorsTotalShares,
            percentage:
              (
                (previousInvestorsTotalShares / postMoneyTotalShares) *
                100
              ).toFixed(2) + "%",
            total_value: (
              ((previousInvestorsTotalShares / postMoneyTotalShares) *
                100 *
                postMoneyValuation) /
              100
            ).toFixed(2),
            items: previousInvestorsList.map((inv) => {
              const ownership = inv.shares / postMoneyTotalShares;
              const rawPercentage = ownership * 100;
              return {
                ...inv,
                existing_shares: inv.shares,
                new_shares: 0,
                total: inv.shares,
                percentage: rawPercentage.toFixed(2) + "%",
                value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
              };
            }),
            is_grouped: false,
          }
        : null,

    investors: {
      name: "Convertible Note Investors",
      shares: 0,
      new_shares: 0,
      total: 0,
      percentage: "0.00%",
      value: "0.00",
      investment: roundSizeVal,
      shareClassType: currentRound?.shareClassType || "Convertible Note",
      instrumentType: "Convertible Note",
      roundName: currentRound?.nameOfRound || "Convertible Note Round",
      roundId: currentRound?.id,
      items: [],
    },

    converted_investors: null,

    items: [
      ...founderList.map((f) => {
        const ownership = f.shares / postMoneyTotalShares;
        const rawPercentage = ownership * 100;
        return {
          type: "founder",
          name: f.name,
          shares: f.shares,
          new_shares: 0,
          total: f.shares,
          email: f.email,
          phone: f.phone,
          founder_code: f.founder_code,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          shareClassType: f.shareClassType || "Common Shares",
          instrumentType: f.instrumentType || "Common Stock",
          roundName: "Round 0",
          roundId: round0?.id || null,
          round_id: round0?.id || null,
        };
      }),
      {
        type: "option_pool",
        name: "Employee Option Pool",
        shares: totalOptionPoolShares,
        existing_shares: totalOptionPoolShares,
        new_shares: 0,
        total: totalOptionPoolShares,
        is_option_pool: true,
        percentage:
          ((totalOptionPoolShares / postMoneyTotalShares) * 100).toFixed(2) +
          "%",
        value: (
          ((totalOptionPoolShares / postMoneyTotalShares) *
            100 *
            postMoneyValuation) /
          100
        ).toFixed(2),
        shareClassType: "Option Pool",
        instrumentType: "Options",
        roundName: "Option Pool",
      },
      ...previousInvestorsList.map((inv) => {
        const ownership = inv.shares / postMoneyTotalShares;
        const rawPercentage = ownership * 100;
        return {
          type: "investor",
          name: inv.name,
          investor_details: inv.investor_details,
          shares: inv.shares,
          new_shares: 0,
          total: inv.shares,
          percentage: rawPercentage.toFixed(2) + "%",
          value: ((rawPercentage * postMoneyValuation) / 100).toFixed(2),
          investment: inv.investment,
          share_price: inv.share_price,
          is_previous: true,
          share_class_type: inv.share_class_type,
          instrument_type: inv.instrument_type,
          round_name: inv.round_name,
          round_id: inv.round_id,
        };
      }),
      ...previousWarrantsList.map((w) =>
        buildWarrantItem(w, postMoneyTotalShares, postMoneyValuation, currency),
      ),
      ...currentRoundWarrantsList.map((w) =>
        buildWarrantItem(w, postMoneyTotalShares, postMoneyValuation, currency),
      ),
      ...allPendingInstruments,
    ],
  };

  // ==================== DATABASE UPDATE ====================
  const dbUpdateData = {
    share_price: sharePrice.toFixed(4),
    issuedshares: "0",
    investorPostMoney: investorPostMoneyOwnership.toFixed(2),
    pre_money: preMoneyVal.toString(),
    post_money: postMoneyValuation.toString(),
    roundsize: roundSizeVal.toString(),
    conversion_shares: conversionShares.toString(),
    total_converted_shares: "0",
    option_pool_shares: totalOptionPoolShares.toString(),
    option_pool_percentage: optionPoolPercent.toFixed(2),
    total_shares_before: preMoneyTotalShares.toString(),
    total_shares_after: postMoneyTotalShares.toString(),
    total_option_pool: totalOptionPoolShares.toString(),
    pre_money_cap_table: JSON.stringify(preMoneyCapTable),
    post_money_cap_table: JSON.stringify(postMoneyCapTable),
    updated_at: new Date(),
  };

  try {
    await updateRoundCalculationsSafeConvertibleNote({
      id,
      new_investor_shares: 0,
      conversion_price: conversionPrice || 0,
      conversion_shares: conversionShares || 0,
      option_pool_shares: totalOptionPoolShares,
      share_price: sharePrice,
      total_shares_before: preMoneyTotalShares,
      total_shares_after: postMoneyTotalShares,
      total_converted_shares: 0,
      instrumentType: "Convertible Note",
      roundSize: roundSizeVal,
      preMoney: preMoneyVal,
      pre_money_cap_table: JSON.stringify(preMoneyCapTable),
      post_money_cap_table: JSON.stringify(postMoneyCapTable),
    });

    await saveCapTableData(
      "unprice",
      id,
      company_id,
      preMoneyCapTable,
      postMoneyCapTable,
      preMoneyTotalShares,
      postMoneyTotalShares,
      preMoneyVal,
      postMoneyValuation,
    );

    return {
      success: true,
      data: dbUpdateData,
      roundId: id,
      pre_money_cap_table: preMoneyCapTable,
      post_money_cap_table: postMoneyCapTable,
    };
  } catch (error) {
    console.error("❌ DATABASE ERROR:", error);
    return { success: false, error: error.message };
  }
}
