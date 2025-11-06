import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import DangerAlert from "../../components/Admin/DangerAlert";
import "bootstrap/dist/css/bootstrap.min.css";
import "react-datepicker/dist/react-datepicker.css";
import "react-phone-number-input/style.css";
import {
  Tophead,
  Slan,
  Stepblock,
  Titletext,
  Iconblock,
  Sup,
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/RegisterStyles";
import { Link } from "react-router-dom";

import { Globe, User, Lock } from "lucide-react";

export default function Logout() {
  const navigate = useNavigate();
  const [userdata, setuserdata] = useState("");
  useEffect(() => {
    localStorage.removeItem("OwnerLoginData");
    localStorage.removeItem("OwnerLoginData");
    window.location.href = "/user/login";
  }, []);

  return <></>;
}
