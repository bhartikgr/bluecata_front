import { useNavigate } from "react-router-dom";
import React, { useEffect, useState } from "react";
import { LogOut } from "lucide-react";

import { Link, useLocation } from "react-router-dom";
function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [userdataa, setuserdataa] = useState("");
  useEffect(() => {
    const storedUser = localStorage.getItem("adminLogin");
    const userLogin = storedUser ? JSON.parse(storedUser) : null;

    if (!userLogin) {
      localStorage.removeItem("adminLogin");
      navigate("/admin/login");
      return;
    }

    const currentTime = new Date().getTime();

    if (currentTime > userLogin.adminexpiry) {
      // Session expired
      localStorage.removeItem("adminLogin");
      navigate("/admin/login");
    } else {
      setuserdataa(userLogin);
    }
  }, []);

  return (
    <section className="d-block admin_top_bar w-100">
      <div className="container-xl">
        <div className="d-flex w-100 justify-content-end align-items-center gap-2">
          <div className="profile_admin">
            <img
              className="w-100 h-100 object-fit-cover"
              src={require("../../assets/admin/images/woman.jpg")}
              alt="logo"
            />
          </div>
          <div
            title="Logout"
            className="p-2 rounded  d-flex align-items-center gap-2  logout_btn"
            style={{ cursor: "pointer" }}
          >
            <Link
              to="/admin/logout"
              className="text-white text-center d-flex align-items-center justify-content-center gap-2 text-decoration-none w-100"
            >
              <LogOut size={20} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}

export default TopBar;
