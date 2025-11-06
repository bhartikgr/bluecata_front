import React, { useState, useEffect } from "react";
import {
  Overlay,
  ModalContainer,
  ModalTitle,
  CloseButton,
  DropArea,
  ModalBtn,
  ButtonGroup,
} from "../../Styles/DataRoomStyle.js";
import axios from "axios";
import { Button } from "../../../components/Styles/MainStyle.js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { IoCloseCircleOutline } from "react-icons/io5";
const stripePromise = loadStripe(
  "pk_test_51RUJzWAx6rm2q3pys9SgKUPRxNxPZ4P1X6EazNQvnPuHKOOfzGsbylaTLUktId9ANHULkwBk67jnp5aqZ9Dlm6PR00jKdDwvSq"
);
const LockFilePayment = ({ onClose }) => {
  var apiURL = "http://localhost:5000/api/user/aifile/";
  const apiUrlModule = "http://localhost:5000/api/admin/module/";
  var apiURLAiFile = "http://localhost:5000/api/user/aifile/";
  const storedUsername = localStorage.getItem("CompanyLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [getDataroompay, setgetDataroompay] = useState("");

  useEffect(() => {
    getDataroompayment();
  }, []);
  const getDataroompayment = async () => {
    let formData = {
      user_id: "",
    };
    try {
      const res = await axios.post(
        apiUrlModule + "getDataroompayment",
        formData,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json", // Ensure the content type is JSON
          },
        }
      );
      var respo = res.data.row;

      setgetDataroompay(respo[0]);
    } catch (err) {
      // Enhanced error handling
      if (err.response) {
      } else if (err.request) {
        console.error("Request data:", err.request);
      } else {
        console.error("Error message:", err.message);
      }
    }
  };
  const CheckoutForm = ({ payment }) => {
    const [mainamount, setmainamount] = useState(payment);
    const stripe = useStripe();
    const [discount, setdiscount] = useState("");
    const [referalCode, setreferalCode] = useState("");
    const elements = useElements();
    const [buttonPay, setbuttonPay] = useState("");
    const [spinners, setspinners] = useState(false);
    const [message, setMessage] = useState("");
    const [errr, seterrr] = useState(false);

    setTimeout(() => {
      setMessage("");
    }, 5000);

    const handleSubmit = async (e) => {
      console.log(stripe);
      e.preventDefault();
      console.log(stripe);
      if (!stripe || !elements) return;

      const cardElement = elements.getElement(CardElement);
      if (!cardElement) {
        setMessage("Payment form is not ready. Please reload the page.");
        seterrr(true);
        return;
      }

      setspinners(true);

      try {
        // Get clientSecret from backend
        const { data } = await axios.post(
          `${apiURLAiFile}CreateuserSubscriptionPaymentLockFile`,
          {
            user_id: userLogin.id,
            amount: mainamount, // in EUR
          }
        );

        const result = await stripe.confirmCardPayment(data.clientSecret, {
          payment_method: {
            card: cardElement,
          },
        });

        if (result.error) {
          setMessage(result.error.message);
          seterrr(true);
          setspinners(false);
        } else if (result.paymentIntent.status === "succeeded") {
          const formdata = {
            user_id: userLogin.id,
            amount: mainamount,
            clientSecret: data.clientSecret,
            payment_status: result.paymentIntent.status,
          };

          await paymentsuccess(formdata);
        } else {
          setMessage("Payment failed. Try again.");
          seterrr(true);
          setspinners(false);
        }
      } catch (error) {
        setMessage("Unexpected error occurred.");
        seterrr(true);
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
        };
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
          if (resp.data.results.length > 0) {
            var data = resp.data.results[0];
            if (data.usage_limit > data.used_count) {
              setdiscount(data.percentage);
              const discountValue =
                (getDataroompay.perInstance_Fee * data.percentage) / 100;
              const final = getDataroompay.perInstance_Fee - discountValue;
              console.log(final, mainamount);
              setmainamount(final);
              setbuttonPay("");
            } else {
              setbuttonPay("This code already used");
            }
          } else {
            setbuttonPay("Invalid code!");
          }
        } catch (err) {
        } finally {
        }
      }
    };
    const paymentsuccess = async (formdata) => {
      try {
        await axios.post(
          `${apiURLAiFile}CreateuserSubscriptionLockFile`,
          formdata,
          {
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
            },
          }
        );

        setMessage("Payment successful! 🎉");
        seterrr(false);
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } catch (err) {
        console.error("Success handler error:", err);
        setMessage("Payment was captured, but post-process failed.");
        seterrr(true);
      } finally {
        setspinners(false);
      }
    };

    return (
      <form onSubmit={handleSubmit} action="javascript:void(0)" method="post">
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

        <div className="d-grid gap-2 d-md-flex justify-content-md-end mt-4">
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
          <p className={errr ? " mt-3 error_pop" : "success_pop mt-3"}>
            {message}
          </p>
        )}
      </form>
    );
  };

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

              <div className="price-tag">
                Credit: €{getDataroompay.perInstance_Fee}
              </div>
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
                  To generate a diligence report, all documents in the data room
                  must be locked.
                </div>
              </div>
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
                  Documents in the data room are editable until the first
                  diligence report is generated.
                </div>
              </div>
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
                  After generating a diligence report, you can still manage
                  documents, but they must be locked, and credits are required
                  to create a new version.
                </div>
              </div>
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
                  Additional document generation:{" "}
                  <strong>€{getDataroompay.perInstance_Fee}</strong> per
                  instance.
                </div>
              </div>
            </div>

            <div className="payment-methods">
              <div className="accepted-cards pt-2">
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
                  <CheckoutForm payment={getDataroompay.perInstance_Fee} />
                </Elements>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default LockFilePayment;
