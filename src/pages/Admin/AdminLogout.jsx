import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import DangerAlert from "../../components/Admin/DangerAlert";
import SuccessAlert from "../../components/Admin/SuccessAlert";
import "bootstrap/dist/css/bootstrap.min.css";

export default function AdminLogout() {
  var apiURL = "http://localhost:5000/api/admin/";
  const navigate = useNavigate();
  useEffect(() => {
    localStorage.removeItem("adminLogin");

    window.location.href = "/admin/login";
  }, []);
  return <></>;
}
