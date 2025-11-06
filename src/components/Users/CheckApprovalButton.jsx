import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const CheckApprovalButton = ({ authorizedData, to, children, className }) => {
  const navigate = useNavigate();
  const [messageAll, setmessageAll] = useState("");
  const [errr, seterrr] = useState(true);
  const handleClick = () => {
    if (!authorizedData) {
      // No signature uploaded
      navigate("/authorized-signature");
      return;
    }

    if (authorizedData.approve !== "Yes") {
      // Signature uploaded but not approved
      alert(
        "Your signature is not approved by the company owner. You cannot proceed."
      );

      return;
    }

    // Signature approved → proceed
    if (to) navigate(to);
  };

  return (
    <button
      type="button"
      className={className}
      onClick={handleClick}
      style={
        !authorizedData || authorizedData.approve !== "Yes"
          ? { cursor: "not-allowed", opacity: 0.6 }
          : {}
      }
    >
      {children}
    </button>
  );
};

export default CheckApprovalButton;
