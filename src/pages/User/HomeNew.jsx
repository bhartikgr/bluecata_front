import React, { useState, useRef, useEffect } from "react";
import { ImQuotesRight } from "react-icons/im";

import {
  MoveRight,
  Share2,
  Facebook,
  Instagram,
  Linkedin,
  ChevronLeft,
  ChevronRight,
  Check,
} from "lucide-react";
import { FaXTwitter } from "react-icons/fa6";
import HomeHeader from "../../components/Users/HomeHeader";
import HomeFooter from "../../components/Users/HomeFooter";
import {
  SectionBox,
  Aboutbox,
  ServiceBox,
  TeamBox,
  TestimonialBox,
  ContactBox,
  PortfolioBox,
  BrandBox,
  Faq,
  VideoBox,
  InvestmentSection,
  Dataroom,
  Exclusive,
  PrimaryButton,
} from "../../components/Styles/HomeNewStyles";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import { Play, FileText } from "lucide-react";
import VideoPopup from "../../components/Users/VideoPopup";
import { VideoPopupStyles } from "../../components/Styles/VideoPopupStyles";
import axios from "axios";

const accordionItems = [
  {
    id: "One",
    title: "Who should apply to the Angel Investment Simulator?",
    content: [
      "The program is ideal for early-stage startup founders preparing for or navigating seed to Series B funding rounds. It is a real-time, investor-led North American perspective on positioning your company to close rounds. If you want to sharpen your fundraising skills, understand how investors think, and gain practical tools to scale your venture, this Academy was designed for you.",
    ],
  },
  {
    id: "Two",
    title:
      "What can participants expect to gain from the Angel Investment Simulator?",
    content: [
      "Founders will walk away with investor-backed insights on term sheets, due diligence, valuations, and deal structuring—plus direct access to active investors and experienced entrepreneurs. You’ll not only learn the playbook, but you’ll also build the relationships to help you play it right.",
    ],
  },
  {
    id: "Three",
    title:
      "What is the BluePrint Catalyst Data Room and Due Diligence Platform?",
    content: [
      "It's a powerful platform explicitly designed for early-stage startups to build a structured, investor-ready data room and create an effective starter due diligence document. It helps founders streamline the investment process by organizing key financial, legal, and operational information.",
    ],
  },
  {
    id: "Four",
    title: "How does the platform improve my chances of getting investment?",
    content: [
      "By simplifying and standardizing due diligence, you’re able to present your business with confidence, clarity, and credibility. This makes it easier for investors to evaluate your opportunity and accelerates meaningful funding conversations.",
    ],
  },
  {
    id: "Five",
    title: "What is the BluePrint Catalyst Quarterly Investor Update Platform?",
    content: [
      "It’s a structured investor communication tool designed specifically to help founders deliver polished, consistent, and impactful updates. By consolidating key performance metrics, milestones, and challenges into one clear format, founders can build trust while saving time.",
    ],
  },
  {
    id: "Six",
    title: "Why does consistent investor communication matter?",
    content: [
      "Transparent updates show you're in control, focused, and aware of your progress. This builds investor confidence, strengthens relationships, and keeps your business top-of-mind for future funding opportunities.",
    ],
  },
];

const PrevArrow = ({ className, style, onClick }) => (
  <div className={className} style={{ ...style, zIndex: 1 }} onClick={onClick}>
    <ChevronLeft size={28} color="#000" />
  </div>
);

const NextArrow = ({ className, style, onClick }) => (
  <div className={className} style={{ ...style, zIndex: 1 }} onClick={onClick}>
    <ChevronRight size={28} color="#000" />
  </div>
);

const testimonials = [
  {
    text: "Their team didn’t just invest in us—they rolled up their sleeves and drove real traction in sales and market reach.",
    name: "John Doe",
    title: "CEO, Company Name",
    img: "/assets/user/images/person.jpg",
  },
  {
    text: "This partnership accelerated our journey, giving us not only capital but critical introductions that turned into key customers.",
    name: "Jane Smith",
    title: "Co-Founder, StartupX",
    img: "/assets/user/images/person.jpg",
  },
  {
    text: "From pitch to product-market fit, they provided strategic support that helped us scale smarter and faster.",
    name: "Alex Carter",
    title: "CTO, TechGrowth",
    img: "/assets/user/images/person.jpg",
  },
  {
    text: "They understand early-stage needs and turned belief into action, guiding us through growth with hands-on expertise.",
    name: "Emily Zhao",
    title: "Founder, InnovateLab",
    img: "/assets/user/images/person.jpg",
  },
  {
    text: "I’ve discovered exceptional co-investors through this firm, each bringing global insight and unique value to the table.",
    name: "Michael Lee",
    title: "Investor, GlobalFund",
    img: "/assets/user/images/person.jpg",
  },
  {
    text: "Their network made it easy to find and collaborate with investors whose vision and conviction matched mine.",
    name: "Nina Patel",
    title: "Angel Investor",
    img: "/assets/user/images/person.jpg",
  },
  {
    text: "This community brings together global capital with local intelligence—it’s where great deals meet great minds.",
    name: "Omar Khanna",
    title: "Partner, VentureBridge",
    img: "/assets/user/images/person.jpg",
  },
  {
    text: "Working with fellow investors across continents has expanded my portfolio and perspective in ways I hadn’t expected.",
    name: "Lina Gomez",
    title: "Investor, Horizon Capital",
    img: "/assets/user/images/person.jpg",
  },
];

export default function HomeNew() {
  const [messagecontact, setmessagecontact] = useState("");
  const [errcontact, seterrcontact] = useState(false);
  document.title = "BLUEPRINT CATALYST.LTD";
  var settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 4,
    slidesToScroll: 1,
    autoplay: true, // Enable autoplay
    autoplaySpeed: 3000,
    nextArrow: <NextArrow />,
    prevArrow: <PrevArrow />,
    responsive: [
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 3,
        },
      },
      {
        breakpoint: 768,
        settings: {
          slidesToShow: 2,
        },
      },
      {
        breakpoint: 576,
        settings: {
          slidesToShow: 1,
        },
      },
    ],
  };
  var settings3 = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 3,
    slidesToScroll: 1,
    autoplay: true, // Enable autoplay
    autoplaySpeed: 3000,
    nextArrow: <NextArrow />,
    prevArrow: <PrevArrow />,
    responsive: [
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 3,
        },
      },
      {
        breakpoint: 768,
        settings: {
          slidesToShow: 2,
        },
      },
      {
        breakpoint: 576,
        settings: {
          slidesToShow: 1,
        },
      },
    ],
  };

  var settings4 = {
    dots: true,
    infinite: true,
    slidesToShow: 6,
    slidesToScroll: 1,
    arrows: false,
    autoplay: true,
    dots: false,
    speed: 2000,
    autoplaySpeed: 0,
    cssEase: "ease-in-out",
    pauseOnHover: true,
    responsive: [
      {
        breakpoint: 1024,
        settings: {
          slidesToShow: 3,
          speed: 1500,
        },
      },
      {
        breakpoint: 768,
        settings: {
          slidesToShow: 2,
          speed: 1200,
        },
      },
      {
        breakpoint: 576,
        settings: {
          slidesToShow: 2,
          speed: 1000,
        },
      },
    ],
  };
  var settings2 = {
    dots: true,
    infinite: true,
    speed: 200,
    slidesToShow: 1,
    slidesToScroll: 1,
    arrows: false,
    autoplay: true,
    autoplaySpeed: 5000,
  };

  var quotes = {
    dots: false,
    infinite: true,
    speed: 200,
    slidesToShow: 1,
    slidesToScroll: 1,
    arrows: false,
    autoplay: true,
    autoplaySpeed: 5000,
  };

  const [openItemId, setOpenItemId] = useState(null);
  const [isVideoPopupOpen, setIsVideoPopupOpen] = useState(false);
  const videoId = "YOUR_YOUTUBE_VIDEO_ID"; // Replace with your actual YouTube video ID

  const toggleAccordion = (id) => {
    setOpenItemId((prevId) => (prevId === id ? null : id));
  };
  const handleViewPdf = () => {
    const url = encodeURI(
      "/Introductory Presentation - BluePrint Catalyst - 2025.pdf"
    );
    window.open(url, "_blank");
  };

  const [expandedIndex, setExpandedIndex] = useState(null);
  const contentRefs = [useRef(null), useRef(null), useRef(null), useRef(null)];
  const [heights, setHeights] = useState(["0px", "0px", "0px", "0px"]);

  const toggle = (index) => {
    const newExpanded = expandedIndex === index ? null : index;
    setExpandedIndex(newExpanded);

    const newHeights = [...heights];
    newHeights.forEach((_, i) => {
      newHeights[i] =
        i === newExpanded && contentRefs[i].current
          ? `${contentRefs[i].current.scrollHeight}px`
          : "0px";
    });
    setHeights(newHeights);
  };
  var apiURL = "http://localhost:5000/api/user/";
  const handleSendContactInfo = async (e) => {
    e.preventDefault();
    var data = e.target;
    let formData = {
      first_name: data.first_name.value,
      last_name: data.first_name.value,
      phone: data.phone.value,
      email: data.email.value,
      message: data.message.value,
    };
    try {
      const res = await axios.post(apiURL + "sendcontactInfo", formData, {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json", // Ensure the content type is JSON
        },
      });
      if (res.data.success === true) {
        seterrcontact(true);
        data.reset();
      } else {
        seterrcontact(false);
      }
      setmessagecontact(res.data.message);
      setTimeout(() => {
        setmessagecontact("");
      }, 1800);
    } catch (err) { }
  };
  return (
    <>
      <HomeHeader />
      <SectionBox className="home-banner d-flex flex-column gap-5">
        <div className="videobox">
          <video
            autoPlay
            muted
            playsinline
            poster="/assets/user/images/home.jpg"
          >
            <source src="/assets/user/images/home.mp4" type="video/mp4" />
            <source src="/assets/user/images/home.mp4" type="video/mov" />
            Your browser does not support the video tag.
          </video>
        </div>
        <div className="container-fluid">
          <div className="row justify-content-center">
            <div className="col-12 col-md-10">
              <Slider {...quotes}>
                <div className="bannertext text-center">
                  <span className="qubox topqu">
                    <img src="/assets/user/images/qu1.png" alt="image" />
                  </span>
                  <h1>
                    In investing, what is comfortable is rarely profitable.
                  </h1>
                  <span className="qubox bottomqu">
                    <img src="/assets/user/images/qu2.png" alt="image" />
                  </span>
                  <div className="d-flex justify-content-end">
                    <h6>- Robert Arnott</h6>
                  </div>
                </div>
                <div className="bannertext text-center">
                  <span className="qubox topqu">
                    <img src="/assets/user/images/qu1.png" alt="image" />
                  </span>
                  <h1>Risk comes from not knowing what you’re doing.</h1>
                  <span className="qubox bottomqu">
                    <img src="/assets/user/images/qu2.png" alt="image" />
                  </span>
                  <div className="d-flex justify-content-end">
                    <h6>- Warren Buffett</h6>
                  </div>
                </div>
                <div className="bannertext text-center">
                  <span className="qubox topqu">
                    <img src="/assets/user/images/qu1.png" alt="image" />
                  </span>
                  <h1>An investment in knowledge pays the best interest.</h1>
                  <span className="qubox bottomqu">
                    <img src="/assets/user/images/qu2.png" alt="image" />
                  </span>
                  <div className="d-flex justify-content-end">
                    <h6>- Benjamin Franklin</h6>
                  </div>
                </div>
                <div className="bannertext text-center">
                  <span className="qubox topqu">
                    <img src="/assets/user/images/qu1.png" alt="image" />
                  </span>
                  <h1>Your network is your net worth.</h1>
                  <span className="qubox bottomqu">
                    <img src="/assets/user/images/qu2.png" alt="image" />
                  </span>
                  <div className="d-flex justify-content-end">
                    <h6>- Porter Gale </h6>
                  </div>
                </div>
                <div className="bannertext text-center">
                  <span className="qubox topqu">
                    <img src="/assets/user/images/qu1.png" alt="image" />
                  </span>
                  <h1>
                    If you want to go fast, go alone. If you want to go far, go
                    with others.
                  </h1>
                  <span className="qubox bottomqu">
                    <img src="/assets/user/images/qu2.png" alt="image" />
                  </span>
                  <div className="d-flex justify-content-end">
                    <h6>- African Proverb</h6>
                  </div>
                </div>
              </Slider>
            </div>
          </div>
        </div>
        {/* <div className="container-fluid">
          <div className="row gy-3">
           <div className="col-12">
              <h2 className="news-title">Latest News</h2>
            </div> 

            <div className="col-md-4">
              <a href="/" className="newsview d-flex flex-column gap-2  ">
             <div className="news-img d-block">
                  <img src="/assets/user/images/news1.jpg" alt="image" />
                </div> 
                <div className="news-text text-center">
                  <p>
                    <b>For Entrepreneurs: </b>
                    Apply for Angel Investment Simulator
                  </p>
                </div>
              </a>
            </div>
            <div className="col-md-4">
              <a href="/" className="newsview d-flex flex-column gap-2">
             <div className="news-img d-block">
                  <img src="/assets/user/images/news2.jpg" alt="image" />
                </div>
                <div className="news-text text-center">
                  <p>
                    <b>For Entrepreneurs: </b>
                    Access Dataroom, Diligence & Investor Reporting Tools
                  </p>
                </div>
              </a>
            </div>
            <div className="col-md-4">
              <a href="/" className="newsview d-flex flex-column gap-2">
               <div className="news-img d-block">
                  <img src="/assets/user/images/news3.jpg" alt="image" />
                </div> 
                <div className="news-text text-center">
                  <p>
                    <b>For Investors: </b>
                    Review Your Investments & Join our Exclusive International
                    eco-system
                  </p>
                </div>
              </a>
            </div>
          </div>
        </div> */}
      </SectionBox>
      {/* <Aboutbox className="d-block">
        <div className="container-fluid">
          <div className="row gy-4">
            <div className="col-md-6">
              <div className="bigimg d-block position-relative">
                <div className="yearexp">
                  <h4>150+</h4>
                  <h5>Industry Partners</h5>
                </div>
                <div className="about-img">
                  <img src="/assets/user/images/image1.jpg" alt="image" />
                </div>
              </div>
            </div>
            <div className="col-md-6">
              <div className="about-text d-flex flex-column gap-3">
                <h2>About Us</h2>
                <h3>Original Thinking + Global Vision = Smart Capital</h3>
                <p>
                  <b>BluePrint Catalyst Limited </b> is a global capital
                  advisory firm specializing in early-stage and growth
                  investments across Asia, Europe, and North America. With a
                  strong track record of identifying high-potential ventures, we
                  don’t just invest—we unlock value.
                </p>
                <p>
                  <b>For Entrepreneurs:</b> <br />
                  We offer more than funding. Our platform empowers founders
                  with hands-on guidance, rigorous due diligence, investor-ready
                  reporting, and access to a powerful network. The result? Smart
                  growth and long-term success.
                </p>
                <p>
                  <b>For Investors:</b> <br />
                  Through our global network and deep cross-border expertise, we
                  provide our exclusive investor partner community with a
                  reliable strategic gateway to high-growth, innovation-driven
                  opportunities.
                </p>
              </div>
              <div className="row gy-4 mt-4">
                <div className="col-md-6">
                  <div className="d-flex flex-column gap-2 extext">
                    <h5>
                      <sup>est.</sup> 2025
                    </h5>
                    <h6>With decades of expertise</h6>
                  </div>
                </div>
                <div className="col-md-6">
                  <div className="d-flex flex-column gap-2 extext">
                    <h5>250 +</h5>
                    <h6>Investment track record</h6>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Aboutbox> */}
      <ServiceBox className="d-block">
        <div className="container-fluid">
          <div className="text-center mb-5">
            <h2 className="service-title">
              BluePrint Catalyst Limited is a global platform designed
              specifically for entrepreneurs and investors. We believe that
              proper data, a worldwide network, and a well-structured deal will
              always empower everyone to make risk-aligned decisions.{" "}
            </h2>
          </div>
          <div className="row g-4">
            <div className="col-md-6 col-lg-3">
              <div className="service-card p-4 d-flex flex-column gap-3 position-relative">
                <h3>01</h3>
                <h4>Ownership Management</h4>
                <p>
                  Accelerate funding with structured, investor-ready clarity
                </p>
                <div
                  ref={contentRefs[0]}
                  className="expandable-text-wrapper"
                  style={{
                    maxHeight: heights[0],
                    overflow: "hidden",
                    transition: "max-height 0.4s ease",
                  }}
                >
                  <p className="m-0">
                    Our proprietary platform equips early-stage companies with
                    the tools to better engage with investors. It really does
                    start from the very inception of your company: cap table
                    management, data room management, round management, and
                    proper reporting are critical elements in the journey toward
                    growth and exits.
                  </p>
                </div>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    toggle(0);
                  }}
                  className="readlink d-inline-flex align-items-center gap-1"
                >
                  {expandedIndex === 0 ? "Read Less" : "Read More"}
                  <span
                    style={{
                      display: "inline-block",
                      transition: "transform 0.3s ease",
                      transform:
                        expandedIndex === 0 ? "rotate(-90deg)" : "rotate(0deg)",
                    }}
                  >
                    <MoveRight />
                  </span>
                </a>
              </div>
            </div>

            <div className="col-md-6 col-lg-3">
              <div className="service-card p-4 d-flex flex-column gap-3 position-relative">
                <h3>02</h3>
                <h4>Angel Investment Simulator</h4>
                <p>Investor-driven insights to empower founder positioning.</p>
                <div
                  ref={contentRefs[1]}
                  className="expandable-text-wrapper"
                  style={{
                    maxHeight: heights[1],
                    overflow: "hidden",
                    transition: "max-height 0.4s ease",
                  }}
                >
                  <p className="m-0">
                    The <b>International Entrepreneur Academy</b>, powered by
                    BluePrint Catalyst Limited, gives early-stage founders
                    direct access to <b>active investors</b> and seasoned
                    entrepreneurs closing seed, series A and B rounds. Through
                    real-world insights, participants learn how investors assess
                    startups, structure deals, and determine valuations. The
                    program covers critical topics like term sheets, due
                    diligence, and strategic positioning, arming founders with
                    the <b>knowledge, tools, and investor connections</b> needed
                    to scale and secure funding effectively.
                  </p>
                </div>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    toggle(1);
                  }}
                  className="readlink d-inline-flex align-items-center gap-1"
                >
                  {expandedIndex === 1 ? "Read Less" : "Read More"}
                  <span
                    style={{
                      display: "inline-block",
                      transition: "transform 0.3s ease",
                      transform:
                        expandedIndex === 1 ? "rotate(-90deg)" : "rotate(0deg)",
                    }}
                  >
                    <MoveRight />
                  </span>
                </a>
              </div>
            </div>
            <div className="col-md-6 col-lg-3">
              <div className="service-card p-4 d-flex flex-column gap-3 position-relative">
                <h3>03</h3>
                <h4>Investor Docs & Reporting</h4>
                <p>Effortless updates that strengthen trust and funding.</p>
                <div
                  ref={contentRefs[2]}
                  className="expandable-text-wrapper"
                  style={{
                    maxHeight: heights[2],
                    overflow: "hidden",
                    transition: "max-height 0.4s ease",
                  }}
                >
                  <p className="m-0">
                    Consistent communication <b>builds investor confidence</b>.
                    BluePrint Catalyst makes it effortless. Our structured{" "}
                    <b>investment document repository</b> and{" "}
                    <b>quarterly update platform</b> transform scattered updates
                    into polished, investor-ready reports. Founders save time,
                    deliver clarity, and demonstrate traction with standardized
                    reporting that tracks performance, milestones, and
                    challenges. The result? Stronger relationships, sharper
                    accountability, and a smoother path to future funding. Let
                    your updates speak volumes—without saying a word too many.
                  </p>
                </div>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    toggle(2);
                  }}
                  className="readlink d-inline-flex align-items-center gap-1"
                >
                  {expandedIndex === 2 ? "Read Less" : "Read More"}
                  <span
                    style={{
                      display: "inline-block",
                      transition: "transform 0.3s ease",
                      transform:
                        expandedIndex === 2 ? "rotate(-90deg)" : "rotate(0deg)",
                    }}
                  >
                    <MoveRight />
                  </span>
                </a>
              </div>
            </div>

            <div className="col-md-6 col-lg-3">
              <div className="service-card p-4 d-flex flex-column gap-3 position-relative">
                <h3>04</h3>
                <h4>Closed Network of Investors</h4>
                <p>Syndicated deal flow shared among vetted investors.</p>
                <div
                  ref={contentRefs[3]}
                  className="expandable-text-wrapper"
                  style={{
                    maxHeight: heights[3],
                    overflow: "hidden",
                    transition: "max-height 0.4s ease",
                  }}
                >
                  <p className="m-0">
                    We spotlight startups <b>ready to scale</b>, not just meet
                    investors. Our platform of vetting through our Academy and
                    consolidation of diligence documents helps to connect
                    high-potential companies with an{" "}
                    <b>exclusive global investor network</b>, backed by seasoned
                    partners who help sharpen strategy and accelerate growth. We
                    prepare founders to lead and succeed from positioning to
                    investment to exit. Success isn’t luck—it’s readiness,
                    refined.
                  </p>
                </div>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    toggle(3);
                  }}
                  className="readlink d-inline-flex align-items-center gap-1"
                >
                  {expandedIndex === 3 ? "Read Less" : "Read More"}
                  <span
                    style={{
                      display: "inline-block",
                      transition: "transform 0.3s ease",
                      transform:
                        expandedIndex === 3 ? "rotate(-90deg)" : "rotate(0deg)",
                    }}
                  >
                    <MoveRight />
                  </span>
                </a>
              </div>
            </div>

            {/* <div className="col-md-3">
              <div className="service-card p-4 h-100 d-flex flex-column gap-3 position-relative">
                <h3>01</h3>
                <h4>Data room & Diligence</h4>
                <p>
                  Accelerate funding with structured, investor-ready clarity.
                </p>
                <a href="#" className="readlink">
                  Read More <MoveRight />
                </a>
              </div>
            </div>
            <div className="col-md-3">
              <div className="service-card p-4 h-100 d-flex flex-column gap-3 relative">
                <h3>02</h3>
                <h4>Angel Investment Simulator</h4>
                <p>Investor-driven insights to empower founder positioning.</p>
                <a href="#" className="readlink">
                  Read More <MoveRight />
                </a>
              </div>
            </div>
            <div className="col-md-3">
              <div className="service-card p-4 h-100 d-flex flex-column gap-3 relative">
                <h3>03</h3>
                <h4>Investor Docs & Reporting</h4>
                <p>Effortless updates that strengthen trust and funding.</p>
                <a href="#" className="readlink">
                  Read More <MoveRight />
                </a>
              </div>
            </div>
            <div className="col-md-3">
              <div className="service-card p-4 h-100 d-flex flex-column gap-3 relative">
                <h3>04</h3>
                <h4>Closed Network of Investors</h4>
                <p>Syndicated deal flow shared among vetted investors.</p>
                <a href="#" className="readlink">
                  Read More <MoveRight />
                </a>
              </div>
            </div> */}
          </div>
        </div>
      </ServiceBox>
      {/* <InvestmentSection className="d-block scroll-mt-[300px]" id="angel">
        <div className="overlay d-block">
          <div className="container-fluid">
            <div className="row gy-4">
              <div className="col-12 mb-4">
                <div className="teamtitle d-flex flex-column gap-2 text-center">
                  <h2>Angel Investment Simulator</h2>
                  <h3>
                    Investor-driven insights to empower founder positioning.
                  </h3>
                </div>
              </div>

              <div className="col-12">
                <div
                  className="contentbox mx-auto"
                  style={{ maxWidth: "900px" }}
                >
                  <p>
                    The <b> Angel Investment Simulator</b> gives early-stage
                    founders direct access to <b>active investors</b> and
                    seasoned entrepreneurs closing their seed, series A and B
                    rounds. Through real-world insights, participants learn how
                    investors assess startups, structure deals, and determine
                    valuations. You will be a part of our real-life investor
                    process. Modules include:
                  </p>

                  <ul
                    className="mt-3 ps-3"
                    style={{ listStyle: "none", paddingLeft: "0" }}
                  >
                    <li>
                      <strong>1. BE THE INVESTOR:</strong> Learn directly from
                      real companies, presenting to our real investors.
                    </li>
                    <li>
                      <strong>2. GET INVESTMENT READY:</strong> Align your
                      valuation, investment structure, and term sheet for
                      investors.
                    </li>
                    <li>
                      <strong>3. POSITION YOUR PITCH:</strong> Learn directly
                      from our investors on how to position your investor deck.
                    </li>
                    <li>
                      <strong>4. PORTFOLIO DAY (TOP 20 COMPANIES):</strong>{" "}
                      Present to active investors at our exclusive quarterly
                      ‘Portfolio Day’.
                    </li>
                  </ul>
                </div>
              </div>
              <div className="col-12">
                <div className="d-flex justify-content-center">
                  <div className="d-flex gap-4 flex-column flex-md-row">
                    <PrimaryButton
                      className="download_btn"
                      target="_blank"
                      rel="noopener noreferrer"
                      href="/assets/user/images/Angel%20Investment%20Simulator%20Overview%20-%202025.pdf"
                    >
                      <img src="/assets/user/images/pdfwhite.png" alt="PDF" />
                      <b>Download</b>
                      our Simulator Overview
                    </PrimaryButton>

                    <PrimaryButton
                      href="/user/register"
                      className="download_btn"
                    >
                      <b>APPLY</b>
                      for Angel Investment Simulator
                    </PrimaryButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </InvestmentSection> */}

      {/* <Dataroom className="d-block scroll-mt-[300px]" id="dataroom">
        <div className="overlay d-block">
          <div className="container-fluid">
            <div className="row gy-4">
              <div className="col-12 mb-4">
                <div className="teamtitle d-flex flex-column gap-2 text-center">
                  <h2>
                    Data room, Due Diligence, Investment Docs & Investor
                    Reporting
                  </h2>
                  <h3>
                    Accelerate funding with structured, investor-ready clarity.
                  </h3>
                </div>
              </div>

              <div className="col-12">
                <div
                  className="contentbox mx-auto text-center"
                  style={{ maxWidth: "900px" }}
                >
                  <p>
                    BluePrint Catalyst’s Data Room and Due Diligence Platform
                    helps early-stage startups create an organized,
                    investor-ready data room and streamline reporting. With
                    tools to centralize financial, legal, and operational info,
                    founders can simplify due diligence, boost transparency, and
                    accelerate funding.
                  </p>
                  <p className="mt-3">
                    The platform’s structured updates and reporting system turn
                    scattered progress into clear, consistent investor
                    communications—building trust, saving time, and paving the
                    way for future growth.
                  </p>
                </div>
              </div>
              <div className="col-12">
                <div className="d-flex justify-content-center">
                  <div className="d-flex gap-4 flex-column flex-md-row">
                    <PrimaryButton href="/apply-link">
                      <b>ACCESS</b>
                      Dataroom, Diligence & Investor Reporting Tools
                    </PrimaryButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Dataroom> */}

      {/* <Exclusive className="d-block scroll-mt-[300px]" id="exclusive">
        <div className="overlay d-block">
          <div className="container-fluid">
            <div className="row gy-4">
              <div className="col-12 mb-4">
                <div className="teamtitle d-flex flex-column gap-2 text-center">
                  <h2>Exclusive Global Investor Alliance</h2>
                  <h3>Syndicated deal flow shared among vetted investors</h3>
                </div>
              </div>

              <div className="col-12">
                <div
                  className="contentbox mx-auto text-center"
                  style={{ maxWidth: "900px" }}
                >
                  <p>
                    Our global network of investors doesn’t just fund growth—{" "}
                    <b>they engineer it</b>. Through collaborative vetting,
                    shared diligence, and active syndication, this inclusive yet
                    exclusive group curates top-tier startups and propels them
                    toward scale.
                  </p>
                  <p className="mt-3">
                    Backed by our Angel Investment Simulator’s structured
                    readiness programs, founders gain strategic clarity while
                    investors align on deals built for traction and exit. We
                    bring the right companies to the right tables—because scale
                    starts with smart capital.
                  </p>
                </div>
              </div>
              <div className="col-12">
                <div className="d-flex justify-content-center">
                  <div className="d-flex gap-4 flex-column flex-md-row">
                    <PrimaryButton
                      href="/user/register"
                      className="download_btn"
                    >
                      <b>ACCESS</b>
                      Your Investments & Join our Exclusive International
                      eco-system
                    </PrimaryButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Exclusive> */}

      {/* <Faq className="d-block">
        <div className="container-fluid">
          <div className="row gy-4">
            <div className="col-12 mb-5">
              <div className="faqtitle d-flex flex-column gap-2 text-center">
                <h2>Frequently Asked Questions</h2>
                <h3>Get answers to common questions</h3>
              </div>
            </div>
            <div className="col-12">
              <div className="accordion" id="accordionExample">
                {accordionItems.map((item) => (
                  <div className="accordion-item rounded-0" key={item.id}>
                    <h2 className="accordion-header" id={`heading${item.id}`}>
                      <button
                        className={`accordion-button ${
                          openItemId === item.id ? "" : "collapsed"
                        }`}
                        type="button"
                        onClick={() => toggleAccordion(item.id)}
                      >
                        {item.title}
                      </button>
                    </h2>
                    <div
                      id={`collapse${item.id}`}
                      className={`accordion-collapse collapse ${
                        openItemId === item.id ? "show" : ""
                      }`}
                    >
                      <div className="accordion-body">
                        {item.content.map((p, i) => (
                          <p key={i}>{p}</p>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Faq> */}
      {/* <TestimonialBox className="d-block">
        <div className="container-fluid">
          <div className="row gy-4">
            <div className="col-12 mb-5">
              <div className="teamtitle d-flex flex-column gap-2 text-center">
                <h2>Testimonials</h2>
                <h3>What our network is saying about us</h3>
              </div>
            </div>
            <div className="col-md-8 offset-md-2 position-relative">
              <Slider {...settings2}>
                {testimonials.map((testimonial, index) => (
                  <div className="clientbox mb-4" key={index}>
                    <div className="d-flex flex-column gap-3">
                      <p>{testimonial.text}</p>

                      <div className="d-flex gap-2 align-items-center clientinfo">
                        <div className="flex-shrink-0">
                          <div className="clientimg">
                            <img src={testimonial.img} alt={testimonial.name} />
                          </div>
                        </div>
                        <div className="flex-grow-1">
                          <h5>{testimonial.name}</h5>
                          <h6>{testimonial.title}</h6>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </Slider>
              <ImQuotesRight size={100} className="quotesicon" />
            </div>
          </div>
        </div>
      </TestimonialBox> */}
      {/* <ContactBox className="d-block">
        <div className="container-fluid">
          <div className="row gy-4">
            <div className="col-12 mb-5">
              <div className="teamtitle d-flex flex-column gap-2 text-center">
                <h2>Contact Us</h2>
                <h3>Get in touch with us</h3>
              </div>
            </div>
            <div className="col-md-6">
              <div className="d-flex flex-column gap-4">
                <h3 className="contactinfo">Contact Information</h3>
                <div className="d-flex flex-column gap-2 contacttext">
                  <h4>call us now</h4>
                  <h5>
                    <a href="tel:+1234567890">+123 456 7890</a>
                  </h5>
                </div>
                <div className="d-flex flex-column gap-2 contacttext">
                  <h4>Email Us</h4>
                  <h5>
                    <a href="mailto:info@blueprintcatalyst.com">
                      blueprintcatalyst.com
                    </a>
                  </h5>
                </div>
                <div className="d-flex flex-column gap-2 contacttext">
                  <h4>visit us</h4>
                  <h5>S.G High Way, Ahmedabad - 454545</h5>
                </div>
              </div>
            </div> 
            <div className="col-md-6 mx-auto">
              <div className="d-flex flex-column gap-4 contactbox">
                <h4>Please fill out the form</h4>
                <form
                  action="javascript:void(0)"
                  onSubmit={handleSendContactInfo}
                  method="post"
                >
                  <div className="row gy-4">
                    <div className="col-md-6">
                      <input
                        type="text"
                        placeholder="First Name *"
                        name="first_name"
                        required
                      />
                    </div>
                    <div className="col-md-6">
                      <input
                        type="text"
                        placeholder="Last Name *"
                        name="last_name"
                        required
                      />
                    </div>
                    <div className="col-md-6">
                      <input
                        type="tel"
                        className="tell"
                        required
                        placeholder="Phone Number *"
                        name="phone"
                      />
                    </div>
                    <div className="col-md-6">
                      <input
                        type="email"
                        placeholder="Email *"
                        name="email"
                        required
                      />
                    </div>
                    <div className="col-12">
                      <textarea
                        name="message"
                        id=""
                        cols="30"
                        rows="5"
                        required
                        placeholder="Write a message *"
                      ></textarea>
                    </div>
                    <span
                      className={errcontact ? "text-success" : "text-danger"}
                    >
                      {messagecontact}
                    </span>
                    <div className="col-12">
                      <button type="submit" className="submitbtn">
                        Send Message
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      </ContactBox> */}
      <BrandBox className="d-block">
        <div className="container-fluid">
          <div className="row gy-5">
            <div className="col-12">
              <div className="brandtitle d-flex flex-column gap-2 text-center">
                <h2>OUR GLOBAL INDUSTRY PARTNERS</h2>
                <h3>Trusted by the World's Most Innovative Companies</h3>
              </div>
            </div>
            <div className="col-12">
              <div className="d-flex flex-column flex-md-row justify-content-center align-items-center gap-2">
                <div className="">
                  <div className="logoimg">
                    <img src="/assets/user/images/pimg1.png" alt="image" />
                  </div>
                </div>
                <div className="">
                  <div className="logoimg">
                    <img src="/assets/user/images/pimg2.png" alt="image" />
                  </div>
                </div>
                <div className="">
                  <div className="logoimg">
                    <img src="/assets/user/images/pimg3.png" alt="image" />
                  </div>
                </div>
              </div>
              {/* <Slider {...settings4}>
                <div className="px-2">
                  <div className="logoimg">
                    <img src="/assets/user/images/pimg1.png" alt="image" />
                  </div>
                </div>
                <div className="px-2">
                  <div className="logoimg">
                    <img src="/assets/user/images/pimg2.png" alt="image" />
                  </div>
                </div>
                <div className="px-2">
                  <div className="logoimg">
                    <img src="/assets/user/images/pimg3.png" alt="image" />
                  </div>
                </div>
              </Slider> */}
            </div>
          </div>
        </div>
      </BrandBox>
      <VideoPopupStyles>
        <VideoPopup
          isOpen={isVideoPopupOpen}
          onClose={() => setIsVideoPopupOpen(false)}
          videoId={videoId}
        />
      </VideoPopupStyles>
      <HomeFooter />
    </>
  );
}
