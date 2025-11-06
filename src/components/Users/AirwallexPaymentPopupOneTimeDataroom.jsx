import React, { useEffect, useState, useRef } from "react";
import { X, CreditCard, Tag, CheckCircle, AlertCircle } from "lucide-react";
import styled from "styled-components";
import axios from "axios";
import { API_BASE_URL } from "../../config/config";
import Airwallex from "airwallex-payment-elements";

// Styled Components
const Overlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  z-index: 9999;
  animation: fadeIn 0.2s ease-out;
  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
`;

const Popup = styled.div`
  position: relative;
  width: 100%;
  max-width: 500px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
  animation: slideUp 0.3s ease-out;
  max-height: 650px;
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const Header = styled.div`
  position: relative;
  padding: 24px 24px 16px;
  border-bottom: 1px solid #f3f4f6;
`;

const CloseBtn = styled.button`
  position: absolute;
  top: 24px;
  right: 24px;
  padding: 4px;
  background: transparent;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  border-radius: 50%;
  transition: all 0.2s;

  &:hover {
    color: #4b5563;
    background: #f3f4f6;
  }
`;

const Title = styled.h2`
  font-size: 24px;
  font-weight: 700;
  color: #111827;
  margin: 0 0 4px 0;
`;

const Subtitle = styled.p`
  font-size: 14px;
  color: #6b7280;
  margin: 0;
`;

const Content = styled.div`
  padding: 0 24px 24px 24px;
`;

const CardBrands = styled.div`
  display: flex;
  justify-content: center;
  padding: 16px;
  background: linear-gradient(to bottom right, #f9fafb, #f3f4f6);
  border-radius: 12px;
`;

const CardBrandContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const CardBrand = styled.div`
  width: 48px;
  height: 32px;
  background: ${(props) => props.gradient};
  border-radius: 6px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 10px;
  font-weight: 700;
`;

const AmountBox = styled.div`
  padding: 16px;
  background: linear-gradient(to bottom right, #eff6ff, #e0e7ff);
  border-radius: 12px;
  border: 1px solid #dbeafe;
  margin-bottom: 24px;
`;

const AmountRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
`;

const AmountLabel = styled.span`
  font-size: 14px;
  font-weight: 500;
  color: #4b5563;
`;

const AmountValue = styled.div`
  text-align: right;
`;

const OriginalPrice = styled.div`
  font-size: 14px;
  color: #9ca3af;
  text-decoration: line-through;
`;

const FinalPrice = styled.div`
  font-size: 28px;
  font-weight: 700;
  color: #111827;
`;

const DiscountBadge = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #059669;
`;

const CouponSection = styled.div`
  margin-bottom: 24px;
`;

const Label = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #374151;
  margin-bottom: 12px;
`;

const CouponInputRow = styled.div`
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
`;

const Input = styled.input`
  flex: 1;
  padding: 10px 16px;
  font-size: 14px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  outline: none;
  text-transform: uppercase;
  transition: all 0.2s;

  &:focus {
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  &:disabled {
    background: #f9fafb;
    color: #6b7280;
    cursor: not-allowed;
  }
`;

const ApplyButton = styled.button`
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 500;
  color: white;
  background: linear-gradient(to right, #2563eb, #1d4ed8);
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);

  &:hover:not(:disabled) {
    background: linear-gradient(to right, #1d4ed8, #1e40af);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
`;

const ErrorMessage = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 14px;
  color: #dc2626;
`;

const CardSection = styled.div`
  margin-bottom: 24px;
`;

const CardContainer = styled.div`
  padding: 16px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  min-height: 120px;
  background: white;
  transition: border-color 0.2s;

  &:focus-within {
    border-color: #3b82f6;
  }
`;

const LoadingText = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #9ca3af;
  font-size: 14px;
  animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.5;
    }
  }
`;

const PayButton = styled.button`
  width: 100%;
  padding: 14px 24px;
  font-size: 16px;
  font-weight: 600;
  color: white;
  background: ${(props) =>
    props.disabled ? "#d1d5db" : "linear-gradient(to right, #059669, #047857)"};
  border: none;
  border-radius: 8px;
  cursor: ${(props) => (props.disabled ? "not-allowed" : "pointer")};
  transition: all 0.2s;
  box-shadow: ${(props) =>
    props.disabled ? "none" : "0 4px 6px rgba(0, 0, 0, 0.1)"};
  margin-bottom: 16px;

  &:hover:not(:disabled) {
    background: linear-gradient(to right, #047857, #065f46);
    box-shadow: 0 6px 8px rgba(0, 0, 0, 0.15);
  }
`;

const ProcessingContent = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
`;

const Spinner = styled.div`
  width: 20px;
  height: 20px;
  border: 2px solid white;
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`;

const SecurityBadge = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: 12px;
  color: #6b7280;
`;
const AirwallexPaymentPopupOneTimeDataroom = ({
  show,
  onClose,
  payment,
  referstatus,
}) => {
  const [sdkReady, setSdkReady] = useState(false);
  const [referalCode, setReferalCode] = useState("");
  const [discount, setDiscount] = useState(0);
  const [finalAmount, setFinalAmount] = useState(payment);
  const [buttonPay, setButtonPay] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [cardElement, setCardElement] = useState(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [codeApplied, setCodeApplied] = useState(false);
  const [paymentIntent, setPaymentIntent] = useState(null);

  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const apiURLAiFile = API_BASE_URL + "api/user/aifile/";
  const apiURLPayment = API_BASE_URL + "api/user/payment/";

  const [message, setMessage] = useState("");
  const [errr, seterrr] = useState(false);
  const cardContainerRef = useRef(null);
  const elementInstance = useRef(null);
  const [AccessToken, setAccessToken] = useState("");
  const [ClientIP, setClientIP] = useState("");
  // Initialize Airwallex SDK
  useEffect(() => {
    const getIP = async () => {
      try {
        const res = await fetch("https://api.ipify.org?format=json");
        const data = await res.json();
        setClientIP(data.ip); // Save this to state
      } catch (error) {
        console.error("Failed to fetch IP", error);
      }
    };

    getIP();
  }, []);
  useEffect(() => {
    if (!show) return;
    let mounted = true;

    const initPayment = async () => {
      try {
        console.log("🔄 Initializing Airwallex SDK...");

        // 1️⃣ Load Airwallex SDK
        await Airwallex.loadAirwallex({
          env: "demo", // Change to 'prod' for production
        });

        if (!mounted) return;
        console.log("✅ Airwallex SDK loaded");

        // 2️⃣ Get access token from your backend
        const { data: tokenData } = await axios.post(
          `${apiURLPayment}access_token`
        );

        if (!mounted) return;
        const token = tokenData.accessToken;
        if (!token) throw new Error("Access token missing");
        setAccessToken(token);
        // 3️⃣ Create PaymentIntent from your backend
        const { data: intentData } = await axios.post(
          `${apiURLPayment}create_payment_intent`,
          {
            amount: payment, // Convert to cents
            currency: "EUR",
            accessToken: token,
            originalAmount: payment,
          }
        );

        if (!mounted) return;
        const { paymentIntentId, clientSecret } = intentData;

        if (!paymentIntentId || !clientSecret) {
          throw new Error("Payment intent creation failed");
        }

        // Store payment intent details
        setPaymentIntent({
          id: paymentIntentId,
          client_secret: clientSecret,
        });

        // 4️⃣ Create the card element
        const element = Airwallex.createElement("card", {
          intent: {
            id: paymentIntentId,
            client_secret: clientSecret,
          },
        });

        elementInstance.current = element;
        setCardElement(element);

        // 5️⃣ Mount the card element to DOM
        element.mount("airwallex-card"); // Mount using element ID string

        // 6️⃣ Add event listeners
        window.addEventListener("onReady", (event) => {
          setSdkReady(true);
        });

        window.addEventListener("onChange", (event) => {
          setIsComplete(event.detail?.complete || false);
        });

        window.addEventListener("onError", (event) => {
          setButtonPay(event.detail?.message || "Card validation error");
        });
      } catch (err) {
        const errorMsg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          err.message;

        if (err.response?.data?.error?.code === "configuration_error") {
          alert("⚠️ Payment gateway not configured. Please contact support.");
        } else {
          alert("Payment initialization failed: " + errorMsg);
        }
      }
    };

    initPayment();

    // Cleanup function
    return () => {
      mounted = false;

      // Remove event listeners
      window.removeEventListener("onReady", () => {});
      window.removeEventListener("onChange", () => {});
      window.removeEventListener("onError", () => {});

      // Unmount element
      if (elementInstance.current?.unmount) {
        try {
          elementInstance.current.unmount();
        } catch (e) {
          console.warn("Unmount failed:", e);
        }
      }
    };
  }, [show, payment]);

  const handleRefferalCode = (e) => {
    setReferalCode(e.target.value.toUpperCase());
    setButtonPay("");
  };

  const handleApplyCode = async () => {
    if (!referalCode) {
      setButtonPay("Enter the code");
      return;
    }

    setIsApplying(true);
    setButtonPay("");

    try {
      const refercode = {
        code: referalCode,
        type: "Dataroom_Plus_Investor_Report",
        company_id: userLogin.companies[0].id,
      };

      const resp = await axios.post(
        `${apiURLAiFile}checkreferCode`,
        refercode,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );

      if (resp.data.results.length > 0) {
        const data = resp.data.results[0];
        if (data.usage_limit > data.used_count) {
          setDiscount(data.percentage);
          const discountValue = (payment * data.percentage) / 100;
          const final = payment - discountValue;
          setFinalAmount(final);
          setCodeApplied(true);
          setButtonPay("");
          setMessage("");
        } else {
          setDiscount(0);
          setFinalAmount(payment);
          setCodeApplied(false);
          setMessage("This code already used");
          seterrr(true);
        }
      } else {
        setDiscount(0);
        setFinalAmount(payment);
        setCodeApplied(false);
        setMessage("Invalid code!");
        seterrr(true);
      }
    } catch (err) {
      console.error(err);
      setDiscount(0);
      setFinalAmount(payment);
      setCodeApplied(false);
      setMessage("Something went wrong");
      seterrr(true);
    } finally {
      setIsApplying(false);
    }
  };

  const handlePay = async () => {
    if (finalAmount <= 0) {
      // Skip payment, directly mark as succeeded in DB
      await axios.post(
        `${apiURLPayment}CompanySubscriptionOneTimeDataRoomPlus`,
        {
          code: referalCode,
          company_id: userLogin.companies[0].id,
          created_by_id: userLogin.id,
          amount: 0,
          clientSecret: null,
          PayidOnetime: null,
          payment_status: "succeeded",
          discount: discount,
          ip_address: ClientIP,
        }
      );

      setMessage("Subscription applied successfully! 🎉");
      seterrr(false);
      setTimeout(() => window.location.reload(), 2000);
      return;
    }

    // Normal Airwallex payment flow
    if (!cardElement || !paymentIntent) {
      setMessage("Payment form not loaded");
      seterrr(true);
      return;
    }

    if (!isComplete) {
      setMessage("Please fill card details correctly");
      seterrr(true);
      return;
    }

    setIsPaying(true);
    setButtonPay("");

    try {
      const { data: newIntentData } = await axios.post(
        `${apiURLPayment}create_payment_intent`,
        {
          amount: Math.round(finalAmount * 100), // in cents
          currency: "EUR",
          accessToken: AccessToken,
          originalAmount: payment,
          discount: discount,
          code: referalCode,
        }
      );

      const intentId = newIntentData.paymentIntentId;
      const clientSecret = newIntentData.clientSecret;

      const response = await Airwallex.confirmPaymentIntent({
        element: cardElement,
        id: intentId,
        client_secret: clientSecret,
      });

      if (response.status === "SUCCEEDED") {
        await axios.post(
          `${apiURLPayment}CompanySubscriptionOneTimeDataRoomPlus`,
          {
            code: referalCode,
            company_id: userLogin.companies[0].id,
            created_by_id: userLogin.id,
            amount: finalAmount,
            clientSecret: clientSecret,
            PayidOnetime: intentId,
            payment_status: "succeeded",
            discount: discount,
            ip_address: ClientIP,
          }
        );

        setMessage("Payment successful! 🎉");
        seterrr(false);
        setTimeout(() => window.location.reload(), 2000);
      } else {
        setMessage(`Payment ${response.status}. Please try again.`);
        seterrr(true);
      }
    } catch (error) {
      setMessage(error.message || "Payment failed. Please try again.");
      seterrr(true);
    } finally {
      setIsPaying(false);
    }
  };

  if (!show) return null;

  return (
    <Overlay>
      <Popup>
        <Header>
          <CloseBtn onClick={onClose}>
            <X size={24} />
          </CloseBtn>
          <Title>Complete Payment</Title>
          <Subtitle>Secure payment powered by Airwallex</Subtitle>
        </Header>

        <Content>
          {/* Card Brands */}
          {message && (
            <div
              className={`flex items-center justify-between gap-3 shadow-lg ${
                errr ? "error_pop" : "success_pop"
              }`}
            >
              <div className="d-flex align-items-start gap-2">
                <span className="d-block">{message}</span>
              </div>

              <button
                type="button"
                className="close_btnCros"
                onClick={() => setMessage("")}
              >
                ×
              </button>
            </div>
          )}
          <CardBrands>
            <CardBrandContainer>
              <CardBrand gradient="linear-gradient(to bottom right, #2563eb, #1d4ed8)">
                VISA
              </CardBrand>
              <CardBrand gradient="linear-gradient(to bottom right, #dc2626, #ea580c)">
                MC
              </CardBrand>
              <CardBrand gradient="linear-gradient(to bottom right, #3b82f6, #2563eb)">
                AMEX
              </CardBrand>
            </CardBrandContainer>
          </CardBrands>

          {/* Amount Display */}
          <AmountBox>
            <AmountRow>
              <AmountLabel>Total Amount</AmountLabel>
              <AmountValue>
                {discount > 0 && (
                  <OriginalPrice>€{payment.toFixed(2)}</OriginalPrice>
                )}
                <FinalPrice>€{finalAmount.toFixed(2)}</FinalPrice>
              </AmountValue>
            </AmountRow>
            {discount > 0 && (
              <DiscountBadge>
                <CheckCircle size={16} />
                <span>{discount}% discount applied</span>
              </DiscountBadge>
            )}
          </AmountBox>

          {/* Coupon Code Section */}
          {referstatus && (
            <CouponSection>
              <Label>
                <Tag size={16} />
                <span>Have a coupon code?</span>
              </Label>
              <CouponInputRow>
                <Input
                  type="text"
                  value={referalCode}
                  onChange={handleRefferalCode}
                  placeholder="PROMO2024"
                  disabled={codeApplied}
                />
                <ApplyButton
                  onClick={handleApplyCode}
                  disabled={isApplying || codeApplied}
                >
                  {isApplying ? "..." : codeApplied ? "Applied" : "Apply"}
                </ApplyButton>
              </CouponInputRow>
              {buttonPay && !codeApplied && (
                <ErrorMessage>
                  <AlertCircle size={16} style={{ marginTop: "2px" }} />
                  <span>{buttonPay}</span>
                </ErrorMessage>
              )}
            </CouponSection>
          )}

          {/* Card Input Section */}
          <CardSection>
            <Label>
              <CreditCard size={16} />
              <span>Card Details</span>
            </Label>
            <CardContainer id="airwallex-card" ref={cardContainerRef} />
          </CardSection>

          {/* Pay Button */}
          <PayButton onClick={handlePay} disabled={!sdkReady || isPaying}>
            {isPaying ? (
              <ProcessingContent>
                <Spinner />
                <span>Processing...</span>
              </ProcessingContent>
            ) : (
              `Pay €${finalAmount.toFixed(2)}`
            )}
          </PayButton>

          {/* Security Badge */}
          <SecurityBadge>
            <svg
              width="16"
              height="16"
              fill="currentColor"
              viewBox="0 0 20 20"
              style={{ color: "#059669" }}
            >
              <path
                fillRule="evenodd"
                d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span>Secured by 256-bit SSL encryption</span>
          </SecurityBadge>
        </Content>
      </Popup>
    </Overlay>
  );
};

export default AirwallexPaymentPopupOneTimeDataroom;
