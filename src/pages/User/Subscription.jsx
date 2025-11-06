import React, { useState, useEffect } from "react";
import "react-datepicker/dist/react-datepicker.css";
import TopBar from "../../components/Users/TopBar";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  SectionWrapper,
  Wrapper,
} from "../../components/Styles/RegisterStyles";
import moment from "moment";
import { momentLocalizer } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import { format, toZonedTime } from "date-fns-tz";
import ModuleSideNav from "../../components/Users/ModuleSideNav";
import axios from "axios";

export default function Subscription() {
  document.title = "Your Active Plan";
  const localizer = momentLocalizer(moment);
  const [plans, setplans] = useState([]);
  const [selectedPeriod, setSelectedPeriod] = useState("monthly");
  const [showPopup, setShowPopup] = useState(false);
  const [planId, setplanId] = useState("");
  const apiUrl = "http://localhost:5000/api/user/";
  const storedUsername = localStorage.getItem("SignatoryLoginData");
  const userLogin = JSON.parse(storedUsername);
  const [userPlans, setUserPlans] = useState([]);
  const [isCollapsed, setIsCollapsed] = useState(false);
  useEffect(() => {
    getallSubscriptionPlan();
  }, []);

  const getallSubscriptionPlan = async () => {
    try {
      const res = await axios.post(apiUrl + "getusersSubscriptionPlan", {
        company_id: userLogin.companies[0].id,
      });
      const data = res.data.results;

      if (!data) {
        console.error("No subscription data received");
        return;
      }

      const plans = [];

      if (data.dataroomOneTime) {
        plans.push({
          name: "Dataroom Management + Investor Reporting (One-Time)",
          status: data.dataroomOneTime.status || "N/A",
          price: `€${data.dataroomOneTime.price}`,
          renewalDate:
            formatCurrentDate(data.dataroomOneTime.end_date) || "N/A",
          lastPayment:
            formatCurrentDate(data.dataroomOneTime.start_date) || "N/A",
          features: [
            "Dataroom: Centralize documents & streamline due diligence; 1 free executive summary, additional copies €100 each",
            "Cap Table: Track who owns what in the company",
            "Investor Reporting: Keep investors updated; maintain engagement",
          ],
          type: "dataroom",
          period: "Annual",
        });
      }

      if (data.investorReporting) {
        plans.push({
          name: "Investor Reporting",
          status: data.investorReporting.status || "N/A",
          price: `€${data.investorReporting.price}`,
          renewalDate:
            formatCurrentDate(data.investorReporting.end_date) || "N/A",
          lastPayment:
            formatCurrentDate(data.investorReporting.start_date) || "N/A",
          features: [
            "Monthly investor updates",
            "Download reports",
            "Analytics dashboard",
          ],
          type: "reporting",
          period: "Annual",
        });
      }

      if (data.perInstancePurchases?.length > 0) {
        data.perInstancePurchases.forEach((instance, i) => {
          plans.push({
            name: `Per Instance #${i + 1}`,
            status: instance.payment_status || "N/A",
            price: `€${instance.price}`,
            lastPayment: formatCurrentDate(instance.created_at) || "N/A",
            features: ["One-time report", "Single-use instance"],
            type: "instance",
            period: "Per Instance (Additional generations €100 each)",
          });
        });
      }

      if (data.academySubscription) {
        plans.push({
          name: "International Entrepreneur Academy",
          status: data.academySubscription.status || "N/A",
          price: `€${data.academySubscription.price || 0}`,
          lastPayment:
            formatCurrentDate(data.academySubscription.created_at) || "N/A",
          features: [
            "Access to all modules",
            "One-time payment",
            "Global entrepreneurship insights",
          ],
          type: "academy",
          period: "Annual",
        });
      }

      setUserPlans(plans);
    } catch (err) {
      console.error("Error fetching subscription plans:", err);
    }
  };

  function formatCurrentDate(input) {
    const date = new Date(input);
    if (isNaN(date)) return "";
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();

    const getOrdinal = (n) => {
      if (n >= 11 && n <= 13) return "th";
      switch (n % 10) {
        case 1:
          return "st";
        case 2:
          return "nd";
        case 3:
          return "rd";
        default:
          return "th";
      }
    };

    return `${month} ${day}${getOrdinal(day)}, ${year}`;
  }

  // Get icon based on subscription type
  const getSubscriptionIcon = (type) => {
    switch (type) {
      case "dataroom":
        return (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M21 4H3C1.89543 4 1 4.89543 1 6V18C1 19.1046 1.89543 20 3 20H21C22.1046 20 23 19.1046 23 18V6C23 4.89543 22.1046 4 21 4Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M1 10H23"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case "reporting":
        return (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M14 2H6C5.46957 2 4.96086 2.21071 4.58579 2.58579C4.21071 2.96086 4 3.46957 4 4V20C4 20.5304 4.21071 21.0391 4.58579 21.4142C4.96086 21.7893 5.46957 22 6 22H18C18.5304 22 19.0391 21.7893 19.4142 21.4142C19.7893 21.0391 20 20.5304 20 20V8L14 2Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M16 17H8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M16 13H8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M10 9H9H8"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M14 2V8H20"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      case "academy":
        return (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 14C15.3137 14 18 11.3137 18 8C18 4.68629 15.3137 2 12 2C8.68629 2 6 4.68629 6 8C6 11.3137 8.68629 14 12 14Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M4 14V16C4 17.5913 4.63214 19.1174 5.75736 20.2426C6.88258 21.3679 8.4087 22 10 22H14C15.5913 22 17.1174 21.3679 18.2426 20.2426C19.3679 19.1174 20 17.5913 20 16V14"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M8 18H16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
      default:
        return (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12 16V12"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M12 8H12.01"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        );
    }
  };

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
                      <h1>Your Subscriptions</h1>
                      <p>Manage your active plans and services</p>
                    </div>
                    <div className="subscription-count">
                      <span>{userPlans.length} active plans</span>
                    </div>
                  </div>

                  {userPlans.length === 0 ? (
                    <div className="empty-state">
                      <div className="empty-icon">
                        <svg
                          width="64"
                          height="64"
                          viewBox="0 0 24 24"
                          fill="none"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <path
                            d="M15 5V7M15 11V13M15 17V19M5 5C5 6.10457 4.10457 7 3 7C4.10457 7 5 7.89543 5 9C5 7.89543 5.89543 7 7 7C5.89543 7 5 6.10457 5 5ZM12 5C12 6.10457 11.1046 7 10 7C11.1046 7 12 7.89543 12 9C12 7.89543 12.8954 7 14 7C12.8954 7 12 6.10457 12 5ZM19 5C19 6.10457 18.1046 7 17 7C18.1046 7 19 7.89543 19 9C19 7.89543 19.8954 7 21 7C19.8954 7 19 6.10457 19 5ZM5 12C5 13.1046 4.10457 14 3 14C4.10457 14 5 14.8954 5 16C5 14.8954 5.89543 14 7 14C5.89543 14 5 13.1046 5 12ZM12 12C12 13.1046 11.1046 14 10 14C11.1046 14 12 14.8954 12 16C12 14.8954 12.8954 14 14 14C12.8954 14 12 13.1046 12 12ZM19 12C19 13.1046 18.1046 14 17 14C18.1046 14 19 14.8954 19 16C19 14.8954 19.8954 14 21 14C19.8954 14 19 13.1046 19 12Z"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                      <h3>No subscriptions yet</h3>
                      <p>
                        You don't have any active subscriptions at the moment.
                      </p>
                    </div>
                  ) : (
                    <div className="subscription-grid">
                      {userPlans.map((plan, index) => {
                        const cleanDateStr = plan.renewalDate
                          ? plan.renewalDate.replace(/(\d+)(st|nd|rd|th)/, "$1")
                          : null;

                        const endDate = cleanDateStr
                          ? new Date(cleanDateStr)
                          : null;

                        const currentDate = new Date();
                        let status;

                        if (
                          plan.name === "International Entrepreneur Academy"
                        ) {
                          status = "Active";
                        } else {
                          status =
                            endDate && endDate >= currentDate
                              ? "Active"
                              : "Inactive";
                        }

                        return (
                          <div className="subscription-card" key={index}>
                            <div className="card-header">
                              <div className="card-title-section">
                                <div className="card-icon">
                                  {getSubscriptionIcon(plan.type)}
                                </div>
                                <h3>{plan.name}</h3>
                              </div>
                              {!plan.name.includes("Per Instance") && (
                                <span
                                  className={`status-badge status-${status.toLowerCase()}`}
                                >
                                  {status}
                                </span>
                              )}
                            </div>

                            <div className="card-body">
                              <div className="price-section">
                                <span className="price">{plan.price}</span>
                                {plan.renewalDate && (
                                  <span className="period">/{plan.period}</span>
                                )}
                              </div>

                              <div className="details-grid">
                                {plan.renewalDate && (
                                  <div className="detail-item">
                                    <svg
                                      width="16"
                                      height="16"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      xmlns="http://www.w3.org/2000/svg"
                                    >
                                      <path
                                        d="M19 4H5C3.89543 4 3 4.89543 3 6V20C3 21.1046 3.89543 22 5 22H19C20.1046 22 21 21.1046 21 20V6C21 4.89543 20.1046 4 19 4Z"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                      <path
                                        d="M16 2V6"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                      <path
                                        d="M8 2V6"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                      <path
                                        d="M3 10H21"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                    <span>Renews: {plan.renewalDate}</span>
                                  </div>
                                )}

                                <div className="detail-item">
                                  <svg
                                    width="16"
                                    height="16"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    xmlns="http://www.w3.org/2000/svg"
                                  >
                                    <path
                                      d="M12 22C17.5228 22 22 17.5228 22 12C22 6.47715 17.5228 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22Z"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                    <path
                                      d="M12 6V12L16 14"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                  <span>Last payment: {plan.lastPayment}</span>
                                </div>
                              </div>

                              <div className="features-section">
                                <h4>Features</h4>
                                <ul className="features-list">
                                  {plan.features.map((feature, i) => (
                                    <li key={i}>
                                      <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        xmlns="http://www.w3.org/2000/svg"
                                      >
                                        <path
                                          d="M20 6L9 17L4 12"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                        />
                                      </svg>
                                      {feature}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </SectionWrapper>
            </div>
          </div>
        </div>
      </Wrapper>

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
