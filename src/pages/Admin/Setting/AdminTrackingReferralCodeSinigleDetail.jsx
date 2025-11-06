import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import DataTable from "react-data-table-component";
import { FaDownload, FaArrowLeft } from "react-icons/fa";
import { FaEye } from "react-icons/fa"; // FontAwesome icons
import { Modal, Button } from "react-bootstrap";
function AdminTrackingReferralCodeSinigleDetail() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  useEffect(() => {
    document.title = "Referral Tracking Detail - Admin";
  }, []);
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [searchQuery, setSearchQuery] = useState("");
  const { id, discount_code } = useParams();
  const [singlerecord, setsinglerecord] = useState("");
  const [showEdit, setshowEdit] = useState(false);
  const [Paydetail, setPaydetail] = useState("");
  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  const [successMessage, setsuccessMessage] = useState("");

  const columns = [
    {
      name: "Payment Type",
      selector: (row) => {
        switch (row.payment_type) {
          case "Dataroom_Plus_Investor_Report":
            return "Dataroom Management & Diligence + Investor Reporting";
          case "Academy":
            return "International Entrepreneur Academy Program";
          default:
            return row.payment_type;
        }
      },
      sortable: true,
    },
    {
      name: "Discount",
      selector: (row) => row.discounts + "%",
      sortable: true,
      className: "age",
    },

    {
      name: "Actions",
      cell: (row) => (
        <Link
          onClick={() => handleReferralDetail(row.usage_id)}
          className="dataedit_btn"
          title="View Usage Detail"
        >
          <FaEye />
        </Link>
      ),
      ignoreRowClick: true,
      allowOverflow: true,
      button: true,
    },
  ];
  const handleReferralDetail = async (usage_id) => {
    let formData = {
      usage_id: usage_id,
    };
    try {
      const res = await axios.post(apiUrl + "getfulldetailreferral", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data;
      console.log(respo.result);
      setPaydetail(respo.result);
      setshowEdit(true);
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
  useEffect(() => {
    gettrackingData();
  }, []);
  const gettrackingData = async () => {
    let formData = {
      discount_code: discount_code,
      id: id,
    };
    try {
      const res = await axios.post(
        apiUrl + "gettrackingDatasingleDetail",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data;
      console.log(respo);
      setsinglerecord(respo.shared);
      setRecords(respo.usage);
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
  const handleClose = () => {
    setshowEdit(false);
  };

  const customStyles = {
    table: {
      style: {
        minWidth: "100%",
        boxShadow: "0 10px 15px rgba(0, 0, 0, 0.2)",
        border: "1px solid #00000036",
        borderRadius: "12px",
        overflow: "hidden",
        display: "block",
      },
    },
    headRow: {
      style: {
        display: "grid",
        gridTemplateColumns:
          "minmax(150px, 1fr) minmax(150px, 1fr) minmax(200px, 1fr) minmax(120px, 1fr) 80px 150px",
        backgroundColor: "#ff3f45",
        color: "#fff",
        fontWeight: "600",
        fontSize: "12px",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      },
    },
    headCells: {
      style: {
        padding: "8px",
        textAlign: "left",
      },
    },
    rows: {
      style: {
        display: "grid",
        gridTemplateColumns:
          "minmax(150px, 1fr) minmax(150px, 1fr) minmax(200px, 1fr) minmax(120px, 1fr) 80px 150px",
        fontSize: "14px",
        "&:hover": {
          backgroundColor: "#e8f0fe",
        },
      },
      stripedStyle: {
        backgroundColor: "#f4f6f8",
      },
    },
    cells: {
      style: {
        whiteSpace: "normal",
        overflow: "hidden",
        textOverflow: "ellipsis",
        padding: "8px",
        display: "flex",
        alignItems: "center",
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
          <div className="d-flex flex-column gap-0 w-100 overflow-hidden dashboard_padding">
            <TopBar />
            <section className="dashboard_adminh">
              <div className="container-xl">
                <div className="row gy-4">
                  <div className="col-12">
                    <div className="card p-3 ">
                      <div className="d-flex justify-content-between mb-3">
                        <Link
                          to={`/admin/setting/referralusage/${discount_code}`}
                          className="btn btn-secondary py-2 my-3"
                          style={{ width: "fit-content" }}
                        >
                          <FaArrowLeft /> Back
                        </Link>
                        <h5 className="mb-3">
                          Referral Code ({discount_code})
                        </h5>
                      </div>

                      <div className="row">
                        <div className="col-md-4 d-flex flex-column gap-2 pb-5 ">
                          <h6 className="border p-3 d-flex  gap-2">
                            {" "}
                            <strong>Referred By :</strong>{" "}
                            <span>{singlerecord.referred_by_name}</span>
                          </h6>
                          <h6 className="border p-3 d-flex  gap-2">
                            {" "}
                            <strong>Company Name :</strong>
                            <span> {singlerecord.company_name}</span>
                          </h6>
                        </div>

                        <div className="col-md-4 d-flex flex-column gap-2 pb-5">
                          <h6 className="border p-3 d-flex  gap-2">
                            {" "}
                            <strong>Referral Date :</strong>{" "}
                            <span>
                              {" "}
                              {formatCurrentDate(singlerecord.created_at)}
                            </span>
                          </h6>
                          <h6 className="border p-3 d-flex  gap-2">
                            {" "}
                            <strong>Company Email :</strong>
                            <span> {singlerecord.company_email}</span>
                          </h6>
                        </div>
                        <div className="col-md-4 d-flex flex-column gap-2 pb-5">
                          <h6 className="border p-3 d-flex  gap-2">
                            {" "}
                            <strong>Company Email :</strong>
                            <span> {singlerecord.company_email}</span>
                          </h6>
                        </div>
                        <div className="col-md-12 pt-3 border-top">
                          <h5 className="pt-3">Used Referral Code</h5>

                          <DataTable
                            columns={columns}
                            data={records.length > 0 ? records : []}
                            pagination
                            highlightOnHover
                            striped
                            responsive
                            customStyles={customStyles}
                            className="custom-scrollbar custome-icon"
                            noDataComponent={
                              <div className="text-center py-2">
                                <span>No users found</span>
                              </div>
                            }
                          />
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
      <Modal
        className="custom-modal"
        show={showEdit}
        onHide={handleClose}
        centered
      >
        <Modal.Header closeButton>
          <Modal.Title>Referral Usage Details</Modal.Title>
        </Modal.Header>

        <Modal.Body>
          <div className="container-fluid">
            <div className="row g-3">
              <div className="col-md-6">
                <strong>Referral Used Date:</strong>
                <br />
                {formatCurrentDate(Paydetail.created_at)}
              </div>
              <div className="col-md-6">
                <strong>Payment Id:</strong>
                <br />
                {Paydetail.clientSecret}
              </div>
              <div className="col-md-6">
                <strong>Payment type:</strong>
                <br />
                {Paydetail.table_type === "usersubscriptiondataroomone_time"
                  ? "Dataroom Management & Diligence"
                  : Paydetail.table_type ===
                    "userinvestorreporting_subscription"
                    ? "Investor Reporting"
                    : Paydetail.table_type === "usersubscriptiondata_academy"
                      ? "Academy"
                      : Paydetail.table_type}
              </div>

              <div className="col-md-6">
                <strong>Actual Amount:</strong>
                <br />€
                {Paydetail.table_type === "usersubscriptiondataroomone_time"
                  ? "500"
                  : Paydetail.table_type ===
                    "userinvestorreporting_subscription"
                    ? "120"
                    : Paydetail.table_type === "usersubscriptiondata_academy"
                      ? "1,200"
                      : Paydetail.table_type}
              </div>
              <div className="col-md-6">
                <strong>Discount:</strong>
                <br />
                {Paydetail.discounts + "%"}
              </div>
              <div className="col-md-6">
                <strong>Amount:</strong>
                <br />€{Paydetail.price}
              </div>
            </div>
          </div>
        </Modal.Body>
      </Modal>
    </>
  );
}

export default AdminTrackingReferralCodeSinigleDetail;
