import React from "react";
import { GrLineChart } from "react-icons/gr";
import { IoIosStar } from "react-icons/io";
import { BsArrowRight } from "react-icons/bs";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";

export default function ServicesSection() {
  const services = [
    {
      title: "Startup Growth Advisory",
      description:
        "Helping startups scale with mentorship, trust, and investment guidance.",
      img: "/assets/images/service1.webp",
    },
    {
      title: "Investor Networking",
      description:
        "Connect with top investors to secure funding and strategic support.",
      img: "/assets/images/service2.webp",
    },
    {
      title: "Market Research",
      description:
        "In-depth analysis to guide investment decisions and business growth.",
      img: "/assets/images/service3.webp",
    },
    {
      title: "Financial Planning",
      description:
        "Strategic financial advice for companies looking to optimize capital.",
      img: "/assets/images/service4.webp",
    },
    {
      title: "Portfolio Management",
      description:
        "Professional management of investments to maximize returns.",
      img: "/assets/images/service5.webp",
    },
    {
      title: "Business Strategy Consulting",
      description:
        "Expert guidance to align company strategy with investor expectations.",
      img: "/assets/images/service6.webp",
    },
  ];

  const settings = {
    dots: true,
    infinite: true,
    speed: 500,
    slidesToShow: 3, // Desktop
    slidesToScroll: 1,
    responsive: [
      { breakpoint: 992, settings: { slidesToShow: 2 } }, // Tablet
      { breakpoint: 576, settings: { slidesToShow: 1 } }, // Mobile
    ],
  };

  return (
    <>
      <section className="servicesblock d-block gapy">
        <div className="container-lg">
          <div className="row gy-4 align-items-center justify-content-center">
            <div className="col-md-8">
              <div className="d-flex justify-content-center mb-5">
                <div className="d-flex flex-column gap-3 titlecontent text-center">
                  <div className="d-flex gap-2 align-items-center text-center align-items-center smalltext mx-auto">
                    <GrLineChart /> <h6>OUR SERVICES</h6>
                  </div>
                  <h2>Connecting Startups with the Right Investors</h2>
                </div>
              </div>
            </div>
          </div>
          <div className="row">
            <div className="col-12">
              <Slider {...settings}>
                {services.map((service, index) => (
                  <div key={index} className="px-3 my-3">
                    <div className="servicebox d-flex flex-column gap-2">
                      <div className="imgblock d-block ofit mb-2">
                        <img src={service.img} alt="image" />
                      </div>
                      <h4>{service.title}</h4>
                      <p>{service.description}</p>
                      <a
                        href="#"
                        className="d-flex gap-2 align-items-center readlink"
                      >
                        <span>Read More</span> <BsArrowRight />
                      </a>
                    </div>
                  </div>
                ))}
              </Slider>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
