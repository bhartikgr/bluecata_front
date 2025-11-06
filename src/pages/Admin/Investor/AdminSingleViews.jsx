import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin/TopBar";
import DataTable from "react-data-table-component";
import { FaDownload, FaArrowLeft } from "react-icons/fa";
import { Link, useParams } from "react-router-dom";
import axios from "axios";
function AdminSingleViews() {
  const { id } = useParams();
  const { type } = useParams();
  const [typemain, setTypemain] = useState("");

  const [reports, setReports] = useState([]);
  const [reportstable, setReportstable] = useState([]);
  const apiURLINFile = "http://localhost:5000/api/admin/adminall/";

  useEffect(() => {
    const fetchReports = async () => {
      try {
        const res = await axios.post(`${apiURLINFile}getSharereportGrouped`, {
          id: id,
        });

        setReports(res.data.data || []);
        setReportstable(res.data.data || []);
        console.log(res.data);
      } catch (err) {
        console.error("Error fetching reports", err);
      }
    };

    fetchReports();
  }, [id]);

  useEffect(() => {
    document.title = "Admin - Investor Reports Views";
  }, []);

  const columns = [
    {
      name: "Name",
      selector: (row) => `${row.first_name} ${row.last_name}`,
      sortable: true,
      className: "age",
    },
    {
      name: "Email",
      selector: (row) => row.email,
      sortable: true,
      className: "age",
    },

    {
      name: "Mobile",
      selector: (row) => row.mobile,
      sortable: false,
      className: "age",
    },
    {
      name: "Country",
      selector: (row) => row.country,
      sortable: false,
      className: "age",
    },
    {
      name: "City",
      selector: (row) => row.cityy,
      sortable: false,
      className: "age",
    },

    {
      name: "Ip address",
      selector: (row) => row.ip_address,
      sortable: false,
      className: "age",
    },

    {
      name: "Date of Viewed",
      selector: (row) => formatCurrentDate(row.dateview),
      sortable: false,
      className: "age",
    },
  ];

  useEffect(() => {
    if (type === "investorupdates") {
      setTypemain("Investor updates");
    } else if (type === "dataroom") {
      setTypemain("Dataroom");
    } else if (type === "termsheet") {
      setTypemain("Term Sheet");
    } else if (type === "duedelidocument") {
      setTypemain("Due Diligence Document");
    } else if (type === "subscriptiondoc") {
      setTypemain("Subscription Doccument");
    } else {
      setTypemain(""); // optional default
    }
  }, [type]);

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
  const handledownloadfile = (url) => {
    window.open(url, "_blank");
  };

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
          <div className="d-flex flex-column gap-0 w-100 dashboard_padding overflow-hidden">
            <TopBar />
            <section className="dashboard_adminh">
              <div className="container-xl">
                <div className="row gy-4">
                  <div className="col-12">
                    <div className="card p-3 ">
                      <Link
                        to={`/admin/investor/${type}`}
                        className="btn btn-secondary py-2 mb-4"
                        style={{ width: "fit-content" }}
                      >
                        <FaArrowLeft /> Back
                      </Link>

                      <div className="d-flex justify-content-between mb-3">
                        <h5 className="mb-3">{typemain}</h5>
                        <button
                          title="Download Report"
                          type="button"
                          onClick={() =>
                            handledownloadfile(reports[0]?.download)
                          }
                          className="admin_btn"
                        >
                          <FaDownload />
                        </button>
                      </div>

                      <div className="row gy-4">
                        <div className="col-md-6 ">
                          <h6 className="border p-3 d-flex  gap-2">
                            {" "}
                            <strong className="flex-shrink-0">
                              Name of Report :
                            </strong>{" "}
                            <span>{reports[0]?.document_name || "N/A"}</span>
                          </h6>
                        </div>
                        <div className="col-md-6 ">
                          <h6 className="border p-3 d-flex h-100 d-flex justify-content-start align-items-center gap-2">
                            {" "}
                            <strong className="flex-shrink-0">Shared :</strong>
                            <span>
                              {" "}
                              {reports[0]?.is_shareded === "Yes"
                                ? "Yes"
                                : "No"}{" "}
                            </span>
                          </h6>
                        </div>
                        <div className="col-md-6 ">
                          <h6 className="border p-3 d-flex h-100 d-flex justify-content-start align-items-center gap-2">
                            {" "}
                            <strong className="flex-shrink-0">
                              Company Name :
                            </strong>{" "}
                            <span> {reports[0]?.company_name || "N/A"} </span>
                          </h6>
                        </div>
                        <div className="col-md-6 ">
                          <h6 className="border p-3 d-flex  gap-2">
                            {" "}
                            <strong className="flex-shrink-0">
                              Date of Report :
                            </strong>
                            <span>
                              {" "}
                              {formatCurrentDate(
                                reports[0]?.date_of_report || "N/A"
                              )}{" "}
                            </span>
                          </h6>
                        </div>

                        <div className="col-md-12 pt-3 border-top">
                          <h5 className="pt-3">Investor Detalis</h5>
                          {reportstable.length > 0 && (
                            <DataTable
                              columns={columns}
                              data={
                                reportstable.length > 0
                                  ? reportstable[0].inverstordetail
                                  : []
                              }
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
                          )}
                        </div>
                      </div>
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

export default AdminSingleViews;
