import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin/TopBar";
import { useNavigate, Link, useParams } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import axios from "axios";
import { Pie, Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from "chart.js";
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  ArcElement,
  Title,
  Tooltip,
  Legend
);
function AdminCompanyCaptable() {
  const navigate = useNavigate();
  const [successMessage, setsuccessMessage] = useState("");
  const { id } = useParams();
  const apiUrl = "http://localhost:5000/api/admin/company/";
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(true);

  document.title = "Company Cap Table - Admin";

  useEffect(() => {
    getUsercompnayInfo();
  }, []);

  const getUsercompnayInfo = async () => {
    let formData = {
      company_id: id,
    };

    try {
      setLoading(true);
      const res = await axios.post(apiUrl + "getUsercompnayInfo", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      const respo = res.data.results;
      setRecords(respo);
    } catch (err) {
      if (err.response) {
        console.error("Response error:", err.response.data);
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  const [CompanyDatashare, setCompanyDatashare] = useState("");
  const [CompanyData, setCompanyData] = useState("");
  const [Companyroundopen, setCompanyroundopen] = useState({
    round_type: "",
    target_raise: 0,
    raised_to_date: 0,
    expected_close: "",
    fundraising_progress: "0%",
    progresswidth: 0,
    currency: "USD",
    remaining_amount: 0,
    total_investors: 0,
  });

  const [investorStakesPercent, setInvestorStakesPercent] = useState("0");
  const [optionpoolLastestvalue, setoptionpoolLastestvalue] = useState({
    option_pool: {
      total_option_pool_percentage: 0,
      total_option_pool_shares: 0,
      available_percentage: 0,
      allocated_percentage: 0,
    },
    latest_valuation: {
      valuation_amount: 0,
      currency: "",
      price_per_share: 0,
      total_company_shares: 0,
    },
    summary: {
      total_company_shares: 0,
      latest_valuation: 0,
      option_pool_percentage: 0,
    },
  });
  const [countrySymbolList, setCountrysymbollist] = useState([]);
  const [error, setError] = useState("");
  const [CompanyName, setCompanyName] = useState("");
  const [dilutionData, setDilutionforcastData] = useState({
    labels: [],
    datasets: [],
  });
  const [shareholderData, setShareholderData] = useState({
    labels: [],
    datasets: [
      {
        data: [],
        backgroundColor: [],
        borderColor: "#ffffff",
        borderWidth: 2,
        hoverBorderWidth: 3,
        hoverOffset: 10,
      },
    ],
  });
  const [TotalInvestors, setTotalInvestors] = useState("");
  const [shareholderLoading, setShareholderLoading] = useState(false);
  const [shareholderError, setShareholderError] = useState(null);
  const apiUrlRound = "http://localhost:5000/api/user/capitalround/";
  const apiURLDashboard = "http://localhost:5000/api/user/dashboard/";
  const shareholderOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          usePointStyle: true,
          pointStyle: "circle",
          padding: 15,
          font: {
            size: 11,
            weight: "500",
          },
          generateLabels: function (chart) {
            const data = chart.data;
            if (data.labels.length && data.datasets.length) {
              return data.labels.map((label, i) => ({
                text: `${label}: ${data.datasets[0].data[i]}%`,
                fillStyle: data.datasets[0].backgroundColor[i],
                strokeStyle: data.datasets[0].borderColor,
                lineWidth: data.datasets[0].borderWidth,
                hidden:
                  isNaN(data.datasets[0].data[i]) ||
                  data.datasets[0].data[i] === 0,
                index: i,
              }));
            }
            return [];
          },
        },
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            const label = context.label || "";
            const value = context.parsed; // already percentage
            return `${label}: ${value}%`;
          },
        },
        backgroundColor: "rgba(0,0,0,0.8)",
        titleColor: "#fff",
        bodyColor: "#fff",
        borderColor: "rgba(255,255,255,0.2)",
        borderWidth: 1,
        cornerRadius: 8,
        displayColors: true,
        usePointStyle: true,
      },

      datalabels: {
        display: function (context) {
          return context.parsed > 5; // Only show labels for slices > 5%
        },
        color: "#ffffff",
        font: {
          weight: "bold",
          size: 10,
        },
        formatter: function (value) {
          return value + "%";
        },
      },
    },
    elements: {
      arc: {
        borderWidth: 2,
        hoverBorderWidth: 3,
      },
    },
    animation: {
      animateRotate: true,
      animateScale: true,
      duration: 1000,
      easing: "easeInOutQuart",
    },
    interaction: {
      intersect: false,
      mode: "nearest",
    },
  };
  function formatCurrentDateTime(input) {
    const date = new Date(input);

    if (isNaN(date)) return "";

    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();

    const getOrdinal = (n) => {
      if (n >= 11 && n <= 13) return "th";
      switch (n % 10) {
        case 1:
          return "st";
        case 2:
          return "nd";
        case 3:
          return "rd";
        default:
          return "th";
      }
    };

    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const seconds = date.getSeconds().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";

    hours = hours % 12;
    hours = hours ? hours : 12; // 0 => 12

    return `${month} ${day}${getOrdinal(
      day
    )}, ${year} ${hours}:${minutes} ${ampm}`;
  }
  useEffect(() => {
    getallcountrySymbolList();
    getCompanystokes();
  }, []);
  const getallcountrySymbolList = async () => {
    let formData = {
      id: "",
    };
    try {
      const res = await axios.post(
        apiUrlRound + "getallcountrySymbolList",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );

      var respo = res.data.results;

      setCountrysymbollist(respo);
    } catch (err) {
      // Enhanced error handling
    }
  };
  useEffect(() => {
    if (CompanyDatashare && CompanyDatashare.length > 0) {
      let cumulativeTotalShares = 0;
      let cumulativeInvestorShares = 0;

      CompanyDatashare.forEach((round) => {
        const totalShares = parseFloat(round.total_issued_shares || 0);
        const founderShares = parseFloat(round.founder_shares || 0);

        cumulativeTotalShares += totalShares;
        cumulativeInvestorShares += totalShares - founderShares;
      });

      // Use rounding to avoid floating-point issues
      const investorStakesPercent =
        cumulativeTotalShares > 0
          ? Math.round(
            (cumulativeInvestorShares / cumulativeTotalShares) * 10000
          ) / 100
          : 0;

      setInvestorStakesPercent(investorStakesPercent.toFixed(2));

      // Optional: log rounded values
      // console.log("Cumulative Total Shares:", cumulativeTotalShares.toFixed(2));
      // console.log(
      //   "Cumulative Investor Shares:",
      //   cumulativeInvestorShares.toFixed(2)
      // );
      // console.log("Investor Stake %:", investorStakesPercent.toFixed(2));
    }
  }, [CompanyDatashare]);

  const getCompanystokes = async () => {
    const formData = {
      company_id: id,
    };
    try {
      const respo = await axios.post(
        apiURLDashboard + "getCompanystokes",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      if (respo.data.results.length > 0) {
        var dataa = respo.data.results;
        //console.log(dataa);
        setCompanyDatashare(dataa);
      }
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };
  useEffect(() => {
    getCompanyTotalShares();
    getCompanyOptionPoolLastestValuation();
    getShareholder();
    getCompanyopenround();
    getDilutionForecast();
  }, []);
  const getDilutionForecast = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await axios.post(
        apiURLDashboard + "getDilutionForecast",
        {
          company_id: id,
        }
      );

      if (response.data && response.data.labels) {
        setDilutionforcastData({
          labels: response.data.labels,
          datasets: response.data.datasets,
        });
      } else {
        setError("No dilution data available");
      }
    } catch (err) {
      console.error("Error generating dilution forecast:", err);
      setError("Failed to load dilution forecast");
    } finally {
      setLoading(false);
    }
  };
  const getCompanyopenround = async () => {
    const formData = {
      company_id: id,
    };
    try {
      const respo = await axios.post(
        apiURLDashboard + "getCompanyopenround",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      if (respo.data && respo.data.success) {
        const openroundData = respo.data.roundInfo;
        setCompanyroundopen(openroundData);
      } else {
        setError("No active round found");
        console.error("API Error:", respo.data.message);
      }
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };
  const [ownershipTable, setOwnershipTable] = useState([]);

  // Update getShareholder function
  const getShareholder = async () => {
    setShareholderLoading(true);
    setShareholderError(null);

    const formData = {
      company_id: id,
    };

    try {
      const response = await axios.post(
        apiURLDashboard + "getShareholder",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      if (response.data && response.data.shareholders) {
        const { labels, data, colors } = response.data.shareholders;

        // Filter out zero values
        const filteredData = [];
        const filteredLabels = [];
        const filteredColors = [];

        labels.forEach((label, index) => {
          if (data[index] > 0) {
            filteredLabels.push(label);
            filteredData.push(parseFloat(data[index]));
            filteredColors.push(colors[index]);
          }
        });

        const chartData = {
          labels: filteredLabels,
          datasets: [
            {
              data: filteredData,
              backgroundColor: filteredColors,
              borderColor: "#ffffff",
              borderWidth: 2,
              hoverBorderWidth: 3,
              hoverOffset: 10,
              hoverBackgroundColor: filteredColors.map((color) => color + "CC"),
            },
          ],
        };

        setShareholderData(chartData);
        setOwnershipTable(response.data.ownershipTable || []); // NEW
        setShareholderError(null);
      } else {
        setShareholderError("No shareholder data available");
      }
    } catch (err) {
      console.error("Error fetching shareholder data:", err);
      const errorMessage =
        err.response?.data?.error ||
        err.response?.data?.message ||
        "Failed to load shareholder breakdown";
      setShareholderError(errorMessage);
    } finally {
      setShareholderLoading(false);
    }
  };
  const getCompanyOptionPoolLastestValuation = async () => {
    const formData = {
      company_id: id,
    };
    setLoading(true);
    setError("");
    try {
      const respo = await axios.post(
        apiURLDashboard + "getCompanyOptionPoolLastestValuation",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      if (respo.data && respo.data.success) {
        setoptionpoolLastestvalue(respo.data.data);
      } else {
        setError("Failed to fetch data");
        console.error("API Error:", respo.data.message);
      }
    } catch (err) {
      setError("Error fetching option pool and valuation data");
      console.error("Error generating summary", err);
    } finally {
      setLoading(false);
    }
  };
  const getCurrencySymbol = (currencyCode) => {
    const cleanCode = currencyCode?.replace(/[\$\s]/g, "").toUpperCase();
    const country = countrySymbolList.find(
      (c) => c.currency_code?.toUpperCase() === cleanCode
    );
    return country?.currency_symbol || "";
  };
  const formatPercentage = (percentage) => {
    if (!percentage || percentage === 0) return "0%";
    return `${parseFloat(percentage).toFixed(1)}%`;
  };

  const formatShares = (shares) => {
    if (!shares || shares === 0) return "0";

    if (shares >= 1000000) {
      return `${(shares / 1000000).toFixed(1)}M`;
    } else if (shares >= 1000) {
      return `${(shares / 1000).toFixed(1)}K`;
    }

    return shares.toLocaleString();
  };
  const formatCurrency = (amount, currency = "USD") => {
    if (!amount || amount === 0) return "$0";

    // Create dynamic currency map from country symbols
    const dynamicCurrencyMap = createDynamicCurrencyMap();

    // Clean currency code - remove extra characters and spaces
    let cleanCurrency = currency;
    if (currency) {
      // First try to find in dynamic map
      if (dynamicCurrencyMap[currency]) {
        cleanCurrency = dynamicCurrencyMap[currency];
      } else {
        // Fallback: clean the currency code manually
        cleanCurrency = currency.replace(/[\$\s]/g, "").toUpperCase();

        // Static fallback map for common currencies
        const staticCurrencyMap = {
          CAD: "CAD",
          USD: "USD",
          EUR: "EUR",
          GBP: "GBP",
          INR: "INR",
        };

        cleanCurrency = staticCurrencyMap[cleanCurrency] || "USD";
      }
    }

    try {
      const formatter = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: cleanCurrency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });

      if (amount >= 1000000) {
        return formatter.format(amount / 1000000) + "M";
      } else if (amount >= 1000) {
        return formatter.format(amount / 1000) + "K";
      }

      return formatter.format(amount);
    } catch (error) {
      console.warn(
        `Invalid currency code: ${currency}, falling back to manual format`
      );

      // Manual formatting with symbol from database
      const symbol = getCurrencySymbol(currency);

      if (amount >= 1000000) {
        return `${symbol}${(amount / 1000000).toFixed(1)}M`;
      } else if (amount >= 1000) {
        return `${symbol}${(amount / 1000).toFixed(1)}K`;
      }

      return `${symbol}${amount.toLocaleString()}`;
    }
  };
  const createDynamicCurrencyMap = () => {
    const dynamicMap = {};

    countrySymbolList.forEach((country) => {
      if (country.currency_code) {
        // Clean currency code and add to map
        const cleanCode = country.currency_code
          .replace(/[\$\s]/g, "")
          .toUpperCase();
        dynamicMap[cleanCode] = cleanCode;

        // Also map variations like "CAD $" to "CAD"
        if (country.currency_symbol) {
          const variation = `${cleanCode} ${country.currency_symbol}`.trim();
          dynamicMap[variation] = cleanCode;
        }
      }
    });

    return dynamicMap;
  };
  const formatCurrencyAmount = (amount, currency = "USD") => {
    if (!amount || amount === 0) return "0";

    // Get currency symbol from database
    const currencySymbol = getCurrencySymbol(currency);
    const numAmount = Number(String(amount).replace(/,/g, ""));

    if (numAmount >= 1000000) {
      return `${currencySymbol}${(numAmount / 1000000).toFixed(1)}M`;
    } else if (numAmount >= 1000) {
      return `${currencySymbol}${(numAmount / 1000).toFixed(1)}K`;
    }

    return `${currencySymbol}${numAmount.toLocaleString("en-US")}`;
  };
  const calculatePreMoneyValuation = () => {
    // Pre-money = (Price per share × Total shares) - Money raised
    const totalShares = Number(
      String(CompanyData?.company_shares ?? "0").replace(/,/g, "")
    );
    const raisedAmount = Companyroundopen?.raised_to_date || 0;

    // If we have price per share from latest valuation
    if (optionpoolLastestvalue?.latest_valuation?.price_per_share > 0) {
      const pricePerShare =
        optionpoolLastestvalue.latest_valuation.price_per_share;
      const currentValuation = totalShares * pricePerShare;
      const preMoneyValuation = currentValuation - raisedAmount;
      return preMoneyValuation > 0 ? preMoneyValuation : 0;
    }

    // Fallback: Use total shares as valuation basis
    return totalShares;
  };
  const formatDateString = (dateStr) => {
    if (!dateStr) return "Not Set";

    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (error) {
      return dateStr; // Return original if parsing fails
    }
  };
  const getProgressColor = (percentage) => {
    if (percentage >= 80) return "#28a745"; // Green
    if (percentage >= 50) return "#ffc107"; // Yellow
    if (percentage >= 25) return "#fd7e14"; // Orange
    return "#dc3545"; // Red
  };
  const getCompanyTotalShares = async () => {
    const formData = {
      company_id: id,
    };
    try {
      const respo = await axios.post(
        apiURLDashboard + "getCompanyTotalShares",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      setCompanyData(respo.data.results);
      //getShareholder(respo.data.results[0]);
    } catch (err) {
      console.error("Error generating summary", err);
    }
  };
  const dilutionOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 0 },
    plugins: {
      legend: {
        position: "top",
      },
      tooltip: {
        callbacks: {
          label: function (context) {
            // Show percentage with 2 decimals for small values
            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}%`;
          },
          footer: function (tooltipItems) {
            let sum = tooltipItems.reduce((acc, t) => acc + t.parsed.y, 0);
            return `Total: ${sum.toFixed(2)}%`;
          },
        },
      },
      title: {
        display: true,
        text: "Ownership Dilution Forecast",
        font: { size: 16, weight: "bold" },
      },
    },
    scales: {
      x: { stacked: true, title: { display: true, text: "Funding Rounds" } },
      y: {
        stacked: true,
        max: 100,
        min: 0,
        title: { display: true, text: "Ownership Percentage" },
        ticks: {
          // Show small percentages properly
          callback: function (value) {
            return value.toFixed(2) + "%";
          },
        },
      },
    },
    interaction: { mode: "index", intersect: false },
  };
  const [chartData, setChartData] = useState({ labels: [], datasets: [] });
  useEffect(() => {
    const fetchOwnership = async () => {
      let formData = {
        company_id: id,
      };
      setLoading(true);
      try {
        const res = await axios.post(
          apiURLDashboard + "getBasicVsFullyDilutedOwnership",
          formData,
          {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        if (res.data && res.data.labels) {
          setChartData(res.data);
        }
      } catch (err) {
        console.error("Error generating summary", err);
      }
    };

    fetchOwnership();
  }, [id]);

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "top" },
      title: { display: true, text: "Basic vs Fully Diluted Ownership" },
      tooltip: {
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`,
        },
      },
    },
    scales: {
      x: { stacked: true },
      y: {
        stacked: true,
        max: 100,
        min: 0,
        ticks: { callback: (v) => v + "%" },
      },
    },
  };
  return (
    <>
      <div>
        <div className="d-flex align-items-start gap-0">
          <Sidebar />
          <div className="d-flex flex-column gap-0 w-100 dashboard_padding">
            <TopBar />
            <section className="dashboard_adminh">
              <div className="container-xl">
                <div className="row gy-4">
                  <div className="col-12">
                    <div className="card p-3">
                      {successMessage && (
                        <SuccessAlert
                          message={successMessage}
                          onClose={() => setsuccessMessage("")}
                        />
                      )}

                      {/* Header Section */}
                      <div className="d-flex justify-content-between align-items-center gap-3 flex-wrap mb-4">
                        <div className="d-flex align-items-center gap-3">
                          <Link
                            to={`/admin/users/company/${records?.user_id}`}
                            className="btn btn-secondary"
                          >
                            <FaArrowLeft /> Back
                          </Link>
                          <div>
                            <h5 className="mb-1">
                              {loading ? (
                                <span className="text-muted">Loading...</span>
                              ) : (
                                records?.company_name || "Company Name"
                              )}
                            </h5>
                            <small className="text-muted">
                              Owner:{" "}
                              <b>
                                {records?.user_first_name}{" "}
                                {records?.user_last_name}
                              </b>
                            </small>
                          </div>
                        </div>
                        <h5 className="mb-0 text-primary text-color">
                          Cap Table Overview
                        </h5>
                      </div>

                      {/* Loading State */}
                      {loading ? (
                        <div className="text-center py-5">
                          <div
                            className="spinner-border text-primary"
                            role="status"
                          >
                            <span className="visually-hidden">Loading...</span>
                          </div>
                          <p className="mt-3 text-muted">
                            Loading company information...
                          </p>
                        </div>
                      ) : records ? (
                        <>
                          {/* Company Details Card */}
                          {/* <div className="card p-4 mt-3 shadow-sm">
                            <h5 className="mb-4 d-flex align-items-center gap-2">
                              <FaBuilding className="text-primary" />
                              Company Details
                            </h5>
                            <div className="row g-4">
                              <div className="col-md-6">
                                <div className="mb-3">
                                  <label className="form-label fw-bold text-secondary small">
                                    Company Name
                                  </label>
                                  <p className="mb-0">
                                    {records.company_name || "N/A"}
                                  </p>
                                </div>
                              </div>

                              <div className="col-md-6">
                                <div className="mb-3">
                                  <label className="form-label fw-bold text-secondary small">
                                    Company ID
                                  </label>
                                  <p className="mb-0">
                                    {records.company_id || "N/A"}
                                  </p>
                                </div>
                              </div>

                              <div className="col-md-6">
                                <div className="mb-3">
                                  <label className="form-label fw-bold text-secondary small d-flex align-items-center gap-2">
                                    <FaUser /> Owner Name
                                  </label>
                                  <p className="mb-0">
                                    {records.user_first_name}{" "}
                                    {records.user_last_name}
                                  </p>
                                </div>
                              </div>

                              <div className="col-md-6">
                                <div className="mb-3">
                                  <label className="form-label fw-bold text-secondary small d-flex align-items-center gap-2">
                                    <FaEnvelope /> Email
                                  </label>
                                  <p className="mb-0">
                                    {records.user_email || "N/A"}
                                  </p>
                                </div>
                              </div>

                              {records.user_phone && (
                                <div className="col-md-6">
                                  <div className="mb-3">
                                    <label className="form-label fw-bold text-secondary small d-flex align-items-center gap-2">
                                      <FaPhone /> Phone
                                    </label>
                                    <p className="mb-0">{records.user_phone}</p>
                                  </div>
                                </div>
                              )}

                              {records.company_address && (
                                <div className="col-md-6">
                                  <div className="mb-3">
                                    <label className="form-label fw-bold text-secondary small d-flex align-items-center gap-2">
                                      <FaMapMarkerAlt /> Address
                                    </label>
                                    <p className="mb-0">
                                      {records.company_address}
                                    </p>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div> */}

                          {/* Cap Table Section - Add your cap table data here */}
                          <div className="card p-4 mt-3 shadow-sm">
                            <h5 className="mb-4">Capitalization Table</h5>
                            <div className="row">
                              <div className="col-md-12">
                                <div className="pb-3 bar_design d-flex justify-content-between align-items-center">
                                  <h4 className="h5 mb-0">Equity Snapshot</h4>
                                </div>

                                <div class="row gap-0 dashboard-top">
                                  <div class="col-6 col-md-3 p-0 bor">
                                    <div class="p-3">
                                      <p class="small fw-medium mb-1">
                                        Total Shares
                                      </p>
                                      <div className="d-flex align-items-center gap-3 justify-content-between">
                                        <p class="h4 fw-semibold mb-0">
                                          {getCurrencySymbol(
                                            CompanyData.currency
                                          )}
                                          {Number(
                                            String(
                                              CompanyData.totalCompanyShares
                                            ).replace(/,/g, "")
                                          ).toLocaleString("en-US")}
                                        </p>
                                      </div>
                                    </div>
                                  </div>

                                  <div className="col-6 col-md-3 p-0 bor">
                                    <div className="p-3">
                                      <p className="small fw-medium mb-1">
                                        Option Pool
                                      </p>
                                      {loading ? (
                                        <div className="d-flex align-items-center">
                                          <div
                                            className="spinner-border spinner-border-sm me-2"
                                            role="status"
                                          >
                                            <span className="visually-hidden">
                                              Loading...
                                            </span>
                                          </div>
                                          <span className="small">
                                            Loading...
                                          </span>
                                        </div>
                                      ) : error ? (
                                        <p className="h4 fw-semibold mb-0 text-danger">
                                          0
                                        </p>
                                      ) : (
                                        <div>
                                          <p className="h4 fw-semibold mb-0">
                                            {formatPercentage(
                                              optionpoolLastestvalue.option_pool
                                                ?.total_option_pool_percentage
                                            )}
                                          </p>
                                          <small className="text-muted">
                                            {formatShares(
                                              optionpoolLastestvalue.option_pool
                                                ?.total_option_pool_shares
                                            )}{" "}
                                            shares
                                          </small>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  <div class="col-6 col-md-3 p-0 bor">
                                    <div class="p-3">
                                      <p class="small fw-medium mb-1">
                                        Investor Stakes
                                      </p>
                                      <p class="h4 fw-semibold mb-0">
                                        {investorStakesPercent || 0}%
                                      </p>
                                    </div>
                                  </div>

                                  <div className="col-6 col-md-3 p-0">
                                    <div className="p-3">
                                      <p className="small fw-medium mb-1">
                                        Latest Valuation
                                      </p>
                                      {loading ? (
                                        <div className="d-flex align-items-center">
                                          <div
                                            className="spinner-border spinner-border-sm me-2"
                                            role="status"
                                          >
                                            <span className="visually-hidden">
                                              Loading...
                                            </span>
                                          </div>
                                          <span className="small">
                                            Loading...
                                          </span>
                                        </div>
                                      ) : error ? (
                                        <p className="h4 fw-semibold mb-0 text-danger">
                                          0
                                        </p>
                                      ) : (
                                        <div>
                                          <p className="h4 fw-semibold mb-0">
                                            {formatCurrency(
                                              optionpoolLastestvalue
                                                .latest_valuation
                                                ?.valuation_amount,
                                              optionpoolLastestvalue
                                                .latest_valuation?.currency
                                            )}
                                          </p>
                                          {optionpoolLastestvalue
                                            .latest_valuation?.price_per_share >
                                            0 && (
                                              <small className="text-muted">
                                                $
                                                {optionpoolLastestvalue.latest_valuation.price_per_share.toFixed(
                                                  2
                                                )}
                                                /share
                                              </small>
                                            )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="row px-3">
                                <div className="my-4 col-md-12">
                                  <div className="dashboard_card modern-chart h-100">
                                    <div className="card-header">
                                      <h3 className="card-title">
                                        Founder Dilution Across Funding Rounds
                                      </h3>
                                      {/* <button
                                                                  onClick={getDilutionForecast}
                                                                  className="global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2"
                                                                  disabled={loading}
                                                                >
                                                                  {loading ? "Loading..." : "Refresh"}
                                                                </button> */}
                                    </div>
                                    <div className="card-body h-100">
                                      {loading ? (
                                        <div className="d-flex justify-content-center align-items-center h-100">
                                          <div
                                            className="spinner-border"
                                            role="status"
                                          >
                                            <span className="visually-hidden">
                                              Loading...
                                            </span>
                                          </div>
                                        </div>
                                      ) : error ? (
                                        <div className="alert alert-warning h-100 d-flex align-items-center justify-content-center">
                                          0
                                        </div>
                                      ) : dilutionData.labels.length > 0 ? (
                                        <div style={{ height: "300px" }}>
                                          <Bar
                                            data={dilutionData}
                                            options={dilutionOptions}
                                          />
                                        </div>
                                      ) : (
                                        <div className="alert alert-info h-100 d-flex align-items-center justify-content-center">
                                          No rounds found. Create a round to see
                                          dilution forecast.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <div className="my-4 col-md-12">
                                  <div
                                    className="card-body"
                                    style={{ minHeight: "400px" }}
                                  >
                                    {shareholderLoading ? (
                                      <div className="text-center">
                                        <div
                                          className="spinner-border text-primary mb-3"
                                          role="status"
                                        >
                                          <span className="visually-hidden">
                                            Loading...
                                          </span>
                                        </div>
                                        <p className="text-muted">
                                          Loading shareholder data...
                                        </p>
                                      </div>
                                    ) : shareholderError ? (
                                      <div className="alert alert-warning text-center">
                                        <i className="fas fa-exclamation-triangle fa-2x mb-3 text-warning"></i>
                                        <h6>Unable to load shareholder data</h6>
                                        <p className="mb-3">
                                          {shareholderError}
                                        </p>
                                        <button
                                          onClick={getShareholder}
                                          className="btn btn-sm btn-primary"
                                        >
                                          Try Again
                                        </button>
                                      </div>
                                    ) : shareholderData.labels.length > 0 ? (
                                      <>
                                        {/* Pie Chart */}
                                        <div className="d-flex justify-content-center align-items-center mb-4">
                                          <div
                                            className="chart-container"
                                            style={{
                                              width: "100%",
                                              maxWidth: "350px",
                                              height: "350px",
                                            }}
                                          >
                                            <Pie
                                              data={shareholderData}
                                              options={shareholderOptions}
                                            />
                                          </div>
                                        </div>

                                        {/* Ownership Table */}
                                        <div className="table-responsive">
                                          <h5 className="mb-3 text-center fw-bold">
                                            Final Ownership Structure
                                          </h5>
                                          <table className="table table-hover table-bordered align-middle">
                                            <thead className="table-light">
                                              <tr>
                                                <th className="text-dark">
                                                  Stakeholder
                                                </th>
                                                <th className="text-end text-dark">
                                                  Shares
                                                </th>
                                                <th className="text-end text-dark">
                                                  Ownership %
                                                </th>
                                                <th className="text-dark">
                                                  Security Type
                                                </th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {ownershipTable.map(
                                                (row, index) => (
                                                  <tr key={index}>
                                                    <td>
                                                      <div className="d-flex align-items-center">
                                                        <span
                                                          className="badge me-2"
                                                          style={{
                                                            backgroundColor:
                                                              row.color,
                                                            width: "12px",
                                                            height: "12px",
                                                            borderRadius: "50%",
                                                          }}
                                                        ></span>
                                                        <strong>
                                                          {row.stakeholder}
                                                        </strong>
                                                      </div>
                                                    </td>
                                                    <td className="text-end">
                                                      {row.shares.toLocaleString()}
                                                    </td>
                                                    <td className="text-end">
                                                      <span className="badge bg-primary">
                                                        {row.percentage.toFixed(
                                                          2
                                                        )}
                                                        %
                                                      </span>
                                                    </td>
                                                    <td>
                                                      <span className="badge bg-secondary">
                                                        {row.securityType}
                                                      </span>
                                                    </td>
                                                  </tr>
                                                )
                                              )}
                                            </tbody>
                                            <tfoot className="table-light">
                                              <tr>
                                                <td className="fw-bold">
                                                  Total
                                                </td>
                                                <td className="text-end fw-bold">
                                                  {ownershipTable
                                                    .reduce(
                                                      (sum, row) =>
                                                        sum + row.shares,
                                                      0
                                                    )
                                                    .toLocaleString()}
                                                </td>
                                                <td className="text-end fw-bold">
                                                  <span className="badge bg-success">
                                                    100.00%
                                                  </span>
                                                </td>
                                                <td></td>
                                              </tr>
                                            </tfoot>
                                          </table>
                                        </div>
                                      </>
                                    ) : (
                                      <div className="alert alert-info text-center">
                                        <i className="fas fa-users fa-2x mb-3 text-info"></i>
                                        <h6>No Shareholders Found</h6>
                                        <p className="mb-3">
                                          Add investors to see shareholder
                                          breakdown
                                        </p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="my-4 col-md-12">
                                  <div className="dashboard_card modern-chart h-100">
                                    <div className="card-header">
                                      <h3 className="card-title">
                                        Basic vs Fully Diluted Ownership
                                      </h3>
                                      {/* <button
                                                                    onClick={getDilutionForecast}
                                                                    className="global_btn w-fit  px-4 py-2 fn_size_sm  active d-flex align-items-center gap-2"
                                                                    disabled={loading}
                                                                  >
                                                                    {loading ? "Loading..." : "Refresh"}
                                                                  </button> */}
                                    </div>
                                    <div className="card-body h-100">
                                      {loading ? (
                                        <div className="d-flex justify-content-center align-items-center h-100">
                                          <div
                                            className="spinner-border"
                                            role="status"
                                          >
                                            <span className="visually-hidden">
                                              Loading...
                                            </span>
                                          </div>
                                        </div>
                                      ) : error ? (
                                        <div className="alert alert-warning h-100 d-flex align-items-center justify-content-center">
                                          0
                                        </div>
                                      ) : chartData.labels.length > 0 ? (
                                        <div style={{ height: "300px" }}>
                                          <Bar
                                            data={chartData}
                                            options={options}
                                          />
                                        </div>
                                      ) : (
                                        <div className="alert alert-info h-100 d-flex align-items-center justify-content-center">
                                          No rounds found. Create a round to see
                                          dilution forecast.
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="alert alert-warning" role="alert">
                          <h6 className="alert-heading">No Data Found</h6>
                          <p className="mb-0">
                            Unable to load company information. Please try again
                            later.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </>
  );
}

export default AdminCompanyCaptable;
