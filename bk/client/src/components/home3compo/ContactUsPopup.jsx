import React, { useState } from "react";
import { useFormik } from 'formik';
import * as Yup from 'yup';
import { CircleX, Mail, Phone, User, MessageSquare } from 'lucide-react';
import axios from "axios";
import { API_BASE_URL } from "../../../config/config";

const validationSchema = Yup.object({
    name: Yup.string()
        .required('Name is required')
        .min(2, 'Name must be at least 2 characters'),
    email: Yup.string()
        .email('Invalid email address')
        .required('Email is required'),
    phone: Yup.string()
        .required('Phone number is required')
        .matches(/^[0-9+\-\s()]+$/, 'Invalid phone number'),
    message: Yup.string()
        .required('Message is required')
        .min(10, 'Message must be at least 10 characters')
        .max(500, 'Message must not exceed 500 characters')
});

export default function ContactUsPopup({ PopupShow, setPopupShow }) {
    const apiUrl = API_BASE_URL + "api/frontpage/home/";
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [messageAll, setMessageAll] = useState("");
    const [error, setError] = useState(false);

    const formik = useFormik({
        initialValues: {
            name: '',
            email: '',
            phone: '',
            message: ''
        },
        validationSchema,
        onSubmit: async (values) => {
            setIsSubmitting(true);
            try {
                await saveContactForm(values);
            } catch (error) {
                console.error("Error submitting form:", error);
                setError(true);
                setMessageAll("Failed to send message. Please try again.");
                setTimeout(() => {
                    setError(false);
                    setMessageAll("");
                }, 3500);
            } finally {
                setIsSubmitting(false);
            }
        }
    });

    const saveContactForm = async (values) => {
        const formData = {
            name: values.name,
            email: values.email,
            phone: values.phone,
            message: values.message,

        };

        try {
            const response = await axios.post(
                apiUrl + "saveContact",
                formData,
                {
                    headers: {
                        Accept: "application/json",
                        "Content-Type": "application/json",
                    },
                }
            );

            if (response.data.status === "1" || response.data.success) {
                setError(false);
                setMessageAll("Thank you! Your message has been sent successfully.");
                formik.resetForm();
                setTimeout(() => {
                    setPopupShow(false);
                    setMessageAll("");
                }, 2500);
            } else {
                setError(true);
                setMessageAll(response.data.message || "Error sending message");
                setTimeout(() => {
                    setError(false);
                    setMessageAll("");
                }, 3500);
            }
        } catch (err) {
            console.error("Error saving contact form:", err);
            throw err;
        }
    };

    const handleClose = () => {
        setPopupShow(false);
        formik.resetForm();
    };

    if (!PopupShow) return null;

    return (
        <>
            <div className={`modal fade show form-pop`} style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }}>
                <div className='modal-dialog modal-dialog-centered modal-md'>

                    {/* Toast Message */}
                    {messageAll && (
                        <div
                            className={`shadow-lg ${error ? "error_pop" : "success_pop"
                                }`}
                        >
                            <div className="d-flex align-items-center gap-2">
                                <span className="d-block">{messageAll}</span>
                            </div>

                            <button
                                type="button"
                                className="close_btnCros"
                                onClick={() => setMessageAll("")}
                            >
                                ×
                            </button>
                        </div>
                    )}


                    <div className='modal-content rounded-4 shadow-lg border-0'>
                        <div className='p-4'>
                            <div className='d-flex align-items-start gap-3 mb-4'>
                                {/* Icon Section */}
                                <div
                                    className='rounded-3 d-flex align-items-center justify-content-center flex-shrink-0'
                                    style={{
                                        width: '50px',
                                        height: '50px',
                                        background: '#CC0201',
                                        boxShadow: '0 4px 10px rgba(204, 2, 1, 0.3)'
                                    }}
                                >
                                    <Mail size={24} color="white" />
                                </div>
                                <div className='flex-grow-1'>
                                    <div className='d-flex form-pop-head justify-content-between gap-2 align-items-start'>
                                        <div className='d-flex flex-column gap-1'>
                                            <h4 style={{
                                                margin: 0,
                                                fontSize: '1.5rem',
                                                fontWeight: '600',
                                                color: '#CC0201'
                                            }}>
                                                Contact Us
                                            </h4>
                                            <p style={{ margin: 0, color: '#6c757d', fontSize: '0.9rem' }}>
                                                We'd love to hear from you! Send us a message and we'll respond as soon as possible.
                                            </p>
                                        </div>
                                        <button
                                            type='button'
                                            className='close_btn_pop'
                                            onClick={handleClose}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                cursor: 'pointer',
                                                padding: 0
                                            }}
                                        >
                                            <CircleX size={24} color="#6c757d" />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <form
                                className='d-flex flex-column gap-3'
                                onSubmit={formik.handleSubmit}
                            >
                                {/* Name Field */}
                                <div className="position-relative">
                                    <div className="d-flex align-items-center gap-2 mb-1">
                                        <User size={16} color="#CC0201" />
                                        <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#495057' }}>
                                            Full Name <span style={{ color: '#CC0201' }}>*</span>
                                        </label>
                                    </div>
                                    <input
                                        type="text"
                                        name="name"
                                        placeholder="John Doe"
                                        onChange={formik.handleChange}
                                        onBlur={formik.handleBlur}
                                        value={formik.values.name}
                                        style={{
                                            width: '100%',
                                            padding: '10px 12px',
                                            border: `1px solid ${formik.touched.name && formik.errors.name ? '#CC0201' : '#dee2e6'}`,
                                            borderRadius: '8px',
                                            fontSize: '14px',
                                            fontFamily: 'inherit',
                                            transition: 'all 0.2s ease',
                                            outline: 'none'
                                        }}
                                        className={formik.touched.name && formik.errors.name ? 'is-invalid' : ''}
                                    />
                                    {formik.touched.name && formik.errors.name && (
                                        <div style={{ color: '#CC0201', fontSize: '0.75rem', marginTop: '4px' }}>
                                            {formik.errors.name}
                                        </div>
                                    )}
                                </div>

                                {/* Email Field */}
                                <div className="position-relative">
                                    <div className="d-flex align-items-center gap-2 mb-1">
                                        <Mail size={16} color="#CC0201" />
                                        <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#495057' }}>
                                            Email Address <span style={{ color: '#CC0201' }}>*</span>
                                        </label>
                                    </div>
                                    <input
                                        type="email"
                                        name="email"
                                        placeholder="john@company.com"
                                        onChange={formik.handleChange}
                                        onBlur={formik.handleBlur}
                                        value={formik.values.email}
                                        style={{
                                            width: '100%',
                                            padding: '10px 12px',
                                            border: `1px solid ${formik.touched.email && formik.errors.email ? '#CC0201' : '#dee2e6'}`,
                                            borderRadius: '8px',
                                            fontSize: '14px',
                                            fontFamily: 'inherit',
                                            transition: 'all 0.2s ease',
                                            outline: 'none'
                                        }}
                                        className={formik.touched.email && formik.errors.email ? 'is-invalid' : ''}
                                    />
                                    {formik.touched.email && formik.errors.email && (
                                        <div style={{ color: '#CC0201', fontSize: '0.75rem', marginTop: '4px' }}>
                                            {formik.errors.email}
                                        </div>
                                    )}
                                </div>

                                {/* Phone Field */}
                                <div className="position-relative">
                                    <div className="d-flex align-items-center gap-2 mb-1">
                                        <Phone size={16} color="#CC0201" />
                                        <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#495057' }}>
                                            Phone Number <span style={{ color: '#CC0201' }}>*</span>
                                        </label>
                                    </div>
                                    <input
                                        type="tel"
                                        name="phone"
                                        placeholder="+1 (555) 123-4567"
                                        onChange={formik.handleChange}
                                        onBlur={formik.handleBlur}
                                        value={formik.values.phone}
                                        style={{
                                            width: '100%',
                                            padding: '10px 12px',
                                            border: `1px solid ${formik.touched.phone && formik.errors.phone ? '#CC0201' : '#dee2e6'}`,
                                            borderRadius: '8px',
                                            fontSize: '14px',
                                            fontFamily: 'inherit',
                                            transition: 'all 0.2s ease',
                                            outline: 'none'
                                        }}
                                        className={formik.touched.phone && formik.errors.phone ? 'is-invalid' : ''}
                                    />
                                    {formik.touched.phone && formik.errors.phone && (
                                        <div style={{ color: '#CC0201', fontSize: '0.75rem', marginTop: '4px' }}>
                                            {formik.errors.phone}
                                        </div>
                                    )}
                                </div>

                                {/* Message Field */}
                                <div className="position-relative">
                                    <div className="d-flex align-items-center gap-2 mb-1">
                                        <MessageSquare size={16} color="#CC0201" />
                                        <label style={{ fontSize: '0.85rem', fontWeight: '500', color: '#495057' }}>
                                            Message <span style={{ color: '#CC0201' }}>*</span>
                                        </label>
                                    </div>
                                    <textarea
                                        name='message'
                                        placeholder='How can we help you?'
                                        onChange={formik.handleChange}
                                        onBlur={formik.handleBlur}
                                        value={formik.values.message}
                                        style={{
                                            width: '100%',
                                            padding: '10px 12px',
                                            border: `1px solid ${formik.touched.message && formik.errors.message ? '#CC0201' : '#dee2e6'}`,
                                            borderRadius: '8px',
                                            fontSize: '14px',
                                            fontFamily: 'inherit',
                                            resize: 'vertical',
                                            minHeight: '100px',
                                            transition: 'all 0.2s ease',
                                            outline: 'none'
                                        }}
                                        className={formik.touched.message && formik.errors.message ? 'is-invalid' : ''}
                                    />
                                    {formik.touched.message && formik.errors.message && (
                                        <div style={{ color: '#CC0201', fontSize: '0.75rem', marginTop: '4px' }}>
                                            {formik.errors.message}
                                        </div>
                                    )}
                                </div>

                                {/* Form Buttons */}
                                <div className='d-flex gap-3 mt-3'>
                                    <button
                                        type='button'
                                        className='button_deisgn bg_light text-black flex-grow-1'
                                        onClick={handleClose}
                                        disabled={isSubmitting}
                                        style={{
                                            padding: '12px 20px',
                                            border: '1px solid #dee2e6',
                                            borderRadius: '8px',
                                            backgroundColor: '#f8f9fa',
                                            color: '#495057',
                                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                            fontWeight: '500',
                                            transition: 'all 0.2s ease'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.target.style.backgroundColor = '#e9ecef';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.backgroundColor = '#f8f9fa';
                                        }}
                                    >
                                        Cancel
                                    </button>

                                    <button
                                        type='submit'
                                        className='button_deisgn flex-grow-1 text-white'
                                        disabled={isSubmitting || formik.isSubmitting}
                                        style={{
                                            padding: '12px 20px',
                                            border: 'none',
                                            borderRadius: '8px',
                                            background: '#CC0201',
                                            color: '#fff',
                                            cursor: isSubmitting ? 'not-allowed' : 'pointer',
                                            fontWeight: '500',
                                            transition: 'all 0.2s ease',
                                            boxShadow: '0 2px 4px rgba(204, 2, 1, 0.3)'
                                        }}
                                        onMouseEnter={(e) => {
                                            e.target.style.opacity = '0.9';
                                            e.target.style.transform = 'translateY(-1px)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.target.style.opacity = '1';
                                            e.target.style.transform = 'translateY(0)';
                                        }}
                                    >
                                        {isSubmitting ? 'Sending...' : 'Send Message'}
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                </div>
            </div>

            {/* Backdrop */}
            <div
                className='modal-backdrop fade show'
                onClick={handleClose}
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    zIndex: 1040
                }}
            />
        </>
    );
}