import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "react-datepicker/dist/react-datepicker.css";
import "react-phone-number-input/style.css";

export default function Logout() {
  const navigate = useNavigate();
  console.log("test");
  useEffect(() => {
    localStorage.removeItem("InvestorData");
    localStorage.removeItem("InvestorData");
    window.location.href = "/investor/login";
  }, []);

  return <></>;
}
