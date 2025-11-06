import React from "react";
import { Navigate } from "react-router-dom";

const ProtectedRoute = ({ authorizedData, children, fallback = "/" }) => {
  if (!authorizedData) {
    alert(
      "You have not submitted a signature yet. Please submit your signature first."
    );
    return <Navigate to={fallback} replace />;
  }

  if (authorizedData.approve !== "Yes") {
    alert(
      "Your signature is not approved by the company owner. You cannot proceed."
    );
    return <Navigate to={fallback} replace />;
  }

  return children; // signature exists & approved → allow access
};

export default ProtectedRoute;
