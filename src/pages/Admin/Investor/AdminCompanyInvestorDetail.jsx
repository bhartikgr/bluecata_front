import React, { useState, useEffect } from "react";
import Sidebar from "../../../components/Admin/Sidebar";
import TopBar from "../../../components/Admin//TopBar";
import {
  ModalContainer1,
  ModalTitle,
  DropArea,
  ModalBtn,
  ButtonGroup,
} from "../../../components/Styles/DataRoomStyle.js";
import { IoCloseCircleOutline } from "react-icons/io5";
import { useNavigate, Link, useParams } from "react-router-dom";
import { FaArrowLeft } from "react-icons/fa";
import SuccessAlert from "../../../components/Admin/SuccessAlert";
import axios from "axios";
function AdminCompanyInvestorDetail() {
  const navigate = useNavigate();

  const [successMessage, setsuccessMessage] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const { id } = useParams();
  const apiUrl = "http://localhost:5000/api/admin/company/";
  const [Investorinfo, setInvestorinfo] = useState("");
  document.title = "Investor Information - Admin";
  useEffect(() => {
    getInvestorInfo();
  }, []);
  const getInvestorInfo = async () => {
    let formData = {
      investor_id: id,
    };

    try {
      const res = await axios.post(apiUrl + "getInvestorInfo", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      var respo = res.data.results;
      console.log(respo);
      setInvestorinfo(respo);
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
  const handleOpen = () => setIsOpen(true);
  let files = [];

  // Ensure we have an array
  if (Investorinfo.kyc_document) {
    if (Array.isArray(Investorinfo.kyc_document)) {
      try {
        // Try parsing first element if it looks like JSON
        files = JSON.parse(Investorinfo.kyc_document[0]);
      } catch (e) {
        // fallback: it's already an array of strings
        files = Investorinfo.kyc_document;
      }
    } else {
      // single string case
      try {
        files = JSON.parse(Investorinfo.kyc_document);
      } catch (e) {
        files = [Investorinfo.kyc_document];
      }
    }
  }
  const isImage = (file) => {
    return /\.(jpg|jpeg|png|gif)$/i.test(file);
  };
  const baseUrl = "http://localhost:5000/api/upload/investor/inv_" + id;
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
                      <div className="d-flex justify-content-between gap-2 flex-wrap mb-2">
                        <div className="d-flex mb-3 gap-2">
                          <Link
                            to={`/admin/investor`}
                            className="btn btn-secondary"
                          >
                            <FaArrowLeft /> Back
                          </Link>
                        </div>
                        <h5 className="mb-4">Investor Information</h5>
                      </div>
                      <div className="card p-3 mt-3">
                        <h5 className="mb-3">Investor Details</h5>
                        <div className="row">
                          <div className="col-md-6 mb-2">
                            <strong>First Name:</strong>{" "}
                            {Investorinfo?.first_name || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Last Name:</strong>{" "}
                            {Investorinfo?.last_name || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Email:</strong> {Investorinfo?.email || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Phone:</strong> {Investorinfo?.phone || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>City:</strong> {Investorinfo?.city || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Mailing Address:</strong>{" "}
                            {Investorinfo?.full_address || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Country:</strong>{" "}
                            {Investorinfo?.country || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Country of Tax Residency:</strong>{" "}
                            {Investorinfo?.country_tax || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Tax ID or National ID:</strong>{" "}
                            {Investorinfo?.tax_id || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>LinkedIn or Professional Profile:</strong>{" "}
                            {Investorinfo?.linkedIn_profile || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Accredited Status:</strong>{" "}
                            {Investorinfo?.accredited_status || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Industry Expertise:</strong>{" "}
                            {Investorinfo?.industry_expertise || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>Type of Investor:</strong>{" "}
                            {Investorinfo?.type_of_investor || "-"}
                          </div>
                          <div className="col-md-6 mb-2">
                            <strong>KYC/AML Documentation:</strong>{" "}
                            {Investorinfo?.kyc_document &&
                              Investorinfo.kyc_document.length > 0 ? (
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={handleOpen}
                              >
                                View Document
                              </button>
                            ) : (
                              "-"
                            )}
                          </div>
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
      {isOpen && (
        <div className="main_popup-overlay">
          <ModalContainer1>
            <div className="d-flex align-items-center gap-3 mb-4 justify-content-between">
              <ModalTitle>View KYC/AML Documentation</ModalTitle>
              <button
                type="button"
                className="close_btn_global"
                aria-label="Close"
                onClick={() => setIsOpen(false)}
              >
                <IoCloseCircleOutline size={24} />
              </button>
            </div>

            {/* Images container */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "10px",
                maxHeight: "60vh",
                overflowY: "auto",
              }}
            >
              {files.map((file, index) => {
                const fileUrl = `${baseUrl}/${file}`;
                return isImage(file) ? (
                  <img
                    key={index}
                    src={fileUrl}
                    alt={`Document ${index + 1}`}
                    style={{
                      maxWidth: "200px",
                      maxHeight: "200px",
                      objectFit: "contain",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      padding: "4px",
                      background: "#f9f9f9",
                    }}
                  />
                ) : (
                  <a
                    key={index}
                    href={fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-primary"
                    style={{ margin: "5px" }}
                  >
                    Open Document {index + 1}
                  </a>
                );
              })}
            </div>

            <ButtonGroup>
              <ModalBtn
                onClick={() => setIsOpen(false)}
                className="close_btn w-fit"
              >
                Close
              </ModalBtn>
            </ButtonGroup>
          </ModalContainer1>
        </div>
      )}
    </>
  );
}

export default AdminCompanyInvestorDetail;
