import React, { useEffect, useState } from "react";
import { VscOpenPreview } from "react-icons/vsc";
import { IoCloseCircleOutline } from "react-icons/io5";
import {
  FaUser,
  FaEnvelope,
  FaPhone,
  FaLinkedin,
  FaKey,
  FaUserShield,
  FaCheckCircle,
  FaClock,
  FaCalendarAlt,
  FaSignature,
} from "react-icons/fa";
import { MdBadge, MdAccessTime } from "react-icons/md";
import { API_BASE_URL } from "../../../config/config";
import axios from "axios";

const SignatoryInformation = ({ onClose, signatory_id, id }) => {
  const apiUrlDashboard = API_BASE_URL + "api/user/signatorydashboard/";
  const [SignatoryInfo, setSignatoryInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    getSigantoryInformation();
  }, []);

  const getSigantoryInformation = async () => {
    const formData = {
      id: signatory_id,
      company_id: id,
    };
    setLoading(true);
    try {
      const resp = await axios.post(
        apiUrlDashboard + "getSigantoryInformation",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      console.log(resp.data.results);
      setSignatoryInfo(resp.data.results);
    } catch (err) {
      console.error("Error fetching data", err);
    } finally {
      setLoading(false);
    }
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return <span className="text-muted">N/A</span>;
    const date = new Date(dateString);
    return (
      <div>
        <div>
          {date.toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </div>
        <div className="text-muted small">
          {date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    );
  };

  const InfoCard = ({
    icon: Icon,
    label,
    value,
    iconColor = "text-primary",
  }) => (
    <div className="col-md-6">
      <div className="card border-0 shadow-sm h-100 hover-shadow">
        <div className="card-body p-3">
          <div className="d-flex align-items-start gap-3">
            <div className={`bg-light p-2 rounded ${iconColor}`}>
              <Icon size={20} />
            </div>
            <div className="flex-grow-1">
              <div className="text-muted small mb-1">{label}</div>
              <div className="fw-semibold text-dark">
                {value || (
                  <span className="text-muted fst-italic">Not provided</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const StatusBadge = ({ status }) => {
    const isPending = status === "pending";
    return (
      <span
        className={`badge ${
          isPending ? "bg-warning" : "bg-success"
        } text-white px-3 py-2 fs-6`}
      >
        {isPending ? (
          <>
            <FaClock className="me-2" />
            Pending
          </>
        ) : (
          <>
            <FaCheckCircle className="me-2" />
            Active
          </>
        )}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="main_popup-overlay">
        <div
          className="d-flex justify-content-center align-items-center"
          style={{ height: "100vh" }}
        >
          <div className="text-center">
            <div
              className="spinner-border text-primary"
              role="status"
              style={{ width: "3rem", height: "3rem" }}
            >
              <span className="visually-hidden">Loading...</span>
            </div>
            <p className="mt-3 text-muted">Loading signatory information...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!SignatoryInfo) {
    return (
      <div className="main_popup-overlay">
        <div
          className="d-flex justify-content-center align-items-center"
          style={{ height: "100vh" }}
        >
          <div className="text-center">
            <p className="text-muted">No signatory information found</p>
            <button onClick={onClose} className="btn btn-primary mt-3">
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main_popup-overlay">
      <div
        style={{
          backgroundColor: "white",
          borderRadius: "12px",
          width: "98%",
          maxWidth: "1200px",
          maxHeight: "90vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 10px 40px rgba(0, 0, 0, 0.2)",
          margin: "20px auto",
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-4 border-bottom"
          style={{
            background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          }}
        >
          <div className="d-flex align-items-center justify-content-between">
            <div className="d-flex align-items-center gap-3">
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  backgroundColor: "rgba(255, 255, 255, 0.2)",
                  borderRadius: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <FaUserShield className="text-white" size={28} />
              </div>
              <div>
                <h3 className="mb-1 fw-bold text-white">
                  Signatory Information
                </h3>
                <p className="mb-0 text-white opacity-75 small">
                  {SignatoryInfo.first_name} {SignatoryInfo.last_name}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="btn btn-light btn-sm d-flex align-items-center gap-2"
              style={{
                borderRadius: "8px",
                padding: "10px 20px",
              }}
            >
              <IoCloseCircleOutline size={20} />
              Close
            </button>
          </div>
        </div>

        {/* Status Banner */}
        <div className="px-4 py-3 bg-light border-bottom">
          <div className="d-flex align-items-center justify-content-between flex-wrap gap-3">
            <div className="d-flex align-items-center gap-3">
              <div>
                <span className="text-muted small">Access Status:</span>
                <div className="mt-1">
                  <StatusBadge status={SignatoryInfo.access_status} />
                </div>
              </div>
              <div className="vr" style={{ height: "40px" }}></div>
            </div>
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-grow-1 overflow-auto p-4">
          <div className="row g-3">
            {/* Personal Information Section */}
            <div className="col-12">
              <h5 className="fw-bold text-dark mb-3 pb-2 border-bottom">
                <FaUser className="me-2 text-primary" />
                Personal Information
              </h5>
            </div>

            <InfoCard
              icon={FaUser}
              label="First Name"
              value={SignatoryInfo.first_name}
              iconColor="text-primary"
            />

            <InfoCard
              icon={FaUser}
              label="Last Name"
              value={SignatoryInfo.last_name}
              iconColor="text-primary"
            />

            <InfoCard
              icon={FaEnvelope}
              label="Email Address"
              value={SignatoryInfo.signatory_email}
              iconColor="text-info"
            />

            <InfoCard
              icon={FaPhone}
              label="Phone Number"
              value={SignatoryInfo.signatory_phone}
              iconColor="text-success"
            />

            <InfoCard
              icon={FaLinkedin}
              label="LinkedIn Profile"
              value={
                SignatoryInfo.linked_in ? (
                  <a
                    href={SignatoryInfo.linked_in}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-decoration-none"
                  >
                    {SignatoryInfo.linked_in}
                  </a>
                ) : null
              }
              iconColor="text-primary"
            />

            <InfoCard
              icon={FaSignature}
              label="Signature Role"
              value={SignatoryInfo.signature_role}
              iconColor="text-purple"
            />

            {/* Account Information Section */}
            <div className="col-12 mt-4">
              <h5 className="fw-bold text-dark mb-3 pb-2 border-bottom">
                <FaKey className="me-2 text-warning" />
                Account Information
              </h5>
            </div>

            <InfoCard
              icon={MdBadge}
              label="Company Name"
              value={SignatoryInfo.company_name}
              iconColor="text-secondary"
            />

            <InfoCard
              icon={FaKey}
              label="View Password"
              value={
                SignatoryInfo.viewpassword ? (
                  <span className="font-monospace bg-light px-2 py-1 rounded">
                    {SignatoryInfo.viewpassword}
                  </span>
                ) : null
              }
              iconColor="text-warning"
            />

            <InfoCard
              icon={FaUserShield}
              label="Invited By"
              value={`${SignatoryInfo.invited_by_first_name || ""} ${
                SignatoryInfo.invited_by_last_name || ""
              }`}
              iconColor="text-info"
            />

            {/* Timeline Section */}
            <div className="col-12 mt-4">
              <h5 className="fw-bold text-dark mb-3 pb-2 border-bottom">
                <FaClock className="me-2 text-danger" />
                Activity Timeline
              </h5>
            </div>

            <div className="col-md-4">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body p-3">
                  <div className="d-flex align-items-start gap-3">
                    <div className="bg-light p-2 rounded text-success">
                      <FaCalendarAlt size={20} />
                    </div>
                    <div className="flex-grow-1">
                      <div className="text-muted small mb-1">Invited At</div>
                      <div className="fw-semibold text-dark">
                        {formatDateTime(SignatoryInfo.invited_at)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-md-4">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body p-3">
                  <div className="d-flex align-items-start gap-3">
                    <div className="bg-light p-2 rounded text-primary">
                      <FaCheckCircle size={20} />
                    </div>
                    <div className="flex-grow-1">
                      <div className="text-muted small mb-1">Accepted At</div>
                      <div className="fw-semibold text-dark">
                        {formatDateTime(SignatoryInfo.accepted_at)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="col-md-4">
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body p-3">
                  <div className="d-flex align-items-start gap-3">
                    <div className="bg-light p-2 rounded text-warning">
                      <MdAccessTime size={20} />
                    </div>
                    <div className="flex-grow-1">
                      <div className="text-muted small mb-1">Last Login</div>
                      <div className="fw-semibold text-dark">
                        {formatDateTime(SignatoryInfo.last_login)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-top bg-light d-flex justify-content-end">
          <button onClick={onClose} className="btn btn-secondary px-4">
            Close
          </button>
        </div>
      </div>

      <style jsx>{`
        .hover-shadow:hover {
          transform: translateY(-2px);
          transition: all 0.3s ease;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
        }
        .hover-shadow {
          transition: all 0.3s ease;
        }
      `}</style>
    </div>
  );
};

export default SignatoryInformation;
