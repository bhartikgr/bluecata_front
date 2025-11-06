import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

// ✅ Higher Order Component (HOC) to wrap any component
export const withAuth = (WrappedComponent) => {
  return (props) => {
    const navigate = useNavigate();
    const [userLogin, setUserLogin] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
      const checkAuth = () => {
        const storedUsername = localStorage.getItem("SignatoryLoginData");

        if (!storedUsername) {
          setIsLoading(false);
          navigate("/signatory/login", { replace: true });
          return;
        }

        try {
          const parsedUser = JSON.parse(storedUsername);

          if (!parsedUser || typeof parsedUser !== "object") {
            localStorage.removeItem("SignatoryLoginData");
            setIsLoading(false);
            navigate("/signatory/login", { replace: true });
            return;
          }

          const currentTime = new Date().getTime();
          if (!parsedUser.expiry || currentTime > parsedUser.expiry) {
            localStorage.removeItem("SignatoryLoginData");
            setIsLoading(false);
            navigate("/signatory/login", { replace: true });
            return;
          }

          setUserLogin(parsedUser);
          setIsLoading(false);
        } catch (error) {
          console.error("Auth error:", error);
          localStorage.removeItem("SignatoryLoginData");
          setIsLoading(false);
          navigate("/signatory/login", { replace: true });
        }
      };

      checkAuth();
    }, [navigate]);

    if (isLoading) {
      return (
        <div
          className="d-flex justify-content-center align-items-center"
          style={{ minHeight: "100vh" }}
        >
          <div className="spinner-border text-primary" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
        </div>
      );
    }

    if (!userLogin) {
      return null;
    }

    // ✅ Pass userLogin as prop to wrapped component
    return <WrappedComponent {...props} userLogin={userLogin} />;
  };
};
