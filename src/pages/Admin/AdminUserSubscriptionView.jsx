import React, { useState, useEffect } from "react";
import Sidebar from "../../components/Admin/Sidebar";
import TopBar from "../../components/Admin//TopBar";
import { useNavigate, useParams, Link } from "react-router-dom";
import DataTable from "react-data-table-component";
import SuccessAlert from "../../components/Admin/SuccessAlert";
import { FaEye, FaArrowLeft } from "react-icons/fa";
import Modal from "react-modal";
import axios from "axios";
function AdminUserSubscriptionView() {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [successMessage, setsuccessMessage] = useState("");
  const toggleNavAdmin = () => {
    setIsOpen(!isOpen); // Toggle the state between true and false
  };
  const { id } = useParams();
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [records, setRecords] = useState([]);
  useEffect(() => {
    document.title = "Company Subscription View - Admin";
  }, []);
  useEffect(() => {
    getcompanypayment();
  }, []);

  const getcompanypayment = async () => {
    let formData = {
      id: id,
    };
    try {
      const res = await axios.post(apiUrl + "getcompanypayment", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;

      setRecords(respo);
    } catch (err) {
      // Enhanced error handling
      if (err.response) {
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
  };

  const columns = [
    {
      name: "Status",
      selector: (row) => row.company_name,
      sortable: true,
      className: "age",
    },
    {
      name: "Price",
      selector: (row) => "€" + Number(row.price).toFixed(2),
      sortable: true,
      className: "age",
    },

    {
      name: "Payment Id",
      selector: (row) => row.clientSecret,
      sortable: true,
      className: "age",
    },

    {
      name: "Start Date",
      selector: (row) => formatCurrentDate(row.start_date),
      sortable: true,
      className: "age",
    },
    {
      name: "End Date",
      selector: (row) => formatCurrentDate(row.end_date),
      sortable: true,
      className: "age",
    },
    {
      name: "Action",
      cell: (row) => (
        <Link
          to="javascript:void(0)"
          onClick={() =>
            handleViewPerInstance(row.id, row.start_date, row.end_date)
          }
          title="View Per Instance Fee"
          className="fs-5"
        >
          <FaEye />
        </Link>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
  const [searchQuery, setSearchQuery] = useState("");

  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );
  function formatCurrentDate(input) {
    const date = new Date(input); // ✅ Convert input to Date

    if (isNaN(date)) return ""; // ⛔ Invalid date check

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

  //Payment IR
  const [records2, setRecords2] = useState([]);
  const [searchQuery2, setSearchQuery2] = useState("");
  const columns2 = [
    {
      name: "Status",
      selector: (row) => row.company_name,
      sortable: true,
      className: "age",
    },
    {
      name: "Price",
      selector: (row) => "€" + Number(row.price).toFixed(2),
      sortable: true,
      className: "age",
    },

    {
      name: "Payment Id",
      selector: (row) => row.clientSecret,
      sortable: true,
      className: "age",
    },

    {
      name: "Start Date",
      selector: (row) => formatCurrentDate(row.start_date),
      sortable: true,
      className: "age",
    },
    {
      name: "End Date",
      selector: (row) => formatCurrentDate(row.end_date),
      sortable: true,
      className: "age",
    },
  ];
  useEffect(() => {
    getcompanypaymentAnnual();
  }, []);

  const getcompanypaymentAnnual = async () => {
    let formData = {
      id: id,
    };
    try {
      const res = await axios.post(
        apiUrl + "getcompanypaymentAnnual",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data.results;
      console.log(respo);
      setRecords2(respo);
    } catch (err) {
      // Enhanced error handling
      if (err.response) {
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
  };
  const filteredRecords2 = records2.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery2.toLowerCase())
  );
  //Payment IR

  //Payment Perinstance
  const [viewPerinstanceFee, setviewPerinstanceFee] = useState(false);
  const [Startdate, setStartdate] = useState("");
  const [Enddate, setEnddate] = useState("");
  const [recordsPerInstance, setRecordsPerInstance] = useState([]);
  const handleViewPerInstance = async (id, start, end) => {
    setStartdate(start);
    setEnddate(end);
    let formData = {
      usersubscriptiondataroomone_time_id: id,
    };
    try {
      const res = await axios.post(apiUrl + "getPerinstanceFee", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      setviewPerinstanceFee(true);
      setRecordsPerInstance(respo);
    } catch (err) {
      // Enhanced error handling
      if (err.response) {
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
  };
  const filteredRecordsPerInstance = recordsPerInstance.filter((record) =>
    Object.values(record).join(" ").toLowerCase()
  );

  const columnsPerInstance = [
    {
      name: "Status",
      selector: (row) => row.company_name,
      sortable: true,
      className: "age",
    },
    {
      name: "Price",
      selector: (row) => "€" + Number(row.price).toFixed(2),
      sortable: true,
      className: "age",
    },

    {
      name: "Payment Id",
      selector: (row) => row.clientSecret,
      sortable: true,
      className: "age",
    },

    {
      name: "Payment Date",
      selector: (row) => formatCurrentDate(row.created_at),
      sortable: true,
      className: "age",
    },
  ];
  //Payment Perinstance
  const customStyles = {
    table: {
      style: {
        minWidth: "100%",
        boxShadow: "0 10px 15px rgba(0, 0, 0, 0.2)",
        border: "1px solid #00000036",
        borderRadius: "12px",
        overflow: "hidden",
      },
    },
    headCells: {
      style: {
        backgroundColor: "#ff3f45 !important",
        fontWeight: "600",
        fontSize: "12px",
        color: "#fff !important",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      },
    },
    cells: {
      style: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        maxWidth: "200px",
      },
    },
    rows: {
      style: {
        fontSize: "14px",
        "&:hover": {
          backgroundColor: "#e8f0fe",
        },
      },
      stripedStyle: {
        backgroundColor: "#f4f6f8",
      },
    },
    pagination: {
      style: {
        backgroundColor: "#fafafa",
        padding: "12px 16px",
      },
    },
  };
  return (
    <>
      <div>
        <div className="d-flex align-items-start gap-0">
          <Sidebar />
          <div className="d-flex flex-column gap-0 dashboard_padding w-100">
            <TopBar />
            <section className="dashboard_adminh w-100">
              <div className="container-xl">
                <div className="row gy-4">
                  <div className="col-12">
                    {successMessage && (
                      <SuccessAlert
                        message={successMessage}
                        onClose={() => setsuccessMessage("")}
                      />
                    )}
                    <div className="card p-3 w-100">
                      {/* Back Button */}
                      <div className="d-flex mb-3 justify-content-between">
                        <Link to="/admin/company" className="btn btn-secondary">
                          <FaArrowLeft /> Back
                        </Link>
                        <h2 className="">Subscription</h2>
                      </div>
                      {/* Header: Title + Search */}
                      <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-end mb-3 gap-3">
                        <h5 className="mb-0">
                          Subscription (DATAROOM MANAGEMENT & DILIGENCE +
                          INVESTOR REPORTING)
                        </h5>
                        <div class="search-bar">
                          <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery2}
                            onChange={(e) => setSearchQuery(e.target.value)}
                          />
                          <span class="search-icon">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                              />
                            </svg>
                          </span>
                        </div>
                      </div>

                      {/* Data Table */}
                      <DataTable
                        columns={columns}
                        data={filteredRecords}
                        pagination
                        highlightOnHover
                        striped
                        responsive
                        defaultSortAsc={true}
                        customStyles={customStyles}
                        className="custom-scrollbar custome-icon"
                        noDataComponent={
                          <div className="text-center py-2">
                            <span>No results found</span>
                          </div>
                        }
                      />
                    </div>

                    <div className="card p-3 mt-4">
                      <div className="d-flex flex-column flex-md-row justify-content-between align-items-md-end mb-3 gap-3">
                        <h5 className="mb-0">
                          Subscription (INTERNATIONAL ENTREPRENEUR ACADEMY
                          PROGRAM)
                        </h5>
                        <div class="search-bar">
                          <input
                            type="text"
                            placeholder="Search..."
                            value={searchQuery2}
                            onChange={(e) => setSearchQuery2(e.target.value)}
                          />
                          <span class="search-icon">
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z"
                              />
                            </svg>
                          </span>
                        </div>
                      </div>
                      <DataTable
                        columns={columns2}
                        data={filteredRecords2}
                        pagination
                        highlightOnHover
                        striped
                        responsive
                        customStyles={customStyles}
                        className="custom-scrollbar custome-icon"
                        noDataComponent={
                          <div className="text-center py-2">
                            <span>No results found</span>
                          </div>
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
      {viewPerinstanceFee && (
        <div
          className="modal fade show d-block"
          style={{ backgroundColor: "rgba(0, 0, 0, 0.5)" }}
          tabIndex="-1"
          role="dialog"
          aria-labelledby="paymentModalLabel"
          aria-hidden="false"
        >
          <div
            className="modal-dialog modal-dialog-centered modal-lg"
            style={{ maxWidth: "1024px" }}
          >
            <div className="modal-content rounded-4 shadow-lg p-4">
              <button
                type="button"
                className="btn-close position-absolute top-0 end-0 m-3"
                onClick={() => setviewPerinstanceFee(false)}
                aria-label="Close"
              ></button>

              <div className="text-center mt-4">
                {/* Start Date and End Date display */}
                <div className="d-flex justify-content-center gap-4 mb-4">
                  <div>
                    <strong>Start Date:</strong> {formatCurrentDate(Startdate)}
                  </div>
                  <div>
                    <strong>End Date:</strong> {formatCurrentDate(Enddate)}
                  </div>
                </div>

                {/* DataTable */}
                <DataTable
                  columns={columnsPerInstance}
                  data={filteredRecordsPerInstance}
                  pagination
                  highlightOnHover
                  striped
                  responsive
                  customStyles={customStyles}
                  className="custom-scrollbar custome-icon"
                  noDataComponent={
                    <div className="text-center py-2">
                      <span>No results found</span>
                    </div>
                  }
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AdminUserSubscriptionView;
