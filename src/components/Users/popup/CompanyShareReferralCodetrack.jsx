import React, { useState, useEffect } from "react";
import {
  Overlay,
  ModalContainer,
  CloseButton,
} from "../../Styles/DataRoomStyle.js";
import axios from "axios";
const CompanyShareReferralCodetrack = ({
  onClose,
  returnrefresh,
  sharedDetail,
  sharedDetailSingleUsage,
}) => {
  console.log(sharedDetailSingleUsage);
  const apiUrl = "http://localhost:5000/api/user/";
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);
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
    <Overlay>
      <ModalContainer style={{ maxWidth: "900px", maxHeight: "550px" }}>
        <CloseButton onClick={onClose}>×</CloseButton>
        <div className="d-flex flex-column justify-content-between align-items-start tb-box">
          <div className="mb-5">
            <div className="row g-3 text-sm text-muted">
              <div className="titleroom d-flex justify-content-between align-items-center border-bottom pb-3">
                <h2 className="text-lg font-bold mb-2">
                  Referral Code Details/Tracking Code
                </h2>
              </div>
              <div className="col-12 col-md-4">
                <span className="fw-bold">
                  <b>Referral Date:</b>
                </span>{" "}
                {formatCurrentDate(sharedDetail.created_at)}
              </div>
              <div className="col-12 col-md-4">
                <span className="fw-semibold">
                  <b>Referral Code:</b>
                </span>{" "}
                {sharedDetail.discount_code}
              </div>
              <div className="col-12 col-md-4">
                <span className="fw-semibold">
                  <b>Company:</b>
                </span>{" "}
                {sharedDetail.company_name}
              </div>
              <div className="col-12 col-md-4">
                <span className="fw-semibold">
                  <b>Company Email:</b>
                </span>{" "}
                {sharedDetail.company_email}
              </div>
              <div className="col-12 col-md-4">
                <span className="fw-semibold">
                  <b>Referred/Partner By:</b>
                </span>{" "}
                {userLogin.email}
              </div>
              <div className="col-12 col-md-4">
                <span className="fw-semibold">
                  <b>Discount:</b>
                </span>{" "}
                {sharedDetailSingleUsage.discounts + "%"}
              </div>
              <div className="col-12 col-md-4">
                <span className="fw-semibold">
                  <b>Payment type:</b>
                </span>{" "}
                {sharedDetailSingleUsage.payment_type ===
                  "Dataroom_Plus_Investor_Report"
                  ? "Dataroom Management & Diligence + Investor Reporting"
                  : sharedDetailSingleUsage.payment_type === "Academy"
                    ? "International Entrepreneur Academy Program"
                    : sharedDetailSingleUsage.payment_type}
              </div>
              <div className="col-12 col-md-4">
                <span className="fw-semibold">
                  <b>Used Date</b>
                </span>{" "}
                {formatCurrentDate(sharedDetailSingleUsage.used_at)}
              </div>
            </div>
          </div>
        </div>
      </ModalContainer>
    </Overlay>
  );
};

export default CompanyShareReferralCodetrack;
