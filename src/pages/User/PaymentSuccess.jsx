import React, { useEffect, useState } from "react";
import axios from "axios";

const PaymentSuccess = () => {
  const [verifying, setVerifying] = useState(true);
  const [paymentData, setPaymentData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    verifyPayment();
  }, []);

  const verifyPayment = async () => {
    try {
      // Get order ID from URL
      const urlParams = new URLSearchParams(window.location.search);
      const orderId = urlParams.get("order_id");

      // Get payment details from localStorage
      const pendingPayment = JSON.parse(
        localStorage.getItem("pending_payment") || "{}"
      );
      const paymentIntentId = pendingPayment.paymentIntentId;

      if (!paymentIntentId) {
        setError("Payment ID not found");
        setVerifying(false);
        return;
      }

      // Verify with backend
      const response = await axios.get(
        `/api/user/payment/verify_payment?payment_intent_id=${paymentIntentId}`
      );

      if (response.data.success && response.data.status === "SUCCEEDED") {
        setPaymentData(response.data.payment);
        localStorage.removeItem("pending_payment");
      } else {
        setError("Payment verification failed");
      }
    } catch (err) {
      console.error("Verify error:", err);
      setError("Failed to verify payment");
    } finally {
      setVerifying(false);
    }
  };

  if (verifying) {
    return <div>Verifying payment...</div>;
  }

  if (error) {
    return <div>Error: {error}</div>;
  }

  return (
    <div style={{ textAlign: "center", padding: "50px" }}>
      <h1>✅ Payment Successful!</h1>
      <p>Amount: ${(paymentData.amount / 100).toFixed(2)}</p>
      <p>Transaction ID: {paymentData.id}</p>
      <button onClick={() => (window.location.href = "/dashboard")}>
        Go to Dashboard
      </button>
    </div>
  );
};

export default PaymentSuccess;
