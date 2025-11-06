import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Link, useParams } from "react-router-dom";
import DataTable from "react-data-table-component";
import { FaDownload, FaArrowLeft } from "react-icons/fa";
import { FaEye } from "react-icons/fa"; // FontAwesome icons
function AdminTrackingReferralPayment() {
  const navigate = useNavigate();
  const [records, setRecords] = useState([]);
  useEffect(() => {
    document.title = "Referral Tracking Detail - Admin";
  }, []);
  const apiUrl = "http://localhost:5000/api/admin/module/";
  const [searchQuery, setSearchQuery] = useState("");
  const { id } = useParams();
  const [singlerecord, setsinglerecord] = useState("");
  // Define filtered data based on the search query
  const filteredRecords = records.filter((record) =>
    Object.values(record)
      .join(" ")
      .toLowerCase()
      .includes(searchQuery.toLowerCase())
  );

  const [successMessage, setsuccessMessage] = useState("");

  useEffect(() => {
    gettrackingData();
  }, []);
  const gettrackingData = async () => {
    let formData = {
      id: id,
    };
    try {
      const res = await axios.post(
        apiUrl + "getCompanyreferralpayment",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data;

      //setsinglerecord(respo.shared);
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
                      <div className="d-flex justify-content-between align-items-center gap-3 flex-wrap mb-3">
                        <Link
                          to={`/admin/setting/referralusage/`}
                          className="btn btn-secondary py-2"
                          style={{ width: "fit-content" }}
                        >
                          <FaArrowLeft /> Back
                        </Link>
                        <h5 className="mb-0">Referral Code</h5>
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
                          <h6 className="border p-3 d-flex  gap-2">
                            {" "}
                            <strong>Date of Report :</strong>
                            <span> N/A</span>
                          </h6>
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

export default AdminTrackingReferralPayment;
