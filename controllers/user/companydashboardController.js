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
     WHERE r.company_id = ? order by id desc limit 1`,
    [company_id],
    (err, roundResults) => {
      if (err || !roundResults || roundResults.length === 0) {
        return res
          .status(404)
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

      // HELPERS
      const fmt = (n) => Math.round(n || 0).toLocaleString();
      const pct = (n) => `${parseFloat(n || 0).toFixed(2)}%`;
      const money = (n) => `${currency} ${parseFloat(n || 0).toFixed(2)}`;
      const parsePct = (v) =>
        parseFloat((v || "0").toString().replace("%", "")) || 0;
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
        [currentRound.id, company_id],
        (err, preFounders) => {
          if (err)
            return res
              .status(500)
              .json({ success: false, message: err.message });

          // STEP 3: PRE Investors
          db.query(
            `SELECT * FROM round_investors WHERE round_id=? AND company_id=? AND cap_table_type='pre' ORDER BY id ASC`,
            [currentRound.id, company_id],
            (err, preInvestors) => {
              if (err)
                return res
                  .status(500)
                  .json({ success: false, message: err.message });

              // STEP 4: PRE Option Pool
              db.query(
                `SELECT * FROM round_option_pools WHERE round_id=? AND company_id=? AND cap_table_type='pre'`,
                [currentRound.id, company_id],
                (err, preOptionPools) => {
                  if (err)
                    return res
                      .status(500)
                      .json({ success: false, message: err.message });

                  // STEP 5: POST Founders
                  db.query(
                    `SELECT * FROM round_founders WHERE round_id=? AND company_id=? AND cap_table_type='post' ORDER BY id ASC`,
                    [currentRound.id, company_id],
                    (err, postFounders) => {
                      if (err)
                        return res
                          .status(500)
                          .json({ success: false, message: err.message });

                      // STEP 6: POST Investors
                      db.query(
                        `SELECT * FROM round_investors WHERE round_id=? AND company_id=? AND cap_table_type='post' ORDER BY id ASC`,
                        [currentRound.id, company_id],
                        (err, postInvestors) => {
                          if (err)
                            return res
                              .status(500)
                              .json({ success: false, message: err.message });

                          // STEP 7: POST Option Pool
                          db.query(
                            `SELECT * FROM round_option_pools WHERE round_id=? AND company_id=? AND cap_table_type='post'`,
                            [currentRound.id, company_id],
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
                                [company_id, currentRound.id],
                                (err, pendingInstruments) => {
                                  if (err)
                                    return res.status(500).json({
                                      success: false,
                                      message: err.message,
                                    });

                                  // ========== PRE-MONEY BUILD ==========
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
                                    percentage: parsePct(
                                      f.percentage_formatted,
                                    ),
                                    percentage_formatted: pct(
                                      parsePct(f.percentage_formatted),
                                    ),
                                    value: parseFloat(f.value || 0),
                                    value_formatted: money(f.value),
                                    share_class_type: f.share_class_type,
                                    instrument_type: f.instrument_type,
                                    round_name: f.round_name,
                                  }));

                                  const prePool =
                                    (preOptionPools || [])[0] || null;
                                  const prePoolShares = prePool
                                    ? prePool.shares
                                    : 0;
                                  const prePoolPct = prePool
                                    ? parsePct(prePool.percentage_formatted)
                                    : 0;
                                  const prePoolValue = prePool
                                    ? (prePoolPct / 100) * preMoneyVal
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

                                  const prePrevShares = prePrevInv.reduce(
                                    (s, i) => s + i.shares,
                                    0,
                                  );
                                  const prePrevValue = prePrevInv.reduce(
                                    (s, i) =>
                                      s +
                                      (parsePct(i.percentage_formatted) / 100) *
                                        preMoneyVal,
                                    0,
                                  );
                                  const preConvShares = preConvInv.reduce(
                                    (s, i) => s + i.shares,
                                    0,
                                  );
                                  const preConvPct = preConvInv.reduce(
                                    (s, i) =>
                                      s + parsePct(i.percentage_formatted),
                                    0,
                                  );
                                  // ✅ DB se value use karo
                                  const preConvValue = preConvInv.reduce(
                                    (s, i) => s + parseFloat(i.value || 0),
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
                                    preConvShares;
                                  const preTotalValue =
                                    preTotalFounderValue +
                                    prePoolValue +
                                    prePrevValue +
                                    preConvValue;

                                  // Group previous investors by round_name
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
                                        total_pct: 0,
                                        total_value: 0,
                                      };
                                    }
                                    prePrevGroups[key].items.push(i);
                                    prePrevGroups[key].total_shares += i.shares;
                                    prePrevGroups[key].total_pct += parsePct(
                                      i.percentage_formatted,
                                    );
                                    prePrevGroups[key].total_value +=
                                      (parsePct(i.percentage_formatted) / 100) *
                                      preMoneyVal;
                                  });

                                  const prePendingItems = groupPendingByRound(
                                    (pendingInstruments || [])
                                      .filter((p) => p.cap_table_type === "pre")
                                      .map(buildPendingItem),
                                  );

                                  const preMoneyCapTable = {
                                    total_shares: preTotalShares,
                                    pre_money_valuation: preMoneyVal,
                                    currency,
                                    items: [
                                      ...preFounderItems,
                                      ...(prePool
                                        ? [
                                            {
                                              type: "option_pool",
                                              founder_code: "O",
                                              name: "Employee Option Pool",
                                              shares: prePoolShares,
                                              shares_formatted:
                                                fmt(prePoolShares),
                                              percentage: prePoolPct,
                                              percentage_formatted:
                                                pct(prePoolPct),
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
                                      ...Object.values(prePrevGroups).map(
                                        (group) => ({
                                          type: "investor",
                                          name: group.round_name,
                                          label: `${group.items.length} investor${group.items.length > 1 ? "s" : ""}`,
                                          round_id_ref: group.round_id_ref,
                                          shares: group.total_shares,
                                          shares_formatted: fmt(
                                            group.total_shares,
                                          ),
                                          percentage: group.total_pct,
                                          percentage_formatted: pct(
                                            group.total_pct,
                                          ),
                                          value: group.total_value,
                                          value_formatted: money(
                                            group.total_value,
                                          ),
                                          investor_details: group.items.map(
                                            (i) => ({
                                              type: "investor",
                                              name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                              email: i.email,
                                              phone: i.phone,
                                              shares: i.shares,
                                              shares_formatted: fmt(i.shares),
                                              percentage: parsePct(
                                                i.percentage_formatted,
                                              ),
                                              percentage_formatted: pct(
                                                parsePct(
                                                  i.percentage_formatted,
                                                ),
                                              ),
                                              value:
                                                (parsePct(
                                                  i.percentage_formatted,
                                                ) /
                                                  100) *
                                                preMoneyVal,
                                              value_formatted: money(
                                                (parsePct(
                                                  i.percentage_formatted,
                                                ) /
                                                  100) *
                                                  preMoneyVal,
                                              ),
                                              share_class_type:
                                                i.share_class_type,
                                              instrument_type:
                                                i.instrument_type,
                                              round_name: i.round_name,
                                              round_id_ref: i.round_id_ref,
                                              investor_details: parseDetails(
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
                                                fmt(preConvShares),
                                              percentage: preConvPct,
                                              percentage_formatted:
                                                pct(preConvPct),
                                              value: preConvValue,
                                              value_formatted:
                                                money(preConvValue),
                                              items: preConvInv.map((i) => ({
                                                type: "investor",
                                                name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                                shares: i.shares,
                                                shares_formatted: fmt(i.shares),
                                                percentage: parsePct(
                                                  i.percentage_formatted,
                                                ),
                                                percentage_formatted: pct(
                                                  parsePct(
                                                    i.percentage_formatted,
                                                  ),
                                                ),
                                                value: parseFloat(i.value || 0),
                                                value_formatted: money(i.value),
                                                is_converted: true,
                                                investor_details: parseDetails(
                                                  i.investor_details,
                                                ),
                                              })),
                                            },
                                          ]
                                        : []),
                                      ...prePendingItems,
                                    ],
                                    totals: {
                                      total_shares: preTotalShares,
                                      total_shares_formatted:
                                        fmt(preTotalShares),
                                      total_founders: preTotalFounderShares,
                                      total_option_pool: prePoolShares,
                                      total_investors:
                                        prePrevShares + preConvShares,
                                      total_value: preTotalValue,
                                      total_value_formatted:
                                        money(preTotalValue),
                                      total_percentage: "100.00%",
                                    },
                                  };

                                  // ========== POST-MONEY BUILD ==========
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
                                    percentage: parsePct(
                                      f.percentage_formatted,
                                    ),
                                    percentage_formatted: pct(
                                      parsePct(f.percentage_formatted),
                                    ),
                                    value: parseFloat(f.value || 0),
                                    value_formatted: money(f.value),
                                    share_class_type: f.share_class_type,
                                    instrument_type: f.instrument_type,
                                    round_name: f.round_name,
                                  }));

                                  const postPool =
                                    (postOptionPools || [])[0] || null;
                                  const postPoolExisting = postPool
                                    ? postPool.existing_shares || 0
                                    : 0;
                                  const postPoolNew = postPool
                                    ? postPool.new_shares || 0
                                    : 0;
                                  const postPoolTotal = postPool
                                    ? postPool.shares
                                    : 0;
                                  const postPoolPct = postPool
                                    ? parsePct(postPool.percentage_formatted)
                                    : 0;
                                  const postPoolValue = postPool
                                    ? parseFloat(postPool.value || 0)
                                    : 0;

                                  const postPrevInv = (
                                    postInvestors || []
                                  ).filter(
                                    (i) => i.investor_type === "previous",
                                  );
                                  const postConvInv = (
                                    postInvestors || []
                                  ).filter(
                                    (i) => i.investor_type === "converted",
                                  );
                                  const postCurrInv = (
                                    postInvestors || []
                                  ).filter(
                                    (i) => i.investor_type === "current",
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
                                  const postPrevShares = postPrevInv.reduce(
                                    (s, i) => s + i.shares,
                                    0,
                                  );
                                  const postPrevValue = postPrevInv.reduce(
                                    (s, i) => s + parseFloat(i.value || 0),
                                    0,
                                  );
                                  const postConvShares = postConvInv.reduce(
                                    (s, i) => s + i.shares,
                                    0,
                                  );
                                  // ✅ DB se value use karo
                                  const postConvValue = postConvInv.reduce(
                                    (s, i) => s + parseFloat(i.value || 0),
                                    0,
                                  );
                                  const postCurrShares = postCurrInv.reduce(
                                    (s, i) => s + i.shares,
                                    0,
                                  );
                                  const postCurrValue = postCurrInv.reduce(
                                    (s, i) => s + parseFloat(i.value || 0),
                                    0,
                                  );

                                  const postTotalShares =
                                    postTotalFounderShares +
                                    postPoolTotal +
                                    postPrevShares +
                                    postConvShares +
                                    postCurrShares;
                                  const postTotalNewShares =
                                    postPoolNew +
                                    postConvShares +
                                    postCurrShares;
                                  // ✅ FIX: postConvValue included in total
                                  const postTotalValue =
                                    postTotalFounderValue +
                                    postPoolValue +
                                    postPrevValue +
                                    postConvValue +
                                    postCurrValue;

                                  const postPendingItems = groupPendingByRound(
                                    (pendingInstruments || [])
                                      .filter(
                                        (p) => p.cap_table_type === "post",
                                      )
                                      .map(buildPendingItem),
                                  );

                                  // Previous investors group by round_name
                                  const postPrevGroups = {};
                                  postPrevInv.forEach((i) => {
                                    const key =
                                      i.round_name || "Previous Investors";
                                    if (!postPrevGroups[key]) {
                                      postPrevGroups[key] = {
                                        round_name: key,
                                        round_id_ref: i.round_id_ref,
                                        items: [],
                                        total_shares: 0,
                                        total_pct: 0,
                                        total_value: 0,
                                      };
                                    }
                                    postPrevGroups[key].items.push(i);
                                    postPrevGroups[key].total_shares +=
                                      i.shares;
                                    postPrevGroups[key].total_pct += parsePct(
                                      i.percentage_formatted,
                                    );
                                    postPrevGroups[key].total_value +=
                                      parseFloat(i.value || 0);
                                  });

                                  // Converted investors group by round_name
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
                                        total_pct: 0,
                                        total_value: 0,
                                      };
                                    }
                                    postConvGroups[key].items.push(i);
                                    postConvGroups[key].total_shares +=
                                      i.shares;
                                    postConvGroups[key].total_pct += parsePct(
                                      i.percentage_formatted,
                                    );
                                    // ✅ DB se value use karo
                                    postConvGroups[key].total_value +=
                                      parseFloat(i.value || 0);
                                  });

                                  // Current (new) investors group by round_name
                                  const postCurrGroups = {};
                                  postCurrInv.forEach((i) => {
                                    const key = i.round_name || "New Investors";
                                    if (!postCurrGroups[key]) {
                                      postCurrGroups[key] = {
                                        round_name: key,
                                        round_id_ref: i.round_id_ref,
                                        items: [],
                                        total_shares: 0,
                                        total_new_shares: 0,
                                        total_pct: 0,
                                        total_value: 0,
                                      };
                                    }
                                    postCurrGroups[key].items.push(i);
                                    postCurrGroups[key].total_shares +=
                                      i.shares;
                                    postCurrGroups[key].total_new_shares +=
                                      i.new_shares || i.shares;
                                    postCurrGroups[key].total_pct += parsePct(
                                      i.percentage_formatted,
                                    );
                                    postCurrGroups[key].total_value +=
                                      parseFloat(i.value || 0);
                                  });

                                  // ✅ Helper: group → item
                                  const buildGroupItem = (
                                    group,
                                    investorType,
                                  ) => ({
                                    type: "investor",
                                    investor_type: investorType,
                                    name: group.round_name,
                                    label: `${group.items.length} investor${group.items.length > 1 ? "s" : ""}`,
                                    round_id_ref: group.round_id_ref,
                                    shares: group.total_shares,
                                    // ✅ FIX: converted ke liye existing=0, new=total_shares
                                    existing_shares:
                                      investorType === "current" ||
                                      investorType === "converted"
                                        ? 0
                                        : group.total_shares,
                                    new_shares:
                                      investorType === "current" ||
                                      investorType === "converted"
                                        ? group.total_shares
                                        : 0,
                                    total_shares: group.total_shares,
                                    shares_formatted: fmt(group.total_shares),
                                    percentage: group.total_pct,
                                    percentage_formatted: pct(group.total_pct),
                                    value: group.total_value,
                                    value_formatted: money(group.total_value),
                                    is_previous: investorType === "previous",
                                    is_new_investment:
                                      investorType === "current",
                                    is_converted: investorType === "converted",
                                    investor_details: group.items.map((i) => ({
                                      type: "investor",
                                      investor_type: investorType,
                                      name: `${i.first_name || ""} ${i.last_name || ""}`.trim(),
                                      email: i.email,
                                      phone: i.phone,
                                      shares: i.shares,
                                      // ✅ FIX: converted ke liye existing=0, new=shares
                                      existing_shares:
                                        investorType === "current" ||
                                        investorType === "converted"
                                          ? 0
                                          : i.shares,
                                      new_shares:
                                        investorType === "current" ||
                                        investorType === "converted"
                                          ? i.new_shares || i.shares
                                          : 0,
                                      shares_formatted: fmt(i.shares),
                                      percentage: parsePct(
                                        i.percentage_formatted,
                                      ),
                                      percentage_formatted: pct(
                                        parsePct(i.percentage_formatted),
                                      ),
                                      value: parseFloat(i.value || 0),
                                      value_formatted: money(i.value),
                                      investment_amount: parseFloat(
                                        i.investment_amount || 0,
                                      ),
                                      share_price: parseFloat(
                                        i.share_price || 0,
                                      ),
                                      share_class_type: i.share_class_type,
                                      instrument_type: i.instrument_type,
                                      round_name: i.round_name,
                                      round_id_ref: i.round_id_ref,
                                      is_previous: investorType === "previous",
                                      is_new_investment:
                                        investorType === "current",
                                      is_converted:
                                        investorType === "converted",
                                      investor_details: parseDetails(
                                        i.investor_details,
                                      ),

                                      potential_shares:
                                        parseInt(i.potential_shares) || 0,
                                      conversion_price:
                                        parseFloat(i.conversion_price) || 0,
                                      discount_rate:
                                        parseFloat(i.discount_rate) || 0,
                                      valuation_cap:
                                        parseFloat(i.valuation_cap) || 0,
                                      interest_rate:
                                        parseFloat(i.interest_rate) || 0,
                                      years: parseFloat(i.years) || 0,
                                      interest_accrued:
                                        parseFloat(i.interest_accrued) || 0,
                                      total_conversion_amount:
                                        parseFloat(i.total_conversion_amount) ||
                                        parseFloat(i.investment_amount) ||
                                        0,
                                      maturity_date: i.maturity_date || null,
                                    })),
                                  });

                                  // ========== POST-MONEY CAP TABLE ==========
                                  const postMoneyCapTable = {
                                    total_shares: postTotalShares,
                                    post_money_valuation: postMoneyVal,
                                    currency,
                                    items: [
                                      ...postFounderItems,

                                      // Option Pool
                                      ...(postPool
                                        ? [
                                            {
                                              type: "option_pool",
                                              name: "Employee Option Pool",
                                              label: "Options Pool",
                                              existing_shares: postPoolExisting,
                                              new_shares: postPoolNew,
                                              shares: postPoolTotal,
                                              total_shares: postPoolTotal,
                                              shares_formatted:
                                                fmt(postPoolTotal),
                                              percentage: postPoolPct,
                                              percentage_formatted:
                                                pct(postPoolPct),
                                              value: postPoolValue,
                                              value_formatted:
                                                money(postPoolValue),
                                              is_option_pool: true,
                                              instrument_type:
                                                postPool.instrument_type ||
                                                "Options",
                                            },
                                          ]
                                        : []),

                                      // Previous investors — GROUPED
                                      ...Object.values(postPrevGroups).map(
                                        (g) => buildGroupItem(g, "previous"),
                                      ),

                                      // ✅ Converted investors — GROUPED (existing=0, new=shares)
                                      ...Object.values(postConvGroups).map(
                                        (g) => buildGroupItem(g, "converted"),
                                      ),

                                      // New (current) investors — GROUPED
                                      ...Object.values(postCurrGroups).map(
                                        (g) => buildGroupItem(g, "current"),
                                      ),

                                      // Pending items — grouped
                                      ...postPendingItems,
                                    ],
                                    totals: {
                                      total_shares: postTotalShares,
                                      total_shares_formatted:
                                        fmt(postTotalShares),
                                      total_new_shares: postTotalNewShares,
                                      total_new_shares_formatted:
                                        fmt(postTotalNewShares),
                                      total_founders: postTotalFounderShares,
                                      total_option_pool: postPoolTotal,
                                      total_investors:
                                        postPrevShares +
                                        postConvShares +
                                        postCurrShares,
                                      // ✅ FIX: postConvValue included
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
                                      instrument: currentRound.instrumentType,
                                      status: currentRound.roundStatus,
                                      date: currentRound.created_at,
                                      pre_money: currentRound.pre_money,
                                      post_money: currentRound.post_money,
                                      investment: currentRound.roundsize,
                                      currency: currentRound.currency,
                                      share_price: currentRound.share_price,
                                      round_target_money:
                                        currentRound.round_target_money,
                                      issued_shares: currentRound.issuedshares,
                                      option_pool_percent:
                                        currentRound.optionPoolPercent,
                                      option_pool_percent_post:
                                        currentRound.optionPoolPercent_post,
                                      investor_post_money:
                                        currentRound.investorPostMoney,
                                    },
                                    cap_table: {
                                      pre_money: preMoneyCapTable,
                                      post_money: postMoneyCapTable,
                                    },
                                    calculations: {
                                      pre_money_valuation: preMoneyVal,
                                      post_money_valuation: postMoneyVal,
                                      total_shares_outstanding: postTotalShares,
                                      fully_diluted_shares: postTotalShares,
                                      share_price:
                                        parseFloat(currentRound.share_price) ||
                                        0,
                                      total_new_shares: postTotalNewShares,
                                      total_investors:
                                        postPrevShares +
                                        postConvShares +
                                        postCurrShares,
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
