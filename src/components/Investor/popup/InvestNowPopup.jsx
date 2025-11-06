import { FaEye } from "react-icons/fa";
import { IoCloseCircleOutline } from "react-icons/io5";
import { ModalContainer } from "../../Styles/DataRoomStyle.js";
import React, { useState, useEffect } from "react";
import { NumericFormat } from "react-number-format";
import axios from "axios";

const InvestNowPopup = ({ onClose, records, nextround, nextRoundData }) => {
  const capitalizeFirstLetter = (str) => {
    if (!str) return "";
    return str.charAt(0).toUpperCase() + str.slice(1);
  };

  const storedUsername = localStorage.getItem("InvestorData");
  const userLogin = JSON.parse(storedUsername);
  const [investment, setInvestment] = useState("");
  const [shares, setShares] = useState(0);
  const [Ownership, setOwnership] = useState(0);
  const [submitted, setSubmitted] = useState(null);
  const [totalAllocatedShares, settotalAllocatedShares] = useState("0");
  const [successmessage, setSuccessmessage] = useState("");
  const [warrantShares, setWarrantShares] = useState(0);
  const [conversionDetails, setConversionDetails] = useState(null);
  const [errr, seterrr] = useState(false);

  var apiURL = "http://localhost:5000/api/user/investor/";
  const [formData, setFormData] = useState({});
  const [interestRate, setInterestRate] = useState(0);
  const [maturityMonths, setMaturityMonths] = useState(0);
  const [pricePerShare, setPricePerShare] = useState(0);
  const [liquidationPreference, setLiquidationPreference] = useState([]);

  useEffect(() => {
    getcheckInvestorStatus();
  }, []);

  const getcheckInvestorStatus = async () => {
    let formData = {
      investor_id: userLogin.id,
      company_id: records.company_id,
      roundrecord_id: records.id,
    };
    try {
      const res = await axios.post(
        apiURL + "getcheckInvestorStatus",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      if (res.data.result.length > 0) {
        var checkCode = res.data.result;
        seterrr(true);
        setSubmitted(String(checkCode[0].request_confirm));
      } else {
        setSubmitted(null);
        seterrr(false);
      }
    } catch (err) {
      console.error("Error fetching capital round data:", err);
      setSubmitted(null);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    let formDataa = {
      investor_id: userLogin.id,
      company_id: records.company_id,
      shares: parseFloat((Math.floor(shares * 100) / 100).toFixed(2)) || 0,
      created_by_id: records.created_by_id,
      roundrecord_id: records.id,
      next_round_id: nextRoundData?.id,
      investment_amount:
        parseFloat(String(investment).toString().replace(/,/g, "")) || 0,
    };

    try {
      const res = await axios.post(
        apiURL + "InvestorrequestToCompany",
        formDataa,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      setSubmitted("No");
      setSuccessmessage("Investment request submitted successfully!");

      setTimeout(() => {
        setSubmitted("No");
      }, 4500);
    } catch (err) {
      console.error("Error submitting investment:", err);
      setSubmitted(null);
    }
  };

  const getInstrumentData = () => {
    try {
      const data = records?.instrument_type_data;
      if (!data) return null;

      let parsedData = data;
      if (typeof parsedData === "string") {
        parsedData = JSON.parse(parsedData);
      }
      if (typeof parsedData === "string") {
        parsedData = JSON.parse(parsedData);
      }

      return parsedData;
    } catch (error) {
      console.error("Error parsing instrument data:", error);
      return null;
    }
  };

  const handleInvestmentChange = (e) => {
    let amount = parseFloat(e.target.value.replace(/,/g, "")) || 0;
    setInvestment(
      amount.toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );

    // Reset values
    setShares(0);
    setOwnership(0);
    setWarrantShares(0);
    setConversionDetails(null);

    if (amount === 0) return;

    // Get current round data
    const existingShares = parseFloat(records.issuedshares || 0);
    const roundSize = parseFloat(records.roundsize || 0);

    // 🟩 COMMON STOCK / PREFERRED EQUITY
    if (
      records.instrumentType === "Common Stock" ||
      records.instrumentType === "Preferred Equity"
    ) {
      if (existingShares > 0 && roundSize > 0) {
        // Formula: Share Price = Round Size ÷ Issued Shares
        const pricePerShare = roundSize / existingShares;

        // Formula: New Shares = Investment Amount ÷ Share Price
        const calculatedShares = amount / pricePerShare;
        setShares(Math.floor(calculatedShares * 100) / 100);

        // Formula: Ownership = New Shares ÷ (Outstanding Shares + New Shares)
        const postMoneyShares = existingShares + calculatedShares;
        const ownership = (calculatedShares / postMoneyShares) * 100;
        setOwnership(Number(ownership.toFixed(4)));

        // Check for warrants
        const instrumentData = getInstrumentData();
        if (instrumentData?.hasWarrants) {
          const exercisePrice = parseFloat(instrumentData.exercisePrice || 0);
          const warrantRatio = parseFloat(instrumentData.warrantRatio || 1);

          if (exercisePrice > 0) {
            const warrantSharesCalc = (amount / exercisePrice) * warrantRatio;
            setWarrantShares(Math.floor(warrantSharesCalc * 100) / 100);
          }
        }

        console.log(`Common/Preferred Calculation:
          Price Per Share: $${pricePerShare.toFixed(2)}
          Shares Issued: ${calculatedShares.toFixed(2)}
          Ownership: ${ownership.toFixed(4)}%
        `);
      }
    }

    // 🟨 SAFE CONVERSION
    else if (records.instrumentType === "Safe") {
      let safeData = getInstrumentData();
      if (!safeData) {
        console.error("Invalid SAFE data");
        return;
      }

      const valuationCap = parseFloat(safeData.valuationCap || 0);
      const discountRate = parseFloat(safeData.discountRate || 0);
      const safeType = safeData.safeType || "POST_MONEY";

      console.log(`SAFE Details:
        Investment: $${amount.toLocaleString()}
        Valuation Cap: $${valuationCap.toLocaleString()}
        Discount Rate: ${discountRate}%
        SAFE Type: ${safeType}
        Existing Shares: ${existingShares}
      `);

      let conversionPrice = 0;
      let calculatedShares = 0;
      let ownershipPercent = 0;
      let details = {};

      // Check if we have next round data
      if (nextround && nextRoundData) {
        const nextRoundShares = parseFloat(nextRoundData.issuedshares || 0);
        const nextRoundSize = parseFloat(nextRoundData.roundsize || 0);

        if (nextRoundShares > 0 && nextRoundSize > 0) {
          // Formula: Next Round Price = Next Round Size ÷ Next Round Shares
          const nextRoundPrice = nextRoundSize / nextRoundShares;

          // Formula: Cap Price = Valuation Cap ÷ Outstanding Shares
          const capPrice =
            valuationCap > 0 && existingShares > 0
              ? valuationCap / existingShares
              : Infinity;

          // Formula: Discount Price = Next Round Price × (1 - Discount Rate)
          const discountPrice =
            discountRate > 0
              ? nextRoundPrice * (1 - discountRate / 100)
              : Infinity;

          // Formula: Conversion Price = MIN(Next Round Price, Cap Price, Discount Price)
          conversionPrice = Math.min(nextRoundPrice, capPrice, discountPrice);

          details = {
            nextRoundPrice: nextRoundPrice.toFixed(2),
            capPrice: capPrice === Infinity ? "N/A" : capPrice.toFixed(2),
            discountPrice:
              discountPrice === Infinity ? "N/A" : discountPrice.toFixed(2),
            conversionPrice: conversionPrice.toFixed(2),
          };

          console.log(`SAFE Conversion with Next Round:
            Next Round Price: $${nextRoundPrice.toFixed(2)}
            Cap Price: $${capPrice === Infinity ? "N/A" : capPrice.toFixed(2)}
            Discount Price: $${discountPrice === Infinity ? "N/A" : discountPrice.toFixed(2)
            }
            Conversion Price: $${conversionPrice.toFixed(2)}
          `);
        }
      } else if (valuationCap > 0 && existingShares > 0) {
        // No next round - use valuation cap only
        conversionPrice = valuationCap / existingShares;
        details = {
          capPrice: conversionPrice.toFixed(2),
          conversionPrice: conversionPrice.toFixed(2),
        };
        console.log(
          `SAFE Conversion without Next Round (Cap only): $${conversionPrice.toFixed(
            2
          )}`
        );
      }

      if (conversionPrice > 0) {
        if (safeType === "POST_MONEY") {
          // POST-MONEY SAFE
          // Formula: Shares = SAFE Amount ÷ Conversion Price
          calculatedShares = amount / conversionPrice;

          // Formula: Ownership = (SAFE Amount ÷ Valuation Cap) × 100
          // In post-money SAFE, ownership is fixed based on cap
          if (valuationCap > 0) {
            ownershipPercent = (amount / valuationCap) * 100;
          } else {
            // Fallback if no cap
            const postMoneyShares = existingShares + calculatedShares;
            ownershipPercent = (calculatedShares / postMoneyShares) * 100;
          }

          console.log(`POST-MONEY SAFE:
            Shares Issued: ${calculatedShares.toFixed(2)}
            Ownership (Fixed): ${ownershipPercent.toFixed(4)}%
          `);
        } else if (safeType === "PRE_MONEY") {
          // PRE-MONEY SAFE
          // Formula: Post-Money Valuation = Valuation Cap + SAFE Amount
          const postMoneyValuation = valuationCap + amount;

          // Formula: Shares = (SAFE Amount ÷ Post-Money Valuation) × Total Outstanding Shares
          // This assumes conversion happens at current outstanding shares
          calculatedShares = amount / conversionPrice;

          // Formula: Ownership = SAFE Amount ÷ (Valuation Cap + SAFE Amount)
          ownershipPercent = (amount / postMoneyValuation) * 100;

          console.log(`PRE-MONEY SAFE:
            Post-Money Valuation: $${postMoneyValuation.toLocaleString()}
            Shares Issued: ${calculatedShares.toFixed(2)}
            Ownership: ${ownershipPercent.toFixed(4)}%
          `);
        }

        setShares(Number(calculatedShares.toFixed(2)));
        setOwnership(Number(ownershipPercent.toFixed(4)));
        setConversionDetails(details);
      }
    }

    // 🟧 CONVERTIBLE NOTE
    else if (records.instrumentType === "Convertible Note") {
      let noteData = getInstrumentData();
      if (!noteData) {
        console.error("Invalid Convertible Note data");
        return;
      }

      const valuationCap = parseFloat(noteData.valuationCap_note || 0);
      const discountRate = parseFloat(noteData.discountRate_note || 0);
      const interestRate = parseFloat(noteData.interestRate_note || 0) / 100;
      const principal = amount;

      // Formula: Interest = Principal × Interest Rate × Time Period (1 year)
      const interest = principal * interestRate * 1;

      // Formula: Maturity Amount = Principal + Interest
      const maturityAmount = principal + interest;

      console.log(`Convertible Note Details:
        Principal: $${principal.toLocaleString()}
        Interest Rate: ${(interestRate * 100).toFixed(2)}%
        Interest (1 year): $${interest.toLocaleString()}
        Maturity Amount: $${maturityAmount.toLocaleString()}
        Valuation Cap: $${valuationCap.toLocaleString()}
        Discount Rate: ${discountRate}%
      `);

      let details = {
        principal: principal.toFixed(2),
        interest: interest.toFixed(2),
        maturityAmount: maturityAmount.toFixed(2),
      };

      // Check if we have next round data
      if (nextround && nextRoundData) {
        const nextRoundShares = parseFloat(nextRoundData.issuedshares || 0);
        const nextRoundSize = parseFloat(nextRoundData.roundsize || 0);

        if (nextRoundShares > 0 && nextRoundSize > 0) {
          // Formula: Next Round Price = Next Round Size ÷ Next Round Shares
          const nextRoundPrice = nextRoundSize / nextRoundShares;

          // Formula: Cap Price = Valuation Cap ÷ Outstanding Shares
          const capPrice =
            valuationCap > 0 && existingShares > 0
              ? valuationCap / existingShares
              : Infinity;

          // Formula: Discount Price = Next Round Price × (1 - Discount Rate)
          const discountPrice =
            discountRate > 0
              ? nextRoundPrice * (1 - discountRate / 100)
              : Infinity;

          // Formula: Conversion Price = MIN(Cap Price, Discount Price)
          const conversionPrice = Math.min(capPrice, discountPrice);

          // Formula: Shares Issued = Maturity Amount ÷ Conversion Price
          const calculatedShares = maturityAmount / conversionPrice;

          // Formula: Ownership = Shares Issued ÷ (Outstanding Shares + Shares Issued)
          const postMoneyShares = existingShares + calculatedShares;
          const ownershipPercent = (calculatedShares / postMoneyShares) * 100;

          setShares(Number(calculatedShares.toFixed(2)));
          setOwnership(Number(ownershipPercent.toFixed(4)));

          details = {
            ...details,
            nextRoundPrice: nextRoundPrice.toFixed(2),
            capPrice: capPrice === Infinity ? "N/A" : capPrice.toFixed(2),
            discountPrice:
              discountPrice === Infinity ? "N/A" : discountPrice.toFixed(2),
            conversionPrice: conversionPrice.toFixed(2),
          };

          console.log(`Convertible Note Conversion:
            Next Round Price: $${nextRoundPrice.toFixed(2)}
            Cap Price: $${capPrice === Infinity ? "N/A" : capPrice.toFixed(2)}
            Discount Price: $${discountPrice === Infinity ? "N/A" : discountPrice.toFixed(2)
            }
            Conversion Price: $${conversionPrice.toFixed(2)}
            Shares Issued: ${calculatedShares.toFixed(2)}
            Ownership: ${ownershipPercent.toFixed(4)}%
          `);
        }
      } else if (valuationCap > 0 && existingShares > 0) {
        // No next round - use valuation cap only
        const conversionPrice = valuationCap / existingShares;
        const calculatedShares = maturityAmount / conversionPrice;
        const postMoneyShares = existingShares + calculatedShares;
        const ownershipPercent = (calculatedShares / postMoneyShares) * 100;

        setShares(Number(calculatedShares.toFixed(2)));
        setOwnership(Number(ownershipPercent.toFixed(4)));

        details = {
          ...details,
          capPrice: conversionPrice.toFixed(2),
          conversionPrice: conversionPrice.toFixed(2),
        };
      }

      setConversionDetails(details);
    }

    // 🟥 VENTURE/BANK DEBT
    else if (records.instrumentType === "Venture/Bank DEBT") {
      // Debt doesn't create shares or ownership
      setShares(0);
      setOwnership(0);

      // Calculate warrants if applicable
      const instrumentData = getInstrumentData();
      if (instrumentData?.hasWarrants_Bank) {
        const exercisePrice = parseFloat(
          instrumentData.exercisePrice_bank || 0
        );
        const warrantRatio = parseFloat(instrumentData.warrantRatio_bank || 1);

        if (exercisePrice > 0) {
          // Formula: Warrant Shares = (Investment Amount ÷ Exercise Price) × Warrant Ratio
          const warrantSharesCalc = (amount / exercisePrice) * warrantRatio;
          setWarrantShares(Math.floor(warrantSharesCalc * 100) / 100);

          // Formula: Potential Dilution = Warrant Shares ÷ (Outstanding Shares + Warrant Shares)
          const potentialDilution =
            (warrantSharesCalc / (existingShares + warrantSharesCalc)) * 100;

          console.log(`Venture Debt with Warrants:
            Exercise Price: $${exercisePrice.toFixed(2)}
            Warrant Ratio: ${warrantRatio}
            Warrant Shares: ${warrantSharesCalc.toFixed(2)}
            Potential Dilution: ${potentialDilution.toFixed(4)}%
          `);
        }
      }
    }
  };

  useEffect(() => {
    if (!records) return;

    let instrumentData = getInstrumentData();
    if (typeof instrumentData === "string") {
      instrumentData = JSON.parse(instrumentData);
    }

    // ✅ Liquidation Preference Parsing (Fixed)
    if (records.liquidation) {
      try {
        let liquidationData = records.liquidation;

        // If it's a JSON string (rare case)
        if (
          typeof liquidationData === "string" &&
          liquidationData.startsWith("[")
        ) {
          liquidationData = JSON.parse(liquidationData);
        }
        // If it's comma-separated values
        else if (typeof liquidationData === "string") {
          liquidationData = liquidationData
            .split(",")
            .map((item) => item.trim())
            .filter((i) => i.length > 0);
        }

        // Ensure it's always an array
        setLiquidationPreference(
          Array.isArray(liquidationData) ? liquidationData : [liquidationData]
        );
      } catch (e) {
        console.error("Error parsing liquidation data:", e);
        setLiquidationPreference([]);
      }
    }

    switch (records.instrumentType) {
      case "Common Stock":
      case "Preferred Equity":
        const existingShares = parseFloat(records.issuedshares || 0);
        const roundSize = parseFloat(records.roundsize || 0);
        if (existingShares > 0 && roundSize > 0) {
          setPricePerShare(roundSize / existingShares);
        }
        setFormData({
          ...instrumentData,
          hasWarrants: instrumentData?.hasWarrants || false,
        });
        break;

      case "Safe":
      case "Convertible Note":
        setFormData({ ...instrumentData });
        break;

      case "Venture/Bank DEBT":
        setInterestRate(parseFloat(instrumentData?.interestRate) || 0);
        setMaturityMonths(parseInt(instrumentData?.repaymentSchedule) || 12);
        setFormData({
          ...instrumentData,
          hasWarrants_Bank: instrumentData?.hasWarrants_Bank || false,
        });
        break;

      default:
        break;
    }
  }, [records]);

  const colors = {
    primary: "#F63C3F",
    primaryHover: "#D42C2F",
    primaryLight: "#FEEBEB",
    success: "#10B981",
    successLight: "#ECFDF5",
    info: "#3B82F6",
    infoLight: "#EFF6FF",
    textDark: "#1F2937",
    textSecondary: "#6B7280",
    border: "#E5E7EB",
    background: "#F9FAFB",
  };
  if (!records) return null;

  return (
    <div
      className="main_popup-overlay"
      style={{
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <ModalContainer
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          padding: "24px",
          maxWidth: "600px",
          width: "90%",
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow:
            "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
        }}
      >
        <div className="previous-section-summary mb-4 p-4 bg-white border rounded-3 shadow-sm">
          <div className="d-flex align-items-center mb-3 pb-2 border-bottom">
            <div className="d-flex align-items-center justify-content-between gap-3 w-100">
              <h3
                className="mb-0 fw-semibold"
                style={{ color: colors.textDark }}
              >
                Invest Now
              </h3>
              <button
                type="button"
                className="bg-transparent p-1 border-0"
                onClick={onClose}
                style={{ color: colors.textSecondary }}
              >
                <IoCloseCircleOutline size={24} />
              </button>
            </div>
          </div>

          <div className="row g-3">
            <div className="col-md-12">
              <div
                className="p-4 rounded-3 h-100"
                style={{
                  backgroundColor: colors.primaryLight,
                  border: `1px solid ${colors.border}`,
                }}
              >
                <span
                  className="small fw-semibold text-uppercase"
                  style={{ color: colors.textSecondary }}
                >
                  Investment Details
                </span>

                {/* Display Liquidation Preference Information */}
                {liquidationPreference.length > 0 &&
                  !liquidationPreference.includes("N/A") &&
                  (records.instrumentType === "Preferred Equity" ||
                    records.instrumentType === "Common Stock" ||
                    records.instrumentType === "Venture/Bank DEBT") && (
                    <div
                      className="alert mt-3"
                      style={{
                        backgroundColor: "#FEF3C7",
                        border: "1px solid #F59E0B",
                        borderRadius: "8px",
                        padding: "12px",
                      }}
                    >
                      <div className="d-flex align-items-start">
                        <div className="flex-shrink-0 me-2">
                          <svg
                            width="20"
                            height="20"
                            fill="#F59E0B"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </div>
                        <div className="flex-grow-1">
                          <strong style={{ color: "#92400E" }}>
                            Liquidation Preference:
                          </strong>
                          <div className="mt-1" style={{ color: "#78350F" }}>
                            {liquidationPreference.map((pref, index) => (
                              <div key={index} className="mb-1">
                                • {pref}
                              </div>
                            ))}
                          </div>
                          <small
                            className="d-block mt-2"
                            style={{ color: "#78350F" }}
                          >
                            {liquidationPreference.includes(
                              "Non-Participating"
                            ) &&
                              "You will receive either the liquidation preference or common stock value, whichever is higher."}
                            {liquidationPreference.includes("Participating") &&
                              "You will receive the liquidation preference plus pro-rata participation with common shareholders."}
                            {liquidationPreference.includes(
                              "Capped Participating"
                            ) &&
                              "Your total return is capped at a defined multiple of your investment."}
                            {liquidationPreference.some((p) =>
                              p.includes("1x")
                            ) &&
                              "You will receive 1x your investment before common shareholders."}
                            {liquidationPreference.some((p) =>
                              p.includes("2x")
                            ) &&
                              "You will receive 2x your investment before common shareholders."}
                            {liquidationPreference.some((p) =>
                              p.includes("3x")
                            ) &&
                              "You will receive 3x your investment before common shareholders."}
                            {liquidationPreference.includes("Senior Debt") &&
                              "This debt takes priority in repayment over other debts."}
                            {liquidationPreference.includes("Common Debt") &&
                              "This debt has secondary priority after senior debts."}
                          </small>
                        </div>
                      </div>
                    </div>
                  )}

                {submitted === "No" && (
                  <div
                    className="alert mt-3"
                    style={{
                      backgroundColor: colors.successLight,
                      border: `1px solid ${colors.success}`,
                      color: colors.success,
                      borderRadius: "8px",
                      padding: "16px",
                    }}
                  >
                    <strong>Investment Submitted Successfully!</strong>
                  </div>
                )}

                {submitted === "Yes" && (
                  <div
                    className="alert mt-3"
                    style={{
                      backgroundColor: colors.infoLight,
                      border: `1px solid ${colors.info}`,
                      color: colors.info,
                      borderRadius: "8px",
                      padding: "16px",
                    }}
                  >
                    <strong>Your Request Has Been Confirmed!</strong>
                  </div>
                )}

                {submitted === null && (
                  <form onSubmit={handleSubmit} className="mt-3">
                    <div className="form-group mb-4">
                      <label
                        className="form-label fw-semibold mb-2"
                        style={{ color: colors.textDark }}
                      >
                        Enter Investment Amount ($)
                      </label>
                      <NumericFormat
                        thousandSeparator
                        decimalScale={2}
                        fixedDecimalScale
                        allowNegative={false}
                        placeholder="Enter amount"
                        value={investment}
                        className="form-control"
                        onChange={handleInvestmentChange}
                      />
                    </div>

                    {/* Common Stock / Preferred Equity */}
                    {(records.instrumentType === "Common Stock" ||
                      records.instrumentType === "Preferred Equity") && (
                        <>
                          <div className="form-group mb-4">
                            <label className="form-label fw-semibold mb-2">
                              Price Per Share
                            </label>
                            <div
                              className="form-control-plaintext fw-bold"
                              style={{ color: colors.primary, fontSize: "18px" }}
                            >
                              ${pricePerShare.toFixed(2)}
                            </div>
                          </div>
                          <div className="form-group mb-4">
                            <label className="form-label fw-semibold mb-2">
                              Shares You Will Receive
                            </label>
                            <div
                              className="form-control-plaintext fw-bold"
                              style={{
                                color: colors.primary,
                                fontSize: "18px",
                                backgroundColor: "white",
                                padding: "12px",
                                borderRadius: "8px",
                                border: `1px solid ${colors.border}`,
                              }}
                            >
                              {shares.toLocaleString()} shares
                            </div>
                          </div>
                          <div className="form-group mb-4">
                            <label className="form-label fw-semibold mb-2">
                              Ownership Percentage
                            </label>
                            <div
                              className="form-control-plaintext fw-bold"
                              style={{
                                color: colors.info,
                                fontSize: "18px",
                                backgroundColor: "white",
                                padding: "12px",
                                borderRadius: "8px",
                                border: `1px solid ${colors.border}`,
                              }}
                            >
                              {Ownership}%
                            </div>
                          </div>

                          {/* Show liquidation calculation for Preferred Equity */}
                          {records.instrumentType === "Preferred Equity" &&
                            liquidationPreference.length > 0 &&
                            !liquidationPreference.includes("N/A") &&
                            investment &&
                            parseFloat(investment.replace(/,/g, "")) > 0 && (
                              <div
                                className="alert mb-4"
                                style={{
                                  backgroundColor: colors.infoLight,
                                  border: `1px solid ${colors.info}`,
                                  borderRadius: "8px",
                                  padding: "12px",
                                }}
                              >
                                <strong style={{ color: colors.info }}>
                                  Liquidation Scenario:
                                </strong>
                                <div
                                  className="mt-2"
                                  style={{ color: colors.textDark }}
                                >
                                  {liquidationPreference.some((p) =>
                                    p.includes("1x")
                                  ) && (
                                      <div>
                                        Minimum return on exit: $
                                        {(
                                          parseFloat(investment.replace(/,/g, "")) *
                                          1
                                        ).toLocaleString()}
                                      </div>
                                    )}
                                  {liquidationPreference.some((p) =>
                                    p.includes("2x")
                                  ) && (
                                      <div>
                                        Minimum return on exit: $
                                        {(
                                          parseFloat(investment.replace(/,/g, "")) *
                                          2
                                        ).toLocaleString()}
                                      </div>
                                    )}
                                  {liquidationPreference.some((p) =>
                                    p.includes("3x")
                                  ) && (
                                      <div>
                                        Minimum return on exit: $
                                        {(
                                          parseFloat(investment.replace(/,/g, "")) *
                                          3
                                        ).toLocaleString()}
                                      </div>
                                    )}
                                </div>
                              </div>
                            )}

                          {formData.hasWarrants && warrantShares > 0 && (
                            <div className="form-group mb-4">
                              <label className="form-label fw-semibold mb-2">
                                Potential Warrant Shares
                              </label>
                              <div className="form-control-plaintext fw-bold">
                                {warrantShares.toLocaleString()} shares
                              </div>
                            </div>
                          )}
                        </>
                      )}

                    {/* Venture/Bank Debt */}
                    {records.instrumentType === "Venture/Bank DEBT" && (
                      <>
                        <div className="form-group mb-4">
                          <label className="form-label fw-semibold mb-2">
                            Interest Rate
                          </label>
                          <div className="form-control-plaintext fw-bold">
                            {interestRate}% per year
                          </div>
                        </div>
                        <div className="form-group mb-4">
                          <label className="form-label fw-semibold mb-2">
                            Repayment Schedule
                          </label>
                          <div className="form-control-plaintext fw-bold">
                            {maturityMonths} months
                          </div>
                        </div>

                        {/* Show debt repayment calculation */}
                        {investment &&
                          parseFloat(investment.replace(/,/g, "")) > 0 && (
                            <div
                              className="alert mb-4"
                              style={{
                                backgroundColor: colors.infoLight,
                                border: `1px solid ${colors.info}`,
                                borderRadius: "8px",
                                padding: "12px",
                              }}
                            >
                              <strong style={{ color: colors.info }}>
                                Expected Return:
                              </strong>
                              <div
                                className="mt-2"
                                style={{ color: colors.textDark }}
                              >
                                <div>
                                  Principal: $
                                  {parseFloat(
                                    investment.replace(/,/g, "")
                                  ).toLocaleString()}
                                </div>
                                <div>
                                  Interest ({interestRate}%): $
                                  {(
                                    ((parseFloat(investment.replace(/,/g, "")) *
                                      interestRate) /
                                      100) *
                                    (maturityMonths / 12)
                                  ).toLocaleString()}
                                </div>
                                <div className="fw-bold mt-1">
                                  Total Repayment: $
                                  {(
                                    parseFloat(investment.replace(/,/g, "")) *
                                    (1 +
                                      (interestRate / 100) *
                                      (maturityMonths / 12))
                                  ).toLocaleString()}
                                </div>
                              </div>
                            </div>
                          )}

                        {formData.hasWarrants_Bank && warrantShares > 0 && (
                          <div className="form-group mb-4">
                            <label className="form-label fw-semibold mb-2">
                              Potential Warrant Shares
                            </label>
                            <div
                              className="form-control-plaintext fw-bold"
                              style={{
                                color: colors.info,
                                fontSize: "18px",
                                backgroundColor: "white",
                                padding: "12px",
                                borderRadius: "8px",
                                border: `1px solid ${colors.border}`,
                              }}
                            >
                              {warrantShares.toLocaleString()} shares
                            </div>
                          </div>
                        )}
                      </>
                    )}

                    {/* SAFE */}
                    {records.instrumentType === "Safe" && (
                      <>
                        <div className="form-group mb-3">
                          <label className="form-label fw-semibold">
                            SAFE Type
                          </label>
                          <div className="form-control-plaintext">
                            {formData.safeType === "POST_MONEY"
                              ? "Post-Money SAFE"
                              : "Pre-Money SAFE"}
                          </div>
                        </div>
                        <div className="form-group mb-3">
                          <label className="form-label fw-semibold">
                            Estimated Shares at Conversion
                          </label>
                          <div
                            className="form-control-plaintext fw-bold"
                            style={{
                              color: colors.primary,
                              fontSize: "18px",
                              backgroundColor: "white",
                              padding: "12px",
                              borderRadius: "8px",
                              border: `1px solid ${colors.border}`,
                            }}
                          >
                            {shares.toLocaleString()} shares
                          </div>
                        </div>
                        <div className="form-group mb-3">
                          <label className="form-label fw-semibold">
                            Estimated Ownership
                          </label>
                          <div
                            className="form-control-plaintext fw-bold"
                            style={{
                              color: colors.info,
                              fontSize: "18px",
                              backgroundColor: "white",
                              padding: "12px",
                              borderRadius: "8px",
                              border: `1px solid ${colors.border}`,
                            }}
                          >
                            {Ownership}%
                          </div>
                        </div>
                        {conversionDetails && (
                          <div className="alert alert-info mt-3">
                            <small>
                              <strong>Conversion Details:</strong>
                              <br />
                              {conversionDetails.conversionPrice &&
                                `Conversion Price: $${conversionDetails.conversionPrice}`}
                            </small>
                          </div>
                        )}
                      </>
                    )}

                    {/* Convertible Note */}
                    {records.instrumentType === "Convertible Note" && (
                      <>
                        <div className="form-group mb-3">
                          <label className="form-label fw-semibold">
                            Principal Amount
                          </label>
                          <div className="form-control-plaintext fw-bold">
                            $
                            {parseFloat(
                              investment.replace(/,/g, "") || 0
                            ).toLocaleString()}
                          </div>
                        </div>
                        {conversionDetails && (
                          <>
                            <div className="form-group mb-3">
                              <label className="form-label fw-semibold">
                                Interest Accrued (1 year)
                              </label>
                              <div className="form-control-plaintext fw-bold">
                                $
                                {parseFloat(
                                  conversionDetails.interest || 0
                                ).toLocaleString()}
                              </div>
                            </div>
                            <div className="form-group mb-3">
                              <label className="form-label fw-semibold">
                                Total Maturity Amount
                              </label>
                              <div
                                className="form-control-plaintext fw-bold"
                                style={{ color: colors.primary }}
                              >
                                $
                                {parseFloat(
                                  conversionDetails.maturityAmount || 0
                                ).toLocaleString()}
                              </div>
                            </div>
                          </>
                        )}
                        <div className="form-group mb-3">
                          <label className="form-label fw-semibold">
                            Estimated Shares at Conversion
                          </label>
                          <div
                            className="form-control-plaintext fw-bold"
                            style={{
                              color: colors.primary,
                              fontSize: "18px",
                              backgroundColor: "white",
                              padding: "12px",
                              borderRadius: "8px",
                              border: `1px solid ${colors.border}`,
                            }}
                          >
                            {shares.toLocaleString()} shares
                          </div>
                        </div>
                        <div className="form-group mb-3">
                          <label className="form-label fw-semibold">
                            Estimated Ownership
                          </label>
                          <div
                            className="form-control-plaintext fw-bold"
                            style={{
                              color: colors.info,
                              fontSize: "18px",
                              backgroundColor: "white",
                              padding: "12px",
                              borderRadius: "8px",
                              border: `1px solid ${colors.border}`,
                            }}
                          >
                            {Ownership}%
                          </div>
                        </div>
                        {conversionDetails &&
                          conversionDetails.conversionPrice && (
                            <div className="alert alert-info mt-3">
                              <small>
                                <strong>Conversion Details:</strong>
                                <br />
                                Conversion Price: $
                                {conversionDetails.conversionPrice}
                                {conversionDetails.nextRoundPrice && (
                                  <>
                                    <br />
                                    Next Round Price: $
                                    {conversionDetails.nextRoundPrice}
                                  </>
                                )}
                              </small>
                            </div>
                          )}
                      </>
                    )}

                    {/* General note for SAFE and Convertible Notes */}
                    {(records.instrumentType === "Safe" ||
                      records.instrumentType === "Convertible Note") && (
                        <div className="alert alert-warning mt-3">
                          <small>
                            <strong>Note:</strong> Shares and ownership shown are
                            estimates based on
                            {nextround && nextRoundData
                              ? " the next funding round"
                              : " the valuation cap"}
                            . Actual conversion will depend on the terms of the
                            qualifying financing event.
                          </small>
                        </div>
                      )}

                    <button
                      type="submit"
                      className="btn w-100 mt-2 fw-semibold"
                      style={{
                        backgroundColor: colors.primary,
                        color: "white",
                        border: "none",
                        padding: "12px 24px",
                        borderRadius: "8px",
                        fontSize: "16px",
                      }}
                    >
                      Confirm Investment
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        </div>
      </ModalContainer>
    </div>
  );
};

export default InvestNowPopup;
