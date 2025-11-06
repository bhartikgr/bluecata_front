import React, { useState, useEffect } from "react";
import {
  Stepblock,
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/RegisterStyles";
import SideBar from "../../components/Investor/Sidebar.jsx";
import axios from "axios";
function Dashboard() {
  const [totalCompany, setTotalCompany] = useState(0); // initial value
  const [totalCompanyshares, settotalCompanyshares] = useState(0); // initial value
  const [totalissuedshares, settotalissuedshares] = useState(0);
  const [totalround, settotalround] = useState(0);
  const [latestinvestorReport, setlatestinvestorReport] = useState([]);
  const [latestinvestorReportDataroom, setlatestinvestorReportDataroom] =
    useState([]);
  const [roundRecordlatest, setroundRecordlatest] = useState([]);
  const [TotalInvestorReport, setTotalInvestorReport] = useState("");
  const [TotalDataroomReport, setTotalDataroomReport] = useState("");
  const storedUsername = localStorage.getItem("InvestorData");
  const userLogin = JSON.parse(storedUsername);
  var apiURL = "http://localhost:5000/api/user/capitalround/";
  document.title = "Investor Dashboard Page";
  useEffect(() => {
    getTotalcompany();
    getTotalCompanyIssuedShared();
    getlatestinvestorreport();
    getlatestinvestorDataroom();
    getTotalInvestorReport();

    getTotalDataroomsReport();
  }, []);
  const getTotalcompany = async () => {
    let formData = {
      investor_id: userLogin.id,
    };
    try {
      const res = await axios.post(apiURL + "getTotalcompany", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      });
      setTotalCompany(res.data.results.length);

      if (res.data.results.length > 0) {
        var companies = res.data.results;
        // Calculate total shares
        const totalShares = companies.reduce((sum, company) => {
          // Make sure it's a number
          const shares = Number(0);
          return sum + shares;
        }, 0);

        //settotalCompanyshares(totalShares); // Store in state
      }
    } catch (err) { }
  };
  const getTotalInvestorReport = async () => {
    let formData = {
      investor_id: userLogin.id,
      type: "Investor updates",
    };
    try {
      const res = await axios.post(
        apiURL + "getTotalInvestorReport",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setTotalInvestorReport(res.data.results.length);
    } catch (err) { }
  };
  const getTotalDataroomsReport = async () => {
    let formData = {
      investor_id: userLogin.id,
      type: "Due Diligence Document",
    };
    try {
      const res = await axios.post(
        apiURL + "getTotalInvestorReport",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setTotalDataroomReport(res.data.results.length);
    } catch (err) { }
  };
  const getTotalCompanyIssuedShared = async () => {
    let formData = {
      investor_id: userLogin.id,
    };
    try {
      const res = await axios.post(
        apiURL + "getTotalCompanyIssuedShared",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      var data = res.data.results;
      settotalCompanyshares(data.totalRoundSize);
      settotalissuedshares(data.totalIssuedShares);
      settotalround(data.totalRounds);
    } catch (err) { }
  };
  const getlatestinvestorreport = async () => {
    let formData = {
      investor_id: userLogin.id,
      type: "Investor updates",
    };
    try {
      const res = await axios.post(
        apiURL + "getlatestinvestorreport",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      var data = res.data.results;

      setlatestinvestorReport(data);
    } catch (err) { }
  };
  const getlatestinvestorDataroom = async () => {
    let formData = {
      investor_id: userLogin.id,
      type: "Due Diligence Document",
    };
    try {
      const res = await axios.post(
        apiURL + "getlatestinvestorDataroom",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      var data = res.data.results;

      setlatestinvestorReportDataroom(data);
    } catch (err) { }
  };
  useEffect(() => {
    getInvestorCapitalMotionlistLatest();
  }, []);
  const getInvestorCapitalMotionlistLatest = async () => {
    let formData = {
      investor_id: userLogin.id,
    };
    try {
      const res = await axios.post(
        apiURL + "getInvestorCapitalMotionlistLatest",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      setroundRecordlatest(res.data.results);
    } catch (err) { }
  };
  const [dashboardData] = useState({
    equity: {
      totalShares: "10,000,000",
      optionPool: "15%",
      investorStakes: "62%",
      valuation: "$25M",
    },

    shareholders: {
      labels: [
        "Founders",
        "Series A Investors",
        "Series B Investors",
        "Option Pool",
        "Employees",
      ],
      data: [35, 25, 20, 15, 5],
      colors: [
        "#081828",
        "#092f4e",
        "#10395c",
        "#1a588d",
        "#2577bd",
        "#2577bd",
      ],
    },

    openRound: {
      type: "Series B",
      target: "$8M",
      raised: "$5.2M",
      preMoney: "$22M",
      closeDate: "Dec 15, 2023",
    },

    investors: {
      total: 24,
      contacts: 42,
      messages: [
        {
          name: "John Smith",
          firm: "VC Partners",
          message: "When will the next report be available?",
          time: "2h ago",
        },
        {
          name: "Sarah Johnson",
          firm: "Capital Growth",
          message: "Request for additional metrics...",
          time: "1d ago",
        },
      ],
    },

    dataRoom: {
      completion: 78,
      recentUploads: [
        {
          name: "Financials Q3 2023",
          description: "Updated projections",
          time: "Today",
        },
        {
          name: "Cap Table",
          description: "Latest revision",
          time: "Yesterday",
        },
      ],
    },

    accessLogs: [
      {
        name: "David Wilson",
        action: "Viewed Financial Reports",
        time: "Today, 4:00 PM",
      },
      {
        name: "Emily Chen",
        action: "Downloaded Cap Table",
        time: "Today, 5:00 PM",
      },
      {
        name: "Michael Brown",
        action: "Viewed Pitch Deck",
        time: "Yesterday, 10:00 AM",
      },
    ],
  });

  const [isCollapsed, setIsCollapsed] = useState(false);
  function formatCurrentDate(input) {
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

    return `${month} ${day}${getOrdinal(day)}, ${year}`;
  }
  return (
    <Wrapper className="investor-login-wrapper">
      <div className="fullpage d-block">
        <div className="d-flex align-items-start gap-0">
          <SideBar isCollapsed={isCollapsed} setIsCollapsed={setIsCollapsed} />

          <div
            className={`global_view ${isCollapsed ? "global_view_col" : ""}`}
          >
            <SectionWrapper className="d-block p-md-4 p-3">
              <div className="container-fluid">
                <Stepblock id="step5">
                  <div className="row">
                    <div className="col-md-12">
                      <div className="pb-3 bar_design">
                        <h4 className="h5 mb-0">Dashboard</h4>
                      </div>

                      <div class="row gap-0 dashboard-top">
                        <div class="col-6 col-md-3 p-0 bor">
                          <div class="p-3">
                            <p class="small fw-medium mb-1">Total Company</p>
                            <div className="d-flex align-items-center gap-3 justify-content-between">
                              <p class="h4 fw-semibold mb-0">{totalCompany}</p>
                            </div>
                          </div>
                        </div>
                        <div class="col-6 col-md-3 p-0 bor">
                          <div class="p-3">
                            <p class="small fw-medium mb-1">
                              Total Investor Report
                            </p>
                            <div className="d-flex align-items-center gap-3 justify-content-between">
                              <p class="h4 fw-semibold mb-0">
                                {TotalInvestorReport}
                              </p>
                            </div>
                          </div>
                        </div>
                        <div class="col-6 col-md-3 p-0 bor">
                          <div class="p-3">
                            <p class="small fw-medium mb-1">
                              Total DataRoom Management Report
                            </p>
                            <div className="d-flex align-items-center gap-3 justify-content-between">
                              <p class="h4 fw-semibold mb-0">
                                {TotalDataroomReport}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div class="col-6 col-md-3 p-0 bor">
                          <div class="p-3">
                            <p class="small fw-medium mb-1">Total Round</p>
                            <p class="h4 fw-semibold mb-0">{totalround}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="col-12 my-4">
                      <div class="dashboard_card  modern-chart">
                        <div class="card-header">
                          <h3 class="card-title">Latest Company Report</h3>
                        </div>

                        <div class="access-logs">
                          <h4 class="section-title">Investor Report</h4>

                          <table class="log-table">
                            <thead>
                              <tr>
                                <th className="fw-bold">Report</th>
                                <th className="fw-bold">Version</th>
                                <th className="fw-bold">Date Of Report</th>
                                <th className="fw-bold">Name Of Report</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.isArray(latestinvestorReport) &&
                                latestinvestorReport.length > 0 ? (
                                latestinvestorReport.map((log, index) => (
                                  <tr key={index}>
                                    <td>
                                      <small>{log.type}</small>
                                    </td>
                                    <td>
                                      <small>{log.version}</small>
                                    </td>
                                    <td>
                                      <small>
                                        {formatCurrentDate(log.shared_date)}
                                      </small>
                                    </td>
                                    <td>
                                      <small>{log.document_name}</small>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan="4">
                                    <small>No records found</small>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div class="access-logs">
                          <h4 class="section-title">
                            DataRoom Management & Diligence
                          </h4>

                          <table class="log-table">
                            <thead>
                              <tr>
                                <th className="fw-bold">Report</th>
                                <th className="fw-bold">Version</th>
                                <th className="fw-bold">Date Of Report</th>
                                <th className="fw-bold">Name Of Report</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.isArray(latestinvestorReportDataroom) &&
                                latestinvestorReportDataroom.length > 0 ? (
                                latestinvestorReportDataroom.map(
                                  (log, index) => (
                                    <tr key={index}>
                                      <td>
                                        <small>{log.type}</small>
                                      </td>
                                      <td>
                                        <small>{log.version}</small>
                                      </td>
                                      <td>
                                        <small>
                                          {formatCurrentDate(log.shared_date)}
                                        </small>
                                      </td>
                                      <td>
                                        <small>{log.document_name}</small>
                                      </td>
                                    </tr>
                                  )
                                )
                              ) : (
                                <tr>
                                  <td colSpan="4">
                                    <small>No records found</small>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                        <div class="access-logs">
                          <h4 class="section-title">Capital Round Documents</h4>

                          <table class="log-table">
                            <thead>
                              <tr>
                                <th className="fw-bold">
                                  Share Class(Name Of Round)
                                </th>
                                <th className="fw-bold">Target Raise Amount</th>
                                <th className="fw-bold">Number Of Shares</th>
                                <th className="fw-bold">Date of Share</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Array.isArray(roundRecordlatest) &&
                                roundRecordlatest.length > 0 ? (
                                roundRecordlatest.map((log, index) => (
                                  <tr key={index}>
                                    <td>
                                      <small>
                                        {log.nameOfRound} {log.shareClassType}
                                      </small>
                                    </td>
                                    <td>
                                      <small>
                                        {log.currency}{" "}
                                        {Number(log.roundsize).toLocaleString(
                                          "en-US"
                                        )}
                                      </small>
                                    </td>
                                    <td>
                                      <small>
                                        {Number(
                                          log.issuedshares
                                        ).toLocaleString("en-US")}
                                      </small>
                                    </td>
                                    <td>
                                      <small>
                                        {formatCurrentDate(log.sent_date)}
                                      </small>
                                    </td>
                                  </tr>
                                ))
                              ) : (
                                <tr>
                                  <td colSpan="4">
                                    <small>No records found</small>
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                </Stepblock>
              </div>
            </SectionWrapper>
          </div>
        </div>
      </div>
    </Wrapper>
  );
}

export default Dashboard;
