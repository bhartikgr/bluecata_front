import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin/TopBar";
import DataTable from "react-data-table-component";
import { FaEye, FaTrashAlt } from "react-icons/fa";
import { Link, useParams } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa";
import axios from "axios";
function AdminInvestorUpdate() {
  const [reports, setReports] = useState([]);
  const apiURLINFile = "http://localhost:5000/api/admin/adminall/";
  const { type } = useParams();
  const [typemain, setTypemain] = useState("");

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

  useEffect(() => {
    if (!typemain) return;

    const fetchReports = async () => {
      try {
        const res = await axios.post(
          `${apiURLINFile}getallInvestorReportViewed`,
          {
            type: typemain, // body payload
          }
        );

        setReports(res.data.results || []);
      } catch (err) {
        console.error("Error fetching reports", err);
      }
    };

    fetchReports();
  }, [typemain]);

  useEffect(() => {
    document.title = "Admin - Investor Reports";
  }, []);

  const columns = [
    {
      name: "Name of Report",
      selector: (row) => row.document_name,
      sortable: true,
      className: "age",
    },
    {
      name: "Date of Report",
      selector: (row) => formatCurrentDate(row.created_at),
      sortable: true,
      className: "age",
    },

    {
      name: "Shared",
      selector: (row) => row.is_shared,
      sortable: false,
      className: "age",
    },
    {
      name: "Action",
      cell: (row) => (
        <Link
          to={`/admin/investor/detail/${type}/${row.id}`}
          title="View Investor Updates"
          className="dataedit_btn fs-5"
        >
          <FaEye />
        </Link>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
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
          <div className="d-flex flex-column gap-0 w-100 dashboard_padding">
            <TopBar />
            <section className="dashboard_adminh">
              <div className="container-xl">
                <div className="row gy-4">
                  <div className="col-12">
                    <div className="card p-3">
                      <div className="d-flex justify-content-between gap-2 flex-wrap mb-3">
                        <h5 className="mb-0 capitalize">{typemain}</h5>
                      </div>

                      <DataTable
                        columns={columns}
                        data={reports}
                        pagination
                        highlightOnHover
                        striped
                        responsive
                        customStyles={customStyles}
                        className="custom-scrollbar custome-icon"
                        noDataComponent={
                          <div className="text-center  py-2">
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
    </>
  );
}

export default AdminInvestorUpdate;
