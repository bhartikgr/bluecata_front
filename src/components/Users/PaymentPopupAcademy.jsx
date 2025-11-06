// PaymentPopup.jsx
import React, { useState, useEffect } from "react";
import axios from "axios";
import { Button } from "../../components/Styles/MainStyle.js";
import { IoCloseCircleOutline } from "react-icons/io5";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import stripePromise from "../../config/stripe";

const PaymentPopupAcademy = ({ paytmmodule, show, onClose }) => {
  var apiURLAiFile = "http://localhost:5000/api/user/aifile/";

  const storedUsername = localStorage.getItem("SignatoryLoginData");

  const userLogin = JSON.parse(storedUsername);

  const CheckoutForm = () => {
    useEffect(() => {
      setmainamount(paytmmodule);
    }, [paytmmodule]);
    const [mainamount, setmainamount] = useState(paytmmodule);
    const [discount, setdiscount] = useState("");
    const stripe = useStripe();
    const elements = useElements();
    const [referalCode, setreferalCode] = useState("");
    const [spinners, setspinners] = useState(false);
    const [message, setMessage] = useState("");
    const [err, seterr] = useState(false);
    const [PayidOnetime, setPayidOnetime] = useState("");
    const [ClientIP, setClientIP] = useState("");
    const [buttonPay, setbuttonPay] = useState("");
    // setTimeout(() => {
    //   setMessage("");
    // }, 5000);
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
    const handleSubmit = async (e) => {
      e.preventDefault();

      if (!stripe || !elements) return;

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        setMessage("Payment form is not ready. Please reload the page.");
        seterr(true);
        return;
      }

      // 🔹 Validate Card Element fields
      const { error: cardError } = await stripe.createPaymentMethod({
        type: "card",
        card: cardElement,
      });

      if (cardError) {
        setMessage(cardError.message || "Invalid card details.");
        seterr(true);
        return;
      }

      setspinners(true);

      try {
        console.log();
        // 1️⃣ Get clientSecret from backend
        const { data } = await axios.post(
          `${apiURLAiFile}CreateuserSubscription_AcademyCheck`,
          {
            amount: mainamount, // in EUR
          }
        );

        // 2️⃣ Confirm payment
        const result = await stripe.confirmCardPayment(data.clientSecret, {
          payment_method: {
            card: cardElement,
          },
        });

        if (result.error) {
          setMessage(result.error.message);
          seterr(true);
          setspinners(false);
        } else if (result.paymentIntent.status === "succeeded") {
          // 3️⃣ Send to backend

          const formdata = {
            code: "",
            company_id: userLogin.companies[0].id,
            amount: mainamount,
            created_by_id: userLogin.id,
            clientSecret: data.clientSecret,
            payment_status: result.paymentIntent.status,
            discount: "",
            ip_address: ClientIP,
          };
          console.log(result.paymentIntent, data.clientSecret);
          await paymentsuccess(formdata);
        } else {
          setMessage("Payment failed. Try again.");
          seterr(true);
          setspinners(false);
        }
      } catch (error) {
        console.log(error);
        setMessage("Unexpected error occurred.");
        seterr(true);
        setspinners(false);
      }
    };

    const paymentsuccess = async (formdata) => {
      try {
        await axios.post(
          `${apiURLAiFile}CreateuserSubscription_Academy`,
          formdata,
          {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        setMessage("Payment successful! 🎉");
        seterr(false);
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } catch (err) {
        console.error("Success handler error:", err);
        setMessage("Payment was captured, but post-process failed.");
        seterr(true);
      } finally {
        setspinners(false);
      }
    };

    const handleRefferalCode = async (e) => {
      const upperValue = e.target.value.toUpperCase();
      setreferalCode(upperValue);
    };
    const handleapplycode = async () => {
      if (referalCode === "") {
        setbuttonPay("Enter the code");
      } else {
        let refercode = {
          code: referalCode,
          type: "Academy",
          email: userLogin.email,
        };
        console.log(refercode);
        try {
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
          //setreferalCode(referalCode);
          if (resp.data.results.length > 0) {
            var data = resp.data.results[0];
            if (data.usage_limit > data.used_count) {
              setdiscount(data.percentage);
              const discountValue = (paytmmodule * data.percentage) / 100;
              const final = paytmmodule - discountValue;
              setmainamount(final);

              setbuttonPay("");
            } else {
              setdiscount("");
              setmainamount(paytmmodule);
              setbuttonPay("This code already used");
            }
          } else {
            setdiscount("");
            setmainamount(paytmmodule);
            setbuttonPay("Invalid code!");
          }
        } catch (err) {
        } finally {
        }
      }
    };
    return (
      <form onSubmit={handleSubmit} method="post">
        <div
          className="form-control rounded-3"
          style={{
            padding: "0.75rem",
            border: "1px solid #000",
            borderColor: "#ced4da",
          }}
        >
          <CardElement
            options={{
              style: {
                base: {
                  fontSize: "16px",
                  color: "#32325d",
                  fontFamily:
                    '"Montserrat", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                  "::placeholder": { color: "#a0aec0" },
                  padding: "0.75rem",
                },
                invalid: {
                  color: "#e5424d",
                },
              },
              classes: {
                base: "stripe-card-element",
                focus: "border-primary",
                invalid: "border-danger",
              },
            }}
          />
        </div>
        {/* 
        <div className="d-flex gap-2 d-md-flex justify-content-md-end mt-4">
          <div className="d-flex flex-column">
            <input
              type="text"
              name="refferal_code"
              defaultValue={referalCode}
              onChange={handleRefferalCode}
              className="form-control w-auto"
              placeholder="Apply Referral Code"
              autoComplete="off"
              style={{ textTransform: "uppercase" }}
            />
            {buttonPay && (
              <span
                className="text-danger mt-1"
                style={{ fontSize: "0.875rem" }}
              >
                {buttonPay}
              </span>
            )}
          </div>

          <Button
            type="button"
            onClick={handleapplycode}
            className="submit d-flex align-items-center gap-2"
            style={{ background: "#5C636B", height: "fit-content" }}
          >
            Apply Code
          </Button>
        </div> */}
        {discount && (
          <div className="d-flex gap-2 d-md-flex justify-content-md-end mt-4">
            <b>Discount:</b> {discount}%
          </div>
        )}

        <div className="d-flex gap-2 d-md-flex justify-content-md-end mt-4">
          <Button
            disabled={!stripe || spinners}
            type="submit"
            className="submit d-flex align-items-center gap-2"
            style={{ background: "#003b21" }}
          >
            {!spinners && <span>Pay €{mainamount}</span>}
            {spinners && (
              <div
                className="spinner-border text-white spinneronetimepay m-0"
                role="status"
              >
                <span className="visually-hidden"></span>
              </div>
            )}
          </Button>
        </div>

        {message && (
          <div
            className={`flex items-center justify-between gap-3 shadow-lg ${err ? "error_pop" : "success_pop"
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
      </form>
    );
  };
  const [ShowPopup, setShowPopup] = useState(false);
  const handleClosepayPopup = () => {
    setShowPopup(false);
  };
  if (!show) return null;

  return (
    <>
      <div className="payment_modal-overlay" onClick={onClose}>
        <div
          className="modal-container scroll_bar"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <div className="modal-title-section">
              <h5 className="modal-title">Payment</h5>

              <div className="price-tag">Fee: €{paytmmodule}</div>
            </div>
            <button
              type="button"
              className="close_btn_global"
              onClick={onClose}
              aria-label="Close"
            >
              <IoCloseCircleOutline size={24} />
            </button>
          </div>

          <div className="payment-info">
            <div className="benefits-list">
              <div className="benefit-item">
                <div className="benefit-icon">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M22 11.08V12C21.9988 14.1564 21.3005 16.2547 20.0093 17.9818C18.7182 19.709 16.9033 20.9725 14.8354 21.5839C12.7674 22.1953 10.5573 22.1219 8.53447 21.3746C6.51168 20.6273 4.78465 19.2461 3.61096 17.4371C2.43727 15.628 1.87979 13.4881 2.02168 11.3363C2.16356 9.18455 2.99721 7.13631 4.39828 5.49706C5.79935 3.85782 7.69279 2.71537 9.79619 2.24013C11.8996 1.7649 14.1003 1.98232 16.07 2.85999"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M22 4L12 14.01L9 11.01"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="benefit-text">
                  Launch your startup the smart way: join live investor
                  meetings, master your pitch, and raise capital. Get access for
                  3 team members and set up your company for success from day
                  one.
                </div>
              </div>
            </div>
          </div>

          <div className="payment-methods">
            <div className="accepted-cards">
              <span className="accepted-text">We accept:</span>
              <div className="card-icons">
                <div className="text-center mb-4">
                  <img
                    src="/assets/user/images/cardimage.jpg"
                    alt="cards"
                    className="img-fluid rounded"
                    style={{ maxWidth: "200px" }}
                  />
                </div>
              </div>
            </div>

            <div className="stripe-form-container">
              <Elements stripe={stripePromise}>
                <CheckoutForm />
              </Elements>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default PaymentPopupAcademy;
