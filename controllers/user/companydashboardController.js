const db = require("../../db");
const nodemailer = require("nodemailer");
const OpenAI = require("openai");

require("dotenv").config();
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
exports.getroundChart = (req, res) => {
  const { company_id } = req.body;

  if (!company_id) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  // STEP 1: Round record fetch karo
  db.query(
    `SELECT r.*, c.year_registration
     FROM roundrecord r
     LEFT JOIN company c ON r.company_id = c.id
     WHERE r.company_id = ? And roundStatus = 'ACTIVE' order by id desc limit 1`,
    [company_id],
    (err, roundResults) => {
      if (err || !roundResults || roundResults.length === 0) {
        return res
          .status(200)
          .json({ success: false, message: "Round not found" });
      }

      const currentRound = roundResults[0];
      const round_id = currentRound.id;
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
            currentRound.founder_data = JSON.parse(currentRound.founder_data);
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
            issued_shares:
              currentRound.issuedshares || currentRound.total_founder_shares,
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
            total_shares_outstanding: round0CapTable?.totals?.total_shares || 0,
            fully_diluted_shares: round0CapTable?.totals?.total_shares,
            share_price: parseFloat(currentRound.share_price) || 0,
          },
        };

        return res.status(200).json(response);
      }

      // ✅ FIX 1: Use parseFloat to preserve decimals
      const toFloat = (v) => {
        if (v === null || v === undefined) return 0;
        if (typeof v === "number") return v;
        return parseFloat(v) || 0;
      };

      // ✅ FIX 2: Keep as number, don't round
      const toNumber = (v) => {
        if (v === null || v === undefined) return 0;
        if (typeof v === "number") return v;
        return parseFloat(v) || 0;
      };

      // ✅ FIX 3: Format for display only (not for calculation)
      const formatNumber = (n) => {
        const num = toNumber(n);
        return num.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 4,
        });
      };

      const formatMoney = (n) => {
        const num = toNumber(n);
        return `${currency} ${num.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 4,
        })}`;
      };

      // ✅ FIX 4: Calculate percentage with exact decimals
      const calculatePercentage = (shares, totalShares) => {
        if (!totalShares || totalShares === 0) return 0;
        const sharesNum = toNumber(shares);
        const totalNum = toNumber(totalShares);
        return (sharesNum / totalNum) * 100;
      };

      const parseDetails = (d) => {
        try {
          return d ? (typeof d === "string" ? JSON.parse(d) : d) : null;
        } catch {
          return null;
        }
      };

      const buildPendingItem = (p) => ({
        type: "pending",
        name:
          `${p.first_name || ""} ${p.last_name || ""}`.trim() ||
          p.round_name ||
          "Pending Investor",
        instrument_type: p.instrument_type,
        investment: toNumber(p.investment_amount),
        potential_shares: toNumber(p.potential_shares),
        conversion_price: toNumber(p.conversion_price),
        discount_rate: toNumber(p.discount_rate),
        valuation_cap: toNumber(p.valuation_cap),
        interest_rate: toNumber(p.interest_rate),
        years: toNumber(p.years),
        interest_accrued: toNumber(p.interest_accrued),
        total_conversion_amount:
          toNumber(p.total_conversion_amount) || toNumber(p.investment_amount),
        maturity_date: p.maturity_date || null,
        investor_details: parseDetails(p.investor_details),
        is_pending: true,
        shares: 0,
        new_shares: 0,
        total: 0,
        percentage: 0,
        percentage_formatted: "0.00%",
        value: 0,
        value_formatted: formatMoney(0),
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
          value_formatted: formatMoney(0),
        }));
      };

      // ========== FETCH ALL DATA IN PARALLEL ==========

      db.query(
        `SELECT * FROM round_founders WHERE round_id=? AND company_id=? AND cap_table_type='pre' ORDER BY id ASC`,
        [round_id, company_id],
        (err, preFounders) => {
          if (err)
            return res
              .status(500)
              .json({ success: false, message: err.message });

          db.query(
            `SELECT * FROM round_investors WHERE round_id=? AND company_id=? AND cap_table_type='pre' ORDER BY id ASC`,
            [round_id, company_id],
            (err, preInvestors) => {
              if (err)
                return res
                  .status(500)
                  .json({ success: false, message: err.message });

              db.query(
                `SELECT * FROM round_option_pools WHERE round_id=? AND company_id=? AND cap_table_type='pre'`,
                [round_id, company_id],
                (err, preOptionPools) => {
                  if (err)
                    return res
                      .status(500)
                      .json({ success: false, message: err.message });

                  db.query(
                    `SELECT * FROM round_founders WHERE round_id=? AND company_id=? AND cap_table_type='post' ORDER BY id ASC`,
                    [round_id, company_id],
                    (err, postFounders) => {
                      if (err)
                        return res
                          .status(500)
                          .json({ success: false, message: err.message });

                      db.query(
                        `SELECT * FROM round_investors WHERE round_id=? AND company_id=? AND cap_table_type='post' ORDER BY id ASC`,
                        [round_id, company_id],
                        (err, postInvestors) => {
                          if (err)
                            return res
                              .status(500)
                              .json({ success: false, message: err.message });

                          db.query(
                            `SELECT * FROM round_option_pools WHERE round_id=? AND company_id=? AND cap_table_type='post'`,
                            [round_id, company_id],
                            (err, postOptionPools) => {
                              if (err)
                                return res.status(500).json({
                                  success: false,
                                  message: err.message,
                                });

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

                                  // ========== PRE-MONEY WARRANTS ==========
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

                                      // ========== PRE-MONEY BUILD ==========

                                      // ✅ Use toNumber() to preserve exact values
                                      const preFounderItems = (
                                        preFounders || []
                                      ).map((f) => ({
                                        type: "founder",
                                        founder_code: f.founder_code,
                                        name: `${f.first_name || ""} ${f.last_name || ""}`.trim(),
                                        email: f.email,
                                        phone: f.phone,
                                        shares: toNumber(f.shares),
                                        shares_formatted: formatNumber(
                                          f.shares,
                                        ),
                                        value: toNumber(f.value),
                                        value_formatted: formatMoney(f.value),
                                        share_class_type: f.share_class_type,
                                        instrument_type: f.instrument_type,
                                        round_name: f.round_name,
                                      }));

                                      const prePool =
                                        (preOptionPools || [])[0] || null;
                                      const prePoolShares = prePool
                                        ? toNumber(prePool.shares)
                                        : 0;
                                      const prePoolValue = prePool
                                        ? toNumber(prePool.value)
                                        : 0;

                                      const prePrevInv = (
                                        preInvestors || []
                                      ).filter(
                                        (i) => i.investor_type === "previous",
                                      );
                                      const preConvInv = (
                                        preInvestors || []
                                      ).filter(
                                        (i) => i.investor_type === "converted",
                                      );

                                      const preWarrantShares =
                                        preValidWarrants.reduce(
                                          (s, i) => s + toNumber(i.shares),
                                          0,
                                        );
                                      const preWarrantValue =
                                        preValidWarrants.reduce(
                                          (s, i) => s + toNumber(i.value),
                                          0,
                                        );

                                      const prePrevShares = prePrevInv.reduce(
                                        (s, i) => s + toNumber(i.shares),
                                        0,
                                      );
                                      const prePrevValue = prePrevInv.reduce(
                                        (s, i) => s + toNumber(i.value),
                                        0,
                                      );
                                      const preConvShares = preConvInv.reduce(
                                        (s, i) => s + toNumber(i.shares),
                                        0,
                                      );
                                      const preConvValue = preConvInv.reduce(
                                        (s, i) => s + toNumber(i.value),
                                        0,
                                      );

                                      const preTotalFounderShares =
                                        preFounderItems.reduce(
                                          (s, f) => s + toNumber(f.shares),
                                          0,
                                        );
                                      const preTotalFounderValue =
                                        preFounderItems.reduce(
                                          (s, f) => s + toNumber(f.value),
                                          0,
                                        );

                                      // ✅ Calculate total shares with exact decimals
                                      const preTotalShares =
                                        preTotalFounderShares +
                                        prePoolShares +
                                        prePrevShares +
                                        preConvShares +
                                        preWarrantShares;
                                      const preTotalValue =
                                        preTotalFounderValue +
                                        prePoolValue +
                                        prePrevValue +
                                        preConvValue +
                                        preWarrantValue;

                                      // Group previous investors
                                      const prePrevGroups = {};
                                      prePrevInv.forEach((i) => {
                                        const key =
                                          i.round_name || "Previous Investors";
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
                                          toNumber(i.shares);
                                        prePrevGroups[key].total_value +=
                                          toNumber(i.value);
                                      });

                                      // Group warrants
                                      const preWarrantGroups = {};
                                      preValidWarrants.forEach((i) => {
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
                                        preWarrantGroups[key].total_shares +=
                                          toNumber(i.shares);
                                        preWarrantGroups[key].total_value +=
                                          toNumber(i.value);
                                      });

                                      const prePendingItems =
                                        groupPendingByRound(
                                          (pendingInstruments || [])
                                            .filter(
                                              (p) => p.cap_table_type === "pre",
                                            )
                                            .map(buildPendingItem),
                                        );

                                      // ========== PRE-MONEY CAP TABLE ==========
                                      const preMoneyCapTable = {
                                        total_shares: preTotalShares,
                                        pre_money_valuation: preMoneyVal,
                                        currency,
                                        items: [
                                          ...preFounderItems.map((item) => ({
                                            ...item,
                                            percentage: calculatePercentage(
                                              item.shares,
                                              preTotalShares,
                                            ),
                                            percentage_formatted:
                                              calculatePercentage(
                                                item.shares,
                                                preTotalShares,
                                              ).toFixed(4) + "%",
                                          })),
                                          ...(prePool
                                            ? [
                                                {
                                                  type: "option_pool",
                                                  name: "Employee Option Pool",
                                                  shares: prePoolShares,
                                                  shares_formatted:
                                                    formatNumber(prePoolShares),
                                                  percentage:
                                                    calculatePercentage(
                                                      prePoolShares,
                                                      preTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      prePoolShares,
                                                      preTotalShares,
                                                    ).toFixed(4) + "%",
                                                  value: prePoolValue,
                                                  value_formatted:
                                                    formatMoney(prePoolValue),
                                                  is_option_pool: true,
                                                  existing_shares:
                                                    toNumber(
                                                      prePool.existing_shares,
                                                    ) || prePoolShares,
                                                  new_shares:
                                                    toNumber(
                                                      prePool.new_shares,
                                                    ) || 0,
                                                },
                                              ]
                                            : []),
                                          ...Object.values(prePrevGroups).map(
                                            (group) => ({
                                              type: "investor",
                                              name: group.round_name,
                                              label: `${group.items.length} investor${group.items.length > 1 ? "s" : ""}`,
                                              round_id_ref: group.round_id_ref,
                                              share_class_type: "",
                                              shares: group.total_shares,
                                              shares_formatted: formatNumber(
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
                                                ).toFixed(4) + "%",
                                              value: group.total_value,
                                              value_formatted: formatMoney(
                                                group.total_value,
                                              ),
                                              investor_details: group.items.map(
                                                (i) => ({
                                                  type: "investor",
                                                  name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                                  email: i.email,
                                                  phone: i.phone,
                                                  shares: toNumber(i.shares),
                                                  shares_formatted:
                                                    formatNumber(i.shares),
                                                  percentage:
                                                    calculatePercentage(
                                                      toNumber(i.shares),
                                                      preTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      toNumber(i.shares),
                                                      preTotalShares,
                                                    ).toFixed(4) + "%",
                                                  value: toNumber(i.value),
                                                  value_formatted: formatMoney(
                                                    i.value,
                                                  ),
                                                  share_class_type:
                                                    i.share_class_type,
                                                  instrument_type:
                                                    i.instrument_type,
                                                  round_name: i.round_name,
                                                  round_id_ref: i.round_id_ref,
                                                  investor_details:
                                                    parseDetails(
                                                      i.investor_details,
                                                    ),
                                                  is_previous: true,
                                                }),
                                              ),
                                            }),
                                          ),
                                          ...(preConvInv.length > 0
                                            ? [
                                                {
                                                  type: "investor",
                                                  name: "Converted Notes",
                                                  label: `${preConvInv.length} investor${preConvInv.length > 1 ? "s" : ""}`,
                                                  shares: preConvShares,
                                                  shares_formatted:
                                                    formatNumber(preConvShares),
                                                  percentage:
                                                    calculatePercentage(
                                                      preConvShares,
                                                      preTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      preConvShares,
                                                      preTotalShares,
                                                    ).toFixed(4) + "%",
                                                  value: preConvValue,
                                                  value_formatted:
                                                    formatMoney(preConvValue),
                                                  items: preConvInv.map(
                                                    (i) => ({
                                                      type: "investor",
                                                      name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                                      shares: toNumber(
                                                        i.shares,
                                                      ),
                                                      shares_formatted:
                                                        formatNumber(i.shares),
                                                      percentage:
                                                        calculatePercentage(
                                                          toNumber(i.shares),
                                                          preTotalShares,
                                                        ),
                                                      percentage_formatted:
                                                        calculatePercentage(
                                                          toNumber(i.shares),
                                                          preTotalShares,
                                                        ).toFixed(4) + "%",
                                                      value: toNumber(i.value),
                                                      value_formatted:
                                                        formatMoney(i.value),
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
                                          ...Object.values(
                                            preWarrantGroups,
                                          ).map((group) => {
                                            const warrant = group.items[0];
                                            let displayName = group.round_name;
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
                                              new_shares: group.total_shares,
                                              existing_shares: 0,
                                              total: group.total_shares,
                                              shares_formatted: formatNumber(
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
                                                ).toFixed(4) + "%",
                                              value: group.total_value,
                                              value_formatted: formatMoney(
                                                group.total_value,
                                              ),
                                              investor_type:
                                                group.investor_type,
                                              is_warrant: true,
                                              is_new_investment: true,
                                              warrant_id: group.warrant_id,
                                              investor_details: group.items.map(
                                                (i) => ({
                                                  type: "investor",
                                                  investor_type:
                                                    i.investor_type,
                                                  name:
                                                    `${i.first_name || ""} ${i.last_name || ""}`.trim() ||
                                                    "Warrant Holder",
                                                  email: i.email || "",
                                                  phone: i.phone || "",
                                                  shares: toNumber(i.shares),
                                                  shares_formatted:
                                                    formatNumber(i.shares),
                                                  percentage:
                                                    calculatePercentage(
                                                      toNumber(i.shares),
                                                      preTotalShares,
                                                    ),
                                                  percentage_formatted:
                                                    calculatePercentage(
                                                      toNumber(i.shares),
                                                      preTotalShares,
                                                    ).toFixed(4) + "%",
                                                  value: toNumber(i.value),
                                                  value_formatted: formatMoney(
                                                    i.value,
                                                  ),
                                                  is_warrant: true,
                                                  warrant_id: i.warrant_id,
                                                  investment_amount: toNumber(
                                                    i.investment_amount,
                                                  ),
                                                  share_price: toNumber(
                                                    i.share_price,
                                                  ),
                                                }),
                                              ),
                                            };
                                          }),
                                          ...prePendingItems.map((item) => ({
                                            ...item,
                                            percentage: calculatePercentage(
                                              item.total_potential_shares || 0,
                                              preTotalShares,
                                            ),
                                            percentage_formatted:
                                              calculatePercentage(
                                                item.total_potential_shares ||
                                                  0,
                                                preTotalShares,
                                              ).toFixed(4) + "%",
                                          })),
                                        ],
                                        totals: {
                                          total_shares: preTotalShares,
                                          total_shares_formatted:
                                            formatNumber(preTotalShares),
                                          total_founders: preTotalFounderShares,
                                          total_option_pool: prePoolShares,
                                          total_investors:
                                            prePrevShares +
                                            preConvShares +
                                            preWarrantShares,
                                          total_value: preTotalValue,
                                          total_value_formatted:
                                            formatMoney(preTotalValue),
                                          total_percentage: "100.00%",
                                        },
                                      };

                                      // ========== POST-MONEY WARRANTS ==========
                                      const getPostWarrantsQuery = `
                                      SELECT ri.*, w.expiration_date, w.id as warrant_id
                                      FROM round_investors ri
                                      LEFT JOIN warrants w ON w.id = ri.warrant_id
                                      WHERE ri.round_id = ? 
                                        AND ri.company_id = ? 
                                        AND ri.cap_table_type = 'post'
                                        AND ri.investor_type IN ('warrant', 'warrant not exercised')
                                        AND (w.expiration_date IS NULL OR w.expiration_date >= CURDATE())
                                    `;

                                      db.query(
                                        getPostWarrantsQuery,
                                        [round_id, company_id],
                                        (
                                          postWarrantErr,
                                          postWarrantResults,
                                        ) => {
                                          if (postWarrantErr) {
                                            console.error(
                                              "Error fetching post-money warrants:",
                                              postWarrantErr,
                                            );
                                          }

                                          const validPostWarrants =
                                            postWarrantResults || [];

                                          // ========== POST-MONEY BUILD ==========

                                          const postFounderItems = (
                                            postFounders || []
                                          ).map((f) => ({
                                            type: "founder",
                                            founder_code: f.founder_code,
                                            name: `${f.first_name || ""} ${f.last_name || ""}`.trim(),
                                            email: f.email,
                                            phone: f.phone,
                                            existing_shares: toNumber(f.shares),
                                            new_shares: 0,
                                            shares: toNumber(f.shares),
                                            total_shares: toNumber(f.shares),
                                            shares_formatted: formatNumber(
                                              f.shares,
                                            ),
                                            value: toNumber(f.value),
                                            value_formatted: formatMoney(
                                              f.value,
                                            ),
                                            share_class_type:
                                              f.share_class_type,
                                            instrument_type: f.instrument_type,
                                            round_name: f.round_name,
                                          }));

                                          const postPool =
                                            (postOptionPools || [])[0] || null;
                                          const postPoolExisting = postPool
                                            ? toNumber(postPool.existing_shares)
                                            : 0;
                                          const postPoolNew = postPool
                                            ? toNumber(postPool.new_shares)
                                            : 0;
                                          const postPoolTotal = postPool
                                            ? toNumber(postPool.shares)
                                            : 0;
                                          const postPoolValue = postPool
                                            ? toNumber(postPool.value)
                                            : 0;

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

                                          const postPrevShares =
                                            postPrevInv.reduce(
                                              (s, i) => s + toNumber(i.shares),
                                              0,
                                            );
                                          const postPrevValue =
                                            postPrevInv.reduce(
                                              (s, i) => s + toNumber(i.value),
                                              0,
                                            );
                                          const postConvShares =
                                            postConvInv.reduce(
                                              (s, i) => s + toNumber(i.shares),
                                              0,
                                            );
                                          const postConvValue =
                                            postConvInv.reduce(
                                              (s, i) => s + toNumber(i.value),
                                              0,
                                            );
                                          const postCurrShares =
                                            postCurrInv.reduce(
                                              (s, i) => s + toNumber(i.shares),
                                              0,
                                            );
                                          const postCurrValue =
                                            postCurrInv.reduce(
                                              (s, i) => s + toNumber(i.value),
                                              0,
                                            );

                                          const postWarrantShares =
                                            validPostWarrants.reduce(
                                              (s, i) => s + toNumber(i.shares),
                                              0,
                                            );
                                          const postWarrantValue =
                                            validPostWarrants.reduce(
                                              (s, i) => s + toNumber(i.value),
                                              0,
                                            );

                                          const postTotalFounderShares =
                                            postFounderItems.reduce(
                                              (s, f) => s + toNumber(f.shares),
                                              0,
                                            );
                                          const postTotalFounderValue =
                                            postFounderItems.reduce(
                                              (s, f) => s + toNumber(f.value),
                                              0,
                                            );

                                          // ✅ Calculate total shares with exact decimals
                                          const postTotalShares =
                                            postTotalFounderShares +
                                            postPoolTotal +
                                            postPrevShares +
                                            postConvShares +
                                            postCurrShares +
                                            postWarrantShares;
                                          const postTotalNewShares =
                                            postPoolNew +
                                            postConvShares +
                                            postCurrShares +
                                            postWarrantShares;
                                          const postTotalValue =
                                            postTotalFounderValue +
                                            postPoolValue +
                                            postPrevValue +
                                            postConvValue +
                                            postCurrValue +
                                            postWarrantValue;

                                          // Group previous investors
                                          const postPrevGroups = {};
                                          postPrevInv.forEach((i) => {
                                            const key =
                                              i.round_name ||
                                              "Previous Investors";
                                            if (!postPrevGroups[key]) {
                                              postPrevGroups[key] = {
                                                round_name: key,
                                                round_id_ref: i.round_id_ref,
                                                items: [],
                                                total_shares: 0,
                                                total_value: 0,
                                              };
                                            }
                                            postPrevGroups[key].items.push(i);
                                            postPrevGroups[key].total_shares +=
                                              toNumber(i.shares);
                                            postPrevGroups[key].total_value +=
                                              toNumber(i.value);
                                          });

                                          // Group converted investors
                                          const postConvGroups = {};
                                          postConvInv.forEach((i) => {
                                            const key =
                                              i.round_name || "Converted Notes";
                                            if (!postConvGroups[key]) {
                                              postConvGroups[key] = {
                                                round_name: key,
                                                round_id_ref: i.round_id_ref,
                                                items: [],
                                                total_shares: 0,
                                                total_value: 0,
                                              };
                                            }
                                            postConvGroups[key].items.push(i);
                                            postConvGroups[key].total_shares +=
                                              toNumber(i.shares);
                                            postConvGroups[key].total_value +=
                                              toNumber(i.value);
                                          });

                                          // Group current investors
                                          const postCurrGroups = {};
                                          postCurrInv.forEach((i) => {
                                            const key =
                                              i.round_name || "New Investors";
                                            if (!postCurrGroups[key]) {
                                              postCurrGroups[key] = {
                                                round_name: key,
                                                round_id_ref: i.round_id_ref,
                                                items: [],
                                                total_shares: 0,
                                                total_new_shares: 0,
                                                total_value: 0,
                                              };
                                            }
                                            postCurrGroups[key].items.push(i);
                                            postCurrGroups[key].total_shares +=
                                              toNumber(i.shares);
                                            postCurrGroups[
                                              key
                                            ].total_new_shares +=
                                              toNumber(i.new_shares) ||
                                              toNumber(i.shares);
                                            postCurrGroups[key].total_value +=
                                              toNumber(i.value);
                                          });

                                          // Group warrants
                                          const postWarrantGroups = {};
                                          validPostWarrants.forEach((i) => {
                                            const key = i.warrant_id
                                              ? i.warrant_id.toString()
                                              : `${i.round_name}_${i.investor_type}_${Math.random()}`;
                                            if (!postWarrantGroups[key]) {
                                              postWarrantGroups[key] = {
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
                                            postWarrantGroups[key].items.push(
                                              i,
                                            );
                                            postWarrantGroups[
                                              key
                                            ].total_shares += toNumber(
                                              i.shares,
                                            );
                                            postWarrantGroups[
                                              key
                                            ].total_value += toNumber(i.value);
                                          });

                                          const postPendingItems =
                                            groupPendingByRound(
                                              (pendingInstruments || [])
                                                .filter(
                                                  (p) =>
                                                    p.cap_table_type === "post",
                                                )
                                                .map(buildPendingItem),
                                            );

                                          // Helper function to build group items
                                          const buildGroupItem = (
                                            group,
                                            investorType,
                                            totalShares,
                                          ) => ({
                                            type: "investor",
                                            investor_type: investorType,
                                            name: group.round_name,
                                            label: `${group.items.length} investor${group.items.length > 1 ? "s" : ""}`,
                                            round_id_ref: group.round_id_ref,
                                            share_class_type:
                                              group.share_class_type,
                                            shares: group.total_shares,
                                            existing_shares:
                                              investorType === "current" ||
                                              investorType === "converted" ||
                                              investorType === "warrant" ||
                                              investorType ===
                                                "warrant not exercised"
                                                ? 0
                                                : group.total_shares,
                                            new_shares:
                                              investorType === "current" ||
                                              investorType === "converted" ||
                                              investorType === "warrant" ||
                                              investorType ===
                                                "warrant not exercised"
                                                ? group.total_shares
                                                : 0,
                                            total_shares: group.total_shares,
                                            shares_formatted: formatNumber(
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
                                              ).toFixed(4) + "%",
                                            value: group.total_value,
                                            value_formatted: formatMoney(
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
                                                "warrant not exercised",
                                            investor_details: group.items.map(
                                              (i) => ({
                                                type: "investor",
                                                investor_type: investorType,
                                                name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                                email: i.email,
                                                phone: i.phone,
                                                shares: toNumber(i.shares),
                                                existing_shares:
                                                  investorType === "current" ||
                                                  investorType ===
                                                    "converted" ||
                                                  investorType === "warrant" ||
                                                  investorType ===
                                                    "warrant not exercised"
                                                    ? 0
                                                    : toNumber(i.shares),
                                                new_shares:
                                                  investorType === "current" ||
                                                  investorType ===
                                                    "converted" ||
                                                  investorType === "warrant" ||
                                                  investorType ===
                                                    "warrant not exercised"
                                                    ? toNumber(i.new_shares) ||
                                                      toNumber(i.shares)
                                                    : 0,
                                                shares_formatted: formatNumber(
                                                  i.shares,
                                                ),
                                                percentage: calculatePercentage(
                                                  toNumber(i.shares),
                                                  totalShares,
                                                ),
                                                percentage_formatted:
                                                  calculatePercentage(
                                                    toNumber(i.shares),
                                                    totalShares,
                                                  ).toFixed(4) + "%",
                                                value: toNumber(i.value),
                                                value_formatted: formatMoney(
                                                  i.value,
                                                ),
                                                investment_amount: toNumber(
                                                  i.investment_amount,
                                                ),
                                                share_price: toNumber(
                                                  i.share_price,
                                                ),
                                                share_class_type:
                                                  i.share_class_type,
                                                instrument_type:
                                                  i.instrument_type,
                                                round_name: i.round_name,
                                                round_id_ref: i.round_id_ref,
                                                is_previous:
                                                  investorType === "previous",
                                                is_new_investment:
                                                  investorType === "current",
                                                is_converted:
                                                  investorType === "converted",
                                                is_warrant:
                                                  investorType === "warrant" ||
                                                  investorType ===
                                                    "warrant not exercised",
                                                investor_details: parseDetails(
                                                  i.investor_details,
                                                ),
                                                potential_shares: toNumber(
                                                  i.potential_shares,
                                                ),
                                                conversion_price: toNumber(
                                                  i.conversion_price,
                                                ),
                                                discount_rate: toNumber(
                                                  i.discount_rate,
                                                ),
                                                valuation_cap: toNumber(
                                                  i.valuation_cap,
                                                ),
                                                interest_rate: toNumber(
                                                  i.interest_rate,
                                                ),
                                                years: toNumber(i.years),
                                                interest_accrued: toNumber(
                                                  i.interest_accrued,
                                                ),
                                                total_conversion_amount:
                                                  toNumber(
                                                    i.total_conversion_amount,
                                                  ) ||
                                                  toNumber(i.investment_amount),
                                                maturity_date:
                                                  i.maturity_date || null,
                                                warrant_id: i.warrant_id,
                                              }),
                                            ),
                                          });

                                          // ========== POST-MONEY CAP TABLE ==========
                                          const postMoneyCapTable = {
                                            total_shares: postTotalShares,
                                            post_money_valuation: postMoneyVal,
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
                                                    ).toFixed(4) + "%",
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
                                                      new_shares: postPoolNew,
                                                      shares: postPoolTotal,
                                                      total_shares:
                                                        postPoolTotal,
                                                      shares_formatted:
                                                        formatNumber(
                                                          postPoolTotal,
                                                        ),
                                                      percentage:
                                                        calculatePercentage(
                                                          postPoolTotal,
                                                          postTotalShares,
                                                        ),
                                                      percentage_formatted:
                                                        calculatePercentage(
                                                          postPoolTotal,
                                                          postTotalShares,
                                                        ).toFixed(4) + "%",
                                                      value: postPoolValue,
                                                      value_formatted:
                                                        formatMoney(
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
                                                    ).toFixed(4) + "%",
                                                }),
                                              ),
                                            ],
                                            totals: {
                                              total_shares: postTotalShares,
                                              total_shares_formatted:
                                                formatNumber(postTotalShares),
                                              total_new_shares:
                                                postTotalNewShares,
                                              total_new_shares_formatted:
                                                formatNumber(
                                                  postTotalNewShares,
                                                ),
                                              total_founders:
                                                postTotalFounderShares,
                                              total_option_pool: postPoolTotal,
                                              total_investors:
                                                postPrevShares +
                                                postConvShares +
                                                postCurrShares +
                                                postWarrantShares,
                                              total_value: postTotalValue,
                                              total_value_formatted:
                                                formatMoney(postTotalValue),
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
                                              status: currentRound.roundStatus,
                                              date: currentRound.created_at,
                                              pre_money: currentRound.pre_money,
                                              post_money:
                                                currentRound.post_money,
                                              investment:
                                                currentRound.roundsize,
                                              currency: currentRound.currency,
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
                                              pre_money_valuation: preMoneyVal,
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

exports.getInvitedInvestor = async (req, res) => {
  try {
    const company_id = req.body.company_id;

    db.query(
      "SELECT ci.*, ii.id FROM company_investor ci JOIN investor_information ii ON ii.id = ci.investor_id WHERE ci.company_id = ?",
      [company_id],
      async (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        return res.status(200).json({
          message: "",
          results: results,
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

exports.getTotalNumberContact = async (req, res) => {
  try {
    const company_id = req.body.company_id;

    db.query(
      "SELECT ci.*, ii.id FROM company_investor ci JOIN investor_information ii ON ii.id = ci.investor_id WHERE ci.company_id = ?",
      [company_id],
      async (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        return res.status(200).json({
          message: "",
          results: results,
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

exports.getTotalNumberRoundA = async (req, res) => {
  try {
    const company_id = req.body.company_id;

    // First query: Get investorrequest_company data
    db.query(
      "SELECT * FROM investorrequest_company WHERE company_id = ?",
      [company_id],
      async (err, results) => {
        if (err) {
          return res
            .status(500)
            .json({ message: "Database query error", error: err });
        }

        // Second query: Get totalCountSoftCircle
        db.query(
          "SELECT COUNT(*) as totalCountSoftCircle FROM investorrequest_company WHERE company_id = ?",
          [company_id],
          (err2, softCircleResults) => {
            if (err2) {
              return res
                .status(500)
                .json({ message: "Database query error", error: err2 });
            }

            // Third query: Get totalCountConfirmedInvestor
            db.query(
              "SELECT COUNT(*) as totalCountConfirmedInvestor FROM company_investor WHERE company_id = ? AND joinstatus = ?",
              [company_id, "Yes"],
              (err3, confirmedResults) => {
                if (err3) {
                  return res
                    .status(500)
                    .json({ message: "Database query error", error: err3 });
                }

                // Fourth query: Get totalCountInvestorsEngagement
                db.query(
                  "SELECT COUNT(*) as totalCountInvestorsEngagement FROM company_investor WHERE company_id = ? AND joinstatus = ?",
                  [company_id, "Yes"],
                  (err4, engagementResults) => {
                    if (err4) {
                      return res
                        .status(500)
                        .json({ message: "Database query error", error: err4 });
                    }

                    // Fifth query: Get totalCountDocumentView from sharerecordround
                    db.query(
                      "SELECT COUNT(*) as totalCountDocumentView FROM sharerecordround WHERE company_id = ? AND access_status = ?",
                      [company_id, "Only View"],
                      (err5, documentResults) => {
                        if (err5) {
                          return res.status(500).json({
                            message: "Database query error",
                            error: err5,
                          });
                        }

                        // Sixth query: Get totalCountSoftCircleRatio (request_confirm = 'No')
                        db.query(
                          "SELECT COUNT(*) as softCircleNotConfirmed FROM investorrequest_company WHERE company_id = ? AND request_confirm = ?",
                          [company_id, "No"],
                          (err6, softCircleRatioResults) => {
                            if (err6) {
                              return res.status(500).json({
                                message: "Database query error",
                                error: err6,
                              });
                            }

                            // Get total investorrequest_company count for ratio calculation
                            db.query(
                              "SELECT COUNT(*) as totalInvestorRequests FROM investorrequest_company WHERE company_id = ?",
                              [company_id],
                              (err7, totalRequestsResults) => {
                                if (err7) {
                                  return res.status(500).json({
                                    message: "Database query error",
                                    error: err7,
                                  });
                                }

                                // Seventh query: Get totalCountInvestors from company_add_investors
                                db.query(
                                  "SELECT COUNT(*) as totalCountInvestors FROM company_add_investors WHERE company_id = ?",
                                  [company_id],
                                  (err8, investorsResults) => {
                                    if (err8) {
                                      return res.status(500).json({
                                        message: "Database query error",
                                        error: err8,
                                      });
                                    }

                                    return res.status(200).json({
                                      message: "",
                                      results: results,
                                      totalCountSoftCircle:
                                        softCircleResults[0]
                                          ?.totalCountSoftCircle || 0,
                                      totalCountConfirmedInvestor:
                                        confirmedResults[0]
                                          ?.totalCountConfirmedInvestor || 0,
                                      totalCountInvestorsEngagement:
                                        engagementResults[0]
                                          ?.totalCountInvestorsEngagement || 0,
                                      totalCountDocumentView:
                                        documentResults[0]
                                          ?.totalCountDocumentView || 0,
                                      totalCountSoftCircleRatio: {
                                        notConfirmed:
                                          softCircleRatioResults[0]
                                            ?.softCircleNotConfirmed || 0,
                                        totalRequests:
                                          totalRequestsResults[0]
                                            ?.totalInvestorRequests || 0,
                                        ratio:
                                          totalRequestsResults[0]
                                            ?.totalInvestorRequests > 0
                                            ? ((softCircleRatioResults[0]
                                                ?.softCircleNotConfirmed || 0) /
                                                totalRequestsResults[0]
                                                  ?.totalInvestorRequests) *
                                              100
                                            : 0,
                                      },
                                      totalCountInvestors:
                                        investorsResults[0]
                                          ?.totalCountInvestors || 0,
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
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getTotalNumberCapTableAnalytics = async (req, res) => {
  try {
    const company_id = req.body.company_id;

    db.query(
      "SELECT founder_data FROM roundrecord WHERE company_id = ? AND round_type = ?",
      [company_id, "Round 0"],
      (err, results) => {
        if (err) {
          return res.status(500).json({
            message: "Database query error",
            error: err,
          });
        }

        let totalFounders = 0;
        let totalShares = 0;
        let pricePerShare = 0;
        let ownershipBreakdown = [];

        if (results?.length > 0 && results[0].founder_data) {
          // Solution 1: Simple fix with proper type checking
          try {
            let founderData = results[0].founder_data;

            // Handle both string and object cases
            if (typeof founderData === "string") {
              founderData = JSON.parse(founderData);
            } else if (
              typeof founderData === "object" &&
              founderData !== null
            ) {
              // Already an object, use as is
              founderData = founderData;
            } else {
              // Invalid data, use empty object
              founderData = {};
            }

            totalFounders = founderData?.founders?.length || 0;
            totalShares = parseFloat(founderData?.totalShares) || 0;
            pricePerShare = parseFloat(founderData?.pricePerShare) || 0;
            ownershipBreakdown = founderData?.ownershipBreakdown || [];
          } catch (parseError) {
            console.error("Error parsing founder_data:", parseError);
            console.error(
              "Type of founder_data:",
              typeof results[0].founder_data,
            );
            console.error("Raw value:", results[0].founder_data);
            // Set default values on error
            totalFounders = 0;
            totalShares = 0;
            pricePerShare = 0;
            ownershipBreakdown = [];
          }
        }
        return res.status(200).json({
          message: "",
          totalFounders: totalFounders,
        });
      },
    );
  } catch (error) {
    res.status(500).json({
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.fetchSocialMediaFollower = async (req, res) => {
  try {
    const { id, type } = req.body;

    if (!id || !type) {
      return res
        .status(400)
        .json({ success: false, message: "id and type required" });
    }

    db.query(
      `SELECT
        (SELECT COUNT(*) FROM follows
          WHERE following_id = ? AND following_type = ?) AS followers_count,
        (SELECT COUNT(*) FROM follows
          WHERE follower_id = ? AND follower_type = ?) AS following_count`,
      [id, type, id, type],
      (err, results) => {
        if (err)
          return res.status(500).json({ success: false, message: err.message });

        return res.status(200).json({
          success: true,
          followers: parseInt(results[0]?.followers_count) || 0,
          following: parseInt(results[0]?.following_count) || 0,
        });
      },
    );
  } catch (error) {
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};

exports.getlatestfundingRoundDate = async (req, res) => {
  try {
    const { company_id } = req.body;

    if (!company_id) {
      return res
        .status(200)
        .json({ success: false, message: "Company id is required" });
    }

    db.query(
      `Select * from  roundrecord where company_id = ? And roundStatus = ? order by id desc limit 1`,
      [company_id, "ACTIVE"],
      (err, results) => {
        if (err)
          return res.status(500).json({ success: false, message: err.message });

        return res.status(200).json({
          success: true,
          results: results,
        });
      },
    );
  } catch (error) {
    res
      .status(500)
      .json({ message: "Internal server error", error: error.message });
  }
};
