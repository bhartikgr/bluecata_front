import React, { useState, useEffect } from "react";
import "react-datepicker/dist/react-datepicker.css";
import TopBar from "../../components/Users/TopBar";
import "bootstrap/dist/css/bootstrap.min.css";
import { Check } from "lucide-react";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/RegisterStyles";
import "react-big-calendar/lib/css/react-big-calendar.css";
import ModuleSideNav from "../../components/Users/ModuleSideNav";
import axios from "axios";
import stripePromise from "../../config/stripe";
import { IoCloseCircleOutline } from "react-icons/io5";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";
import { Button } from "../../components/Styles/MainStyle.js";
import PaymentPopupAcademy from "../../components/Users/PaymentPopupAcademy";
import AirwallexPaymentPopupOneTimeDataroom from "../../components/Users/AirwallexPaymentPopupOneTimeDataroom.jsx";
export default function SubscriptionUser() {
  document.title = "Pricing Plan";
  const [isCollapsed, setIsCollapsed] = useState(false);
  const apiURLAiFile = "http://localhost:5000/api/user/aifile/";
  const apiUrlModule = "http://localhost:5000/api/admin/module/";
  const apiURLRegister = "http://localhost:5000/api/user/";
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [CompanyPlans, setCompanyPlans] = useState(false);
  const [checkModulesub, setcheckModulesub] = useState(false);
  const [showPopupPay, setShowPopupPay] = useState(false);
  const [PayidOnetime, setPayidOnetime] = useState("");
  const [paymentType, setpaymentType] = useState("Onetime");
  const [getDataroompay, setgetDataroompay] = useState("");
  const [showPopup, setShowPopup] = useState(false);
  const [payinfo, setpayinfo] = useState(true);
  useEffect(() => {
    checkSubscriptionPlan();
  }, [CompanyPlans]);
  const checkSubscriptionPlan = async () => {
    try {
      const res = await axios.post(
        apiURLAiFile + "checkuserSubscriptionThreeMonth",
        {
          company_id: userLogin.companies[0].id,
        }
      );
      const data = res.data.results;

      if (data.length > 0) {
        setCompanyPlans(true);
      } else {
        //setShowPopup(true);
        setCompanyPlans(false);
      }

      //setCompanyPlans(data);
    } catch (err) {
      console.error("Error fetching subscription plans:", err);
    }
  };
  useEffect(() => {
    checkmodulesubscription();
  }, []);
  const checkmodulesubscription = async () => {
    let formdata = {
      company_id: userLogin.companies[0].id,
    };
    try {
      const res = await axios.post(
        apiURLRegister + "checkmodulesubscription",
        formdata,
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
        }
      );
      console.log(res.data.results);
      if (res.data.results.length > 0) {
        setcheckModulesub(true);
      } else {
        setcheckModulesub(false);
      }
    } catch (err) { }
  };
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
  const handlePaymentPopup = () => {
    setShowPopup(true);
  };
  const handlePaymentPopupAcadmey = () => {
    setShowPopupPay(true);
  };
  const handleClosepayPopup = () => {
    setShowPopup(false);
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
    const [err, seterr] = useState(false);
    const [ClientIP, setClientIP] = useState("");
    setTimeout(() => {
      setMessage("");
    }, 5000);
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

      setspinners(true);

      try {
        // Get clientSecret from backend
        const { data } = await axios.post(
          `${apiURLAiFile}CreateuserSubscriptionDataRoomCheck`,
          {
            company_id: userLogin.companies[0].id,
            amount: mainamount, // in EUR
          }
        );

        if (!data.clientSecret) {
          // Free subscription case
          setMessage(data.message || "Subscription activated without payment.");
          seterr(false);
          setspinners(false);

          const formdata = {
            code: referalCode,
            company_id: userLogin.companies[0].id,
            created_by_id: userLogin.id,
            amount: mainamount,
            clientSecret: null,
            PayidOnetime: PayidOnetime,
            payment_status: "free",
            discount: discount,
            ip_address: ClientIP,
          };

          if (paymentType === "Perinstance") {
            await paymentsuccessPerinstnace(formdata);
          } else {
            await paymentsuccess(formdata);
          }

          return; // exit the function, no Stripe call needed
        }

        // Paid subscription case
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
          const formdata = {
            code: referalCode,
            company_id: userLogin.companies[0].id,
            created_by_id: userLogin.id,
            amount: mainamount,
            clientSecret: data.clientSecret,
            PayidOnetime: PayidOnetime,
            payment_status: result.paymentIntent.status,
            discount: discount,
            ip_address: ClientIP,
          };
          if (paymentType === "Perinstance") {
            await paymentsuccessPerinstnace(formdata);
          } else {
            await paymentsuccess(formdata);
          }
        } else {
          setMessage("Payment failed. Try again.");
          seterr(true);
          setspinners(false);
        }
      } catch (error) {
        setMessage("Unexpected error occurred.");
        seterr(true);
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
          type: "Dataroom_Plus_Investor_Report",
          company_id: userLogin.companies[0].id,
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
                (getDataroompay.onetime_Fee * data.percentage) / 100;
              const final = getDataroompay.onetime_Fee - discountValue;
              setmainamount(final);
              setbuttonPay("");
            } else {
              setdiscount("");
              setmainamount(getDataroompay.onetime_Fee);
              setbuttonPay("This code already used");
            }
          } else {
            setdiscount("");
            setmainamount(getDataroompay.onetime_Fee);
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
          `${apiURLAiFile}CreateuserSubscriptionDataRoom`,
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
    const paymentsuccessPerinstnace = async (formdata) => {
      try {
        await axios.post(
          `${apiURLAiFile}CreateuserSubscriptionDataRoomPerinstance`,
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

    return (
      <form onSubmit={handleSubmit}>
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

        <div className="d-flex gap-2 d-md-flex justify-content-md-end mt-4">
          <div className="d-flex flex-column">
            <input
              type="text"
              name="refferal_code"
              defaultValue={referalCode}
              onInput={handleRefferalCode}
              className="form-control w-auto"
              autoComplete="off"
              placeholder="Apply Referral Code"
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
        </div>

        {discount && (
          <div className="d-flex gap-2 d-md-flex justify-content-md-end mt-4">
            <b>Discount:</b> {discount}%
          </div>
        )}
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
          <p className={err ? " mt-3 error_pop" : "success_pop mt-3"}>
            {message}
          </p>
        )}
      </form>
    );
  };
  const handleSubmitPay = () => { };
  return (
    <>
      <Wrapper>
        <div className="fullpage d-block">
          <div className="d-flex align-items-start gap-0">
            <ModuleSideNav
              isCollapsed={isCollapsed}
              setIsCollapsed={setIsCollapsed}
            />
            <div
              className={`global_view ${isCollapsed ? "global_view_col" : ""}`}
            >
              <TopBar />
              <SectionWrapper className="d-block p-md-4 p-3">
                <div className="container-fluid">
                  <div className="subscription-header">
                    <div className="subscription-title">
                      <h1>Your Package Subscriptions</h1>
                      <p>Manage your active plans and services</p>
                    </div>
                  </div>
                  <div className="row gy-5 py-3">
                    <div className="col-md-4">
                      <div className="package_card">
                        <div className="d-flex flex-column gap-0">
                          <div className="d-flex flex-column gap-2 card_top">
                            <h3>Investor Ops</h3>
                            <ul className="d-flex flex-column gap-1">
                              <li>
                                €{getDataroompay?.onetime_Fee} Euro annual.
                              </li>
                              <li>Unlimited stakeholders</li>
                              <li>Start unlimited investment rounds</li>
                              <li>Unlimited investor reports</li>
                              <li>Facilitate the close of rounds</li>
                            </ul>
                          </div>
                          <div className="inner_card d-flex flex-column gap-2">
                            <span className="mainp text-white">Includes :</span>
                            <div className="d-flex flex-column gap-2">
                              <h4>Dataroom Management</h4>
                              <div className="d-flex flex-column gap-1">
                                <div className="d-flex align-items-start gap-1">
                                  <Check
                                    width={18}
                                    className="text-white flex-shrink-0"
                                  />
                                  <p>
                                    Centralize key investor documents and
                                    streamline your due diligence prep.
                                  </p>
                                </div>
                                <div className="d-flex align-items-start gap-1">
                                  <Check
                                    width={18}
                                    className="text-white flex-shrink-0"
                                  />
                                  <p>
                                    Receive one free executive summary to share
                                    with investors; additional copies cost €
                                    {getDataroompay?.perInstance_Fee}
                                    each.
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className="d-flex flex-column gap-2">
                              <h4>Cap Table Management :</h4>
                              <div className="d-flex flex-column gap-1">
                                <div className="d-flex align-items-start gap-1">
                                  <Check
                                    width={18}
                                    className="text-white flex-shrink-0"
                                  />
                                  <p>Know who owns what in your company.</p>
                                </div>
                              </div>
                            </div>
                            <div className="d-flex flex-column gap-2">
                              <h4>Investor Reporting Module :</h4>
                              <div className="d-flex flex-column gap-1">
                                <div className="d-flex align-items-start gap-1">
                                  <Check
                                    width={18}
                                    className="text-white flex-shrink-0"
                                  />
                                  <p>
                                    Ensure that you connect with your investors
                                    with updates. No more ‘out of sight, out of
                                    mind’!.
                                  </p>
                                </div>
                              </div>
                            </div>
                            <div className="mt-3">
                              {CompanyPlans ? (
                                <button
                                  className="activate_btn border-0 active_sb"
                                  type="button"
                                >
                                  Active
                                </button>
                              ) : (
                                <button
                                  className="activate_btn border-0"
                                  type="button"
                                  onClick={handlePaymentPopup}
                                >
                                  Pay Now
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="card_reco">
                          <p>Recommended</p>
                        </div>
                      </div>
                    </div>
                    <div className="col-md-4">
                      <div className="package_card h-100">
                        <div className="d-flex flex-column gap-0 h-100">
                          <div className="d-flex flex-column gap-2 card_top">
                            <h3>Learn To Raise</h3>
                            <ul className="d-flex flex-column gap-1">
                              <li>
                                €{getDataroompay?.academy_Fee} Euro (one-time).
                              </li>
                              <li>Join live investor meetings</li>
                              <li>Learn to pitch and raise capital</li>
                              <li>Access for 3 team members</li>
                              <li>Set up your company the right way</li>
                            </ul>
                          </div>
                          <div className="inner_card d-flex flex-column gap-2 h-100">
                            <span className="mainp text-white">Includes :</span>
                            <div className="d-flex flex-column justify-content-between h-100">
                              <div className="d-flex flex-column gap-2">
                                <div className="d-flex flex-column gap-2">
                                  <div className="d-flex align-items-start gap-1">
                                    <p>
                                      Launch your startup the smart way: join
                                      live investor meetings, master your pitch,
                                      and raise capital. Get access for 3 team
                                      members and set up your company for
                                      success from day one.
                                    </p>
                                  </div>
                                  <div className="d-flex align-items-start gap-1">
                                    <p>
                                      Launch your startup the smart way: join
                                      live investor meetings, master your pitch,
                                      and raise capital. Get access for 3 team
                                      members and set up your company for
                                      success from day one.
                                    </p>
                                  </div>
                                </div>
                              </div>

                              <div className="mt-3">
                                {checkModulesub ? (
                                  <button
                                    className="activate_btn border-0 active_sb"
                                    type="button"
                                  >
                                    Active
                                  </button>
                                ) : (
                                  <button
                                    className="activate_btn border-0"
                                    type="button"
                                  >
                                    Pay Now
                                  </button>
                                  // <button
                                  //   className="activate_btn border-0"
                                  //   type="button"
                                  //   onClick={handlePaymentPopupAcadmey}
                                  // >
                                  //   Activate Now
                                  // </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="card_reco">
                          <p>Optional</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </SectionWrapper>
            </div>
          </div>
        </div>
      </Wrapper>
      {/******Payment Popup********/}
      {showPopup && (
        <AirwallexPaymentPopupOneTimeDataroom
          show={showPopup}
          onClose={() => setShowPopup(false)}
          payment={getDataroompay.onetime_Fee}
          referstatus={true}
        />
      )}
      {/* {showPopup && (
        <div className="payment_modal-overlay" onClick={handleClosepayPopup}>
          <div
            className="modal-container scroll_bar"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-title-section">
                <h5 className="modal-title">Payment</h5>

                {payinfo && (
                  <div className="price-tag">
                    €{getDataroompay.onetime_Fee}
                    <span className="billing-cycle">/year</span>
                  </div>
                )}
                <p>
                  {" "}
                  <strong>
                    {" "}
                    Dataroom Management & Diligence + Investor Reporting
                  </strong>
                </p>
              </div>
              <button
                type="button"
                className="close_btn_global"
                onClick={handleClosepayPopup}
                aria-label="Close"
              >
                <IoCloseCircleOutline size={24} />
              </button>
            </div>

            {payinfo && (
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
                      <strong>Dataroom Management:</strong> Centralize key
                      investor documents and streamline your due diligence prep.
                      Receive one free executive summary to share with
                      investors; additional copies cost €
                      {getDataroompay.perInstance_Fee} each.
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
                      <strong>Cap Table Management:</strong> Know who owns what
                      in your company.
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
                      <strong>Investor Reporting:</strong> Ensure that you
                      connect with your investors with updates. No more “out of
                      sight, out of mind!”
                    </div>
                  </div>
                </div>
              </div>
            )}

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
                  <CheckoutForm payment={getDataroompay.onetime_Fee} />
                </Elements>
              </div>
            </div>
          </div>
        </div>
      )} */}
      {/******Payment Popup********/}

      <PaymentPopupAcademy
        paytmmodule={getDataroompay.academy_Fee}
        show={showPopupPay}
        onClose={() => setShowPopupPay(false)}
      />
      <style jsx>{`
        .subscription-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-bottom: 2rem;
          padding-bottom: 1rem;
          border-bottom: 1px solid #e5e7eb;
        }

        .subscription-title h1 {
          font-size: 2rem;
          font-weight: 700;
          color: #0a0a0a;
          margin: 0 0 0.5rem 0;
        }

        .subscription-title p {
          color: #6b7280;
          margin: 0;
          font-size: 1.1rem;
        }

        .subscription-count {
          background: #f8fafc;
          padding: 0.5rem 1rem;
          border-radius: 20px;
          font-size: 0.9rem;
          color: #6b7280;
        }

        .empty-state {
          text-align: center;
          padding: 4rem 2rem;
          background: #f8fafc;
          border-radius: 12px;
          margin: 2rem 0;
        }

        .empty-icon {
          color: #9ca3af;
          margin-bottom: 1.5rem;
        }

        .empty-state h3 {
          font-size: 1.5rem;
          color: #374151;
          margin: 0 0 1rem 0;
        }

        .empty-state p {
          color: #6b7280;
          margin: 0;
        }

        .subscription-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 1.5rem;
          margin-top: 2rem;
        }

        .subscription-card {
          background: #fff;
          border-radius: 16px;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
          overflow: hidden;
          transition: all 0.3s ease;
          border: 1px solid #f1f5f9;
        }

        .subscription-card:hover {
          transform: translateY(-4px);
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
        }

        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          padding: 1.5rem;
          background: linear-gradient(135deg, #efefef 0%, #efefef 100%);
          border-bottom: 1px solid #e5e7eb;
        }

        .card-title-section {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .card-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          border-radius: 12px;
          background: linear-gradient(
            135deg,
            var(--primary) 0%,
            var(--primary-icon) 100%
          );
          color: white;
          flex-shrink: 0;
        }

        .card-header h3 {
          font-size: 1.25rem;
          font-weight: 600;
          color: #0a0a0a;
          margin: 0;
        }

        .status-badge {
          padding: 0.25rem 0.75rem;
          border-radius: 20px;
          font-size: 0.75rem;
          font-weight: 600;
        }

        .status-active {
          background: #ecfdf5;
          color: #065f46;
        }

        .status-inactive {
          background: #fef2f2;
          color: #991b1b;
        }

        .card-body {
          padding: 1.5rem;
        }

        .price-section {
          display: flex;
          align-items: baseline;
          gap: 0.25rem;
          margin-bottom: 1.5rem;
        }

        .price {
          font-size: 1.75rem;
          font-weight: 700;
          color: #0a0a0a;
        }

        .period {
          color: #6b7280;
          font-size: 0.9rem;
        }

        .details-grid {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
        }

        .detail-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          color: #6b7280;
          font-size: 0.9rem;
        }

        .detail-item svg {
          flex-shrink: 0;
        }

        .features-section h4 {
          font-size: 1rem;
          font-weight: 600;
          color: #374151;
          margin: 0 0 1rem 0;
        }

        .features-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .features-list li {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.9rem;
          color: #4b5563;
        }

        .features-list li svg {
          color: #10b981;
          flex-shrink: 0;
        }

        @media (max-width: 768px) {
          .subscription-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 1rem;
          }

          .subscription-title h1 {
            font-size: 1.75rem;
          }

          .subscription-grid {
            grid-template-columns: 1fr;
          }

          .card-header {
            flex-direction: column;
            align-items: flex-start;
            gap: 1rem;
          }
        }
      `}</style>
    </>
  );
}
