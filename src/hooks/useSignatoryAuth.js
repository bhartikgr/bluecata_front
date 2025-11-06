import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

export default function useSignatoryAuth() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const storedData = localStorage.getItem("SignatoryLoginData");
    if (!storedData) {
      navigate("/signatory/login", { replace: true });
      return;
    }

    try {
      const userLogin = JSON.parse(storedData);

      if (!userLogin || typeof userLogin !== "object") {
        localStorage.removeItem("SignatoryLoginData");
        navigate("/signatory/login", { replace: true });
        return;
      }

      const currentTime = new Date().getTime();
      if (!userLogin.expiry || currentTime > userLogin.expiry) {
        localStorage.removeItem("SignatoryLoginData");
        navigate("/signatory/login", { replace: true });
        return;
      }

      setUser(userLogin);
    } catch (error) {
      console.error("Error parsing user data:", error);
      localStorage.removeItem("SignatoryLoginData");
      navigate("/signatory/login", { replace: true });
    }
  }, [navigate]);

  return user;
}
