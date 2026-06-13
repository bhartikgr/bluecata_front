import React, { useState, useEffect, useRef, useCallback } from "react";
// Import your qa-data.js — make sure it exports QA_CATEGORIES and QA_ARTICLES
// e.g. in qa-data.js: export const QA_CATEGORIES = [...]; export const QA_ARTICLES = [...];
import { QA_CATEGORIES, QA_ARTICLES } from '../components/data/qa-data';
import NewHeader from "../components/NewHeader";
import NewFooter from "../components/NewFooter";
import '../Education.css';
// ─── Constants (same as HTML) ────────────────────────────────────────────────

const CATEGORY_ICONS = {
    SAFE: "📄",
    "Convertible Debt": "💵",
    "Preferred Equity": "⭐",
    "Common Equity": "📊",
    Warrants: "🎫",
    "Instrument Comparisons": "⚖️",
    "Investor Reporting": "📈",
    "Data Room & Due Diligence": "🔍",
    "Dilution & Ownership Modeling": "🧮",
    "Fundraising Rounds & Process": "🚀",
    "Valuation Fundamentals": "💎",
    "Vesting & Equity Compensation": "⏳",
    "Governance & Shareholder Rights": "🏛️",
    "M&A, Exits & Liquidity": "🤝",
    "Angel Investing Fundamentals": "👼",
    "Founder-Investor Relationships": "🤝",
    "Term Sheet Structure and Fundamentals": "📋",
};

const CATEGORY_DESCRIPTIONS = {
    SAFE: "Simple Agreements for Future Equity — mechanics, caps, discounts, and conversion.",
    "Convertible Debt": "Convertible notes, interest, maturity, and how debt converts to equity.",
    "Preferred Equity": "Liquidation preferences, anti-dilution, and preferred share structures.",
    "Common Equity": "Ordinary shares, voting rights, and common stock fundamentals.",
    Warrants: "Warrant mechanics, exercise prices, and strategic use in deal structures.",
    "Instrument Comparisons": "Side-by-side analysis of SAFEs, notes, preferred equity, and more.",
    "Investor Reporting": "What to report, how often, and building trust through transparency.",
    "Data Room & Due Diligence": "Preparing for investor scrutiny — documents, structure, and best practices.",
    "Dilution & Ownership Modeling": "Modeling ownership changes across rounds, options, and conversions.",
    "Fundraising Rounds & Process": "From pre-seed through Series A+ — process, timing, and strategy.",
    "Valuation Fundamentals": "Pre-money, post-money, and how valuations are set and negotiated.",
    "Vesting & Equity Compensation": "Vesting schedules, cliffs, ESOPs, and equity-based compensation.",
    "Governance & Shareholder Rights": "Board seats, voting, protective provisions, and shareholder agreements.",
    "M&A, Exits & Liquidity": "Mergers, acquisitions, secondary sales, and paths to liquidity.",
    "Angel Investing Fundamentals": "How angel investing works — deal flow, evaluation, and portfolio strategy.",
    "Founder-Investor Relationships": "Building trust, managing expectations, and maintaining alignment.",
    "Term Sheet Structure and Fundamentals": "Key terms, clauses, and how to read and negotiate a term sheet.",
};

const GROUP_MAP = {
    instruments: ["SAFE", "Convertible Debt", "Preferred Equity", "Common Equity", "Warrants", "Instrument Comparisons"],
    fundraising: ["Fundraising Rounds & Process", "Valuation Fundamentals", "Term Sheet Structure and Fundamentals", "Dilution & Ownership Modeling"],
    operations: ["Investor Reporting", "Data Room & Due Diligence", "Vesting & Equity Compensation", "Governance & Shareholder Rights"],
    strategy: ["Angel Investing Fundamentals", "Founder-Investor Relationships", "M&A, Exits & Liquidity"],
};

const GROUP_LABELS = {
    instruments: "Equity Instruments",
    fundraising: "Fundraising & Valuation",
    operations: "Operations & Governance",
    strategy: "Relationships & Strategy",
};

const GROUP_ICONS = {
    instruments: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    ),
    fundraising: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
    ),
    operations: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
    ),
    strategy: (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
    ),
};

const AUDIENCE_CATEGORIES = {
    founder: [
        "Fundraising Rounds & Process", "SAFE", "Valuation Fundamentals",
        "Dilution & Ownership Modeling", "Vesting & Equity Compensation",
        "Term Sheet Structure and Fundamentals", "Convertible Debt",
        "Data Room & Due Diligence", "Founder-Investor Relationships", "Investor Reporting",
    ],
    investor: [
        "Angel Investing Fundamentals", "Data Room & Due Diligence",
        "Governance & Shareholder Rights", "M&A, Exits & Liquidity",
        "Investor Reporting", "Instrument Comparisons", "Preferred Equity",
        "SAFE", "Convertible Debt", "Warrants", "Common Equity",
        "Term Sheet Structure and Fundamentals", "Valuation Fundamentals",
    ],
};

const FEATURED_QUERIES = [
    { q: "What is a SAFE and how does it work?", cat: "SAFE" },
    { q: "What is pre-money vs post-money valuation?", cat: "Valuation Fundamentals" },
    { q: "What is a liquidation preference?", cat: "Preferred Equity" },
    { q: "How does equity dilution work?", cat: "Dilution & Ownership Modeling" },
    { q: "What are the key terms in a term sheet?", cat: "Term Sheet Structure and Fundamentals" },
    { q: "What is a vesting schedule and why does it matter?", cat: "Vesting & Equity Compensation" },
    { q: "What should a data room include?", cat: "Data Room & Due Diligence" },
    { q: "What is angel investing?", cat: "Angel Investing Fundamentals" },
];

// ─── Sub-components ──────────────────────────────────────────────────────────

/** Auto-scrolling quickstart strip */
function QuickstartStrip({ onOpenArticle }) {
    const cards = FEATURED_QUERIES.map((fq) => {
        let article = QA_ARTICLES.find(
            (a) => a.category === fq.cat && a.question.toLowerCase().includes(fq.q.toLowerCase().slice(0, 20))
        );
        if (!article) article = QA_ARTICLES.find((a) => a.category === fq.cat);
        if (!article) return null;
        return { ...fq, article };
    }).filter(Boolean);

    return (
        <div className="edu-quickstart">
            <div className="edu-quickstart-header">
                <div className="edu-quickstart-title">Start here</div>
            </div>
            <div className="edu-quickstart-scroll">
                <div className="edu-quickstart-track">
                    {[...cards, ...cards].map((item, i) => (
                        <button
                            key={i}
                            className="edu-quickstart-card"
                            onClick={() => onOpenArticle(item.cat, item.article.question)}
                        >
                            <div className="edu-quickstart-cat">
                                {CATEGORY_ICONS[item.cat] || "📚"} {item.cat}
                            </div>
                            <div className="edu-quickstart-q">{item.article.question}</div>
                            <div className="edu-quickstart-meta">Read answer →</div>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}

/** Single category card in the grid */
function CategoryCard({ cat, onClick }) {
    const icon = CATEGORY_ICONS[cat.name] || "📚";
    const desc = CATEGORY_DESCRIPTIONS[cat.name] || "";
    return (
        <button className="edu-cat-card" onClick={() => onClick(cat.name)}>
            <div className="edu-cat-icon">{icon}</div>
            <div className="edu-cat-info">
                <h3 className="edu-cat-name">{cat.name}</h3>
                <p className="edu-cat-desc">{desc}</p>
            </div>
            <span className="edu-cat-count">{cat.count}</span>
            <svg className="edu-cat-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
        </button>
    );
}

/** Grouped category browser view */
function CategoriesView({ onSelectCategory, onSelectPath, onOpenArticle }) {
    const pathCards = [
        {
            id: "founder",
            icon: "🚀",
            label: "I'm a Founder",
            desc: "Raising capital, structuring rounds, managing your cap table, and keeping investors aligned.",
            topics: ["Fundraising", "SAFEs", "Valuation", "Dilution", "Vesting", "Term Sheets"],
            cta: "Explore founder topics",
        },
        {
            id: "investor",
            icon: "💼",
            label: "I'm an Investor",
            desc: "Evaluating deals, structuring investments, understanding instruments, and managing portfolios.",
            topics: ["Angel Investing", "Due Diligence", "Governance", "Exits & M&A", "Reporting", "Instruments"],
            cta: "Explore investor topics",
        },
    ];

    return (
        <div id="view-categories" className="edu-view edu-view--active">
            <QuickstartStrip onOpenArticle={onOpenArticle} />

            {/* Audience paths */}
            <div className="edu-paths">
                <div className="edu-paths-header">
                    <h2 className="section-title">
                        Choose your <em>path</em>
                    </h2>
                </div>
                <div className="edu-paths-grid">
                    {pathCards.map((card) => (
                        <button
                            key={card.id}
                            className={`edu-path-card edu-path-card--${card.id === "founder" ? "founder" : "investor"}`}
                            onClick={() => onSelectPath(card.id)}
                        >
                            <div className="edu-path-icon">{card.icon}</div>
                            <div className="edu-path-label">{card.label}</div>
                            <p className="edu-path-desc">{card.desc}</p>
                            <div className="edu-path-topics">
                                {card.topics.map((t) => (
                                    <span key={t} className="edu-path-topic">{t}</span>
                                ))}
                            </div>
                            <div className="edu-path-cta">
                                <span>{card.cta}</span>
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M5 12h14M12 5l7 7-7 7" />
                                </svg>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            {/* All categories grouped */}
            <div className="edu-categories-section">
                <div className="edu-categories-header">
                    <h2 className="section-title">
                        All <em>categories</em>
                    </h2>
                </div>

                {Object.keys(GROUP_MAP).map((groupKey) => {
                    const catNames = GROUP_MAP[groupKey];
                    const cats = catNames
                        .map((name) => QA_CATEGORIES.find((c) => c.name === name))
                        .filter(Boolean);

                    return (
                        <div key={groupKey} className="edu-cat-group">
                            <div className="edu-cat-group-label">
                                {GROUP_ICONS[groupKey]}
                                <span>{GROUP_LABELS[groupKey]}</span>
                            </div>
                            <div className="edu-category-grid">
                                {cats.map((cat) => (
                                    <CategoryCard key={cat.name} cat={cat} onClick={onSelectCategory} />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
const SHARE_PLATFORMS = [
    {
        name: 'LinkedIn',
        icon: () => (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
        ),
        url: (t, u) => 'https://www.linkedin.com/sharing/share-offsite/?url=' + u,
    },
    {
        name: 'X',
        icon: () => (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
        ),
        url: (t, u) => 'https://twitter.com/intent/tweet?text=' + t + '&url=' + u,
    },
    {
        name: 'Reddit',
        icon: () => (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 01-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 01.042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 014.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 01.14-.197.35.35 0 01.238-.042l2.906.617a1.214 1.214 0 011.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 00-.231.094.33.33 0 000 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 000-.462.342.342 0 00-.462 0c-.545.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 00-.205-.095z" />
            </svg>
        ),
        url: (t, u) => 'https://www.reddit.com/submit?url=' + u + '&title=' + t,
    },
    {
        name: 'Quora',
        icon: () => (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12.738 18.587c-.926-1.644-2.086-3.32-4.082-3.32-.497 0-1.025.109-1.49.344l-.65-1.3c.893-.737 2.117-1.177 3.553-1.177 2.467 0 3.86 1.259 4.918 2.85.364-1.049.564-2.285.564-3.737 0-5.112-2.237-8.476-6.294-8.476-4.034 0-6.294 3.364-6.294 8.476 0 5.09 2.26 8.398 6.294 8.398 1.318 0 2.45-.348 3.481-1.058zM12.2 24C5.484 24 0 18.627 0 12S5.484 0 12.2 0C18.917 0 24 5.373 24 12s-5.084 12-11.8 12z" />
            </svg>
        ),
        url: (t, u) => 'https://www.quora.com/share?url=' + u,
    },
    {
        name: 'Discord',
        icon: () => (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1569 2.4189z" />
            </svg>
        ),
        url: (t, u) => 'https://discord.com/channels/@me',
    },
    {
        name: 'Slack',
        icon: () => (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 01-2.523 2.521 2.527 2.527 0 01-2.52-2.521V2.522A2.527 2.527 0 0115.165 0a2.528 2.528 0 012.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 012.523 2.522A2.528 2.528 0 0115.165 24a2.527 2.527 0 01-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 01-2.52-2.523 2.526 2.526 0 012.52-2.52h6.313A2.527 2.527 0 0124 15.165a2.528 2.528 0 01-2.522 2.523h-6.313z" />
            </svg>
        ),
        url: (t, u) => 'https://slack.com/',
    },
    {
        name: 'WeChat',
        icon: () => (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M8.691 2.188C3.891 2.188 0 5.476 0 9.53c0 2.212 1.17 4.203 3.002 5.55a.59.59 0 01.213.665l-.39 1.48c-.019.07-.048.141-.048.213 0 .163.13.295.29.295a.326.326 0 00.167-.054l1.903-1.114a.864.864 0 01.717-.098 10.16 10.16 0 002.837.403c.276 0 .543-.027.811-.05-.857-2.578.157-4.972 1.932-6.446 1.703-1.415 3.882-1.98 5.853-1.838-.576-3.583-4.196-6.348-8.596-6.348zM5.785 5.991c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178A1.17 1.17 0 014.623 7.17c0-.651.52-1.18 1.162-1.18zm5.813 0c.642 0 1.162.529 1.162 1.18a1.17 1.17 0 01-1.162 1.178 1.17 1.17 0 01-1.162-1.178c0-.651.52-1.18 1.162-1.18zm3.68 4.025c-3.655 0-6.622 2.467-6.622 5.51 0 3.044 2.967 5.51 6.622 5.51.424 0 .85-.044 1.271-.118a.67.67 0 01.552.076l1.47.861a.251.251 0 00.129.042c.12 0 .224-.103.224-.228 0-.055-.024-.109-.037-.163l-.301-1.144a.457.457 0 01.165-.514C21.11 19.158 22 17.573 22 15.526c0-3.043-2.967-5.51-6.622-5.51h-.1zm-2.382 2.725c.496 0 .898.407.898.911a.904.904 0 01-.898.91.904.904 0 01-.898-.91c0-.504.402-.911.898-.911zm4.766 0c.496 0 .898.407.898.911a.904.904 0 01-.898.91.904.904 0 01-.898-.91c0-.504.402-.911.898-.911z" />
            </svg>
        ),
        url: (t, u) => 'https://web.wechat.com/',
    },
    {
        name: 'Weibo',
        icon: () => (
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M10.098 20.323c-3.977.391-7.414-1.406-7.672-4.02-.259-2.609 2.759-5.047 6.74-5.441 3.979-.394 7.413 1.404 7.671 4.018.259 2.6-2.759 5.049-6.737 5.439l-.002.004zM16.26 8.882c-.21-.664-.876-.99-1.49-.726-.609.266-.93.94-.719 1.596.213.663.88.987 1.488.722.612-.265.932-.939.72-1.592zm1.597-1.147c-.591-1.876-2.462-2.782-4.202-2.024-1.718.748-2.622 2.794-2.022 4.632.593 1.86 2.472 2.772 4.198 2.028 1.74-.748 2.632-2.788 2.026-4.636zM20.2 7.17c-1.098-3.49-4.56-5.168-7.797-3.753-3.197 1.397-4.865 5.19-3.744 8.448a.15.15 0 00.056.075c1.106 3.47 4.554 5.153 7.783 3.76 3.19-1.375 4.858-5.16 3.752-8.435-.012-.032-.032-.064-.05-.095zM4.452 14.2c-.027-.156-.147-.308-.38-.267-.237.04-.358.209-.334.376.024.16.15.31.377.27.237-.039.36-.214.337-.38zm-.69.55c-.09-.15-.273-.218-.413-.154-.136.065-.177.218-.09.37.09.15.271.218.41.158.14-.06.183-.216.093-.374zM20.74 4.157c-1.463-1.857-3.684-2.672-5.577-2.37a.46.46 0 00-.382.528.457.457 0 00.527.382c1.55-.248 3.374.41 4.583 1.943 1.21 1.533 1.46 3.49.825 5.046a.459.459 0 00.258.593.456.456 0 00.594-.258c.783-1.916.48-4.004-.828-5.864z" />
            </svg>
        ),
        url: (t, u) => 'https://service.weibo.com/share/share.php?url=' + u + '&title=' + t,
    },
];

// ─── ShareBar component ───────────────────────────────────────────────────────
// Drop this right below SHARE_PLATFORMS, above ReadingPane

function ShareBar({ articleTitle }) {
    const pageUrl = encodeURIComponent(window.location.href);
    const text = encodeURIComponent(articleTitle + ' — Capavate Education');

    return (
        <div className="edu-share-bar">
            <span className="edu-share-label">Share</span>
            <div className="edu-share-icons">
                {SHARE_PLATFORMS.map((platform) => (
                    <a
                        key={platform.name}
                        className="edu-share-btn"
                        href={platform.url(text, pageUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={`Share on ${platform.name}`}
                        aria-label={`Share on ${platform.name}`}
                    >
                        {platform.icon()}
                    </a>
                ))}
            </div>
        </div>
    );
}
/** Article reading pane */
function ReadingPane({ article, index, total, onPrev, onNext, isMobile, onMobileBack }) {
    if (!article) {
        return (
            <div className="edu-reading-pane" id="edu-reading-pane">
                <div className="edu-reading-empty" style={{ display: "flex" }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.3">
                        <path d="M4 19.5A2.5 2.5 0 016.5 17H20" />
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z" />
                    </svg>
                    <p>Select an article from the list to start reading.</p>
                </div>
            </div>
        );
    }

    const sentences = article.answer.split(/(?<=\.\s)/);
    const perPara = Math.ceil(sentences.length / 3);
    const paragraphs = [];
    for (let i = 0; i < sentences.length; i += perPara) {
        paragraphs.push(sentences.slice(i, i + perPara).join(""));
    }

    return (
        <div
            className={`edu-reading-pane${isMobile ? " edu-reading-pane--visible" : ""}`}
            id="edu-reading-pane"
        >
            <div className="edu-reading-article" style={{ display: "block" }}>
                {isMobile && (
                    <button className="edu-mobile-back" style={{ display: "flex" }} onClick={onMobileBack}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                        Back to list
                    </button>
                )}

                <div className="edu-reading-nav-top">
                    <span className="edu-reading-cat">
                        {CATEGORY_ICONS[article.category] || ""} {article.category}
                    </span>
                    <span className="edu-reading-pos">
                        {index + 1} of {total}
                    </span>
                </div>

                <h2 className="edu-reading-title">{article.question}</h2>

                {/* ── Share bar — same as ArticleModal ── */}
                <ShareBar articleTitle={article.question} />

                <div className="edu-reading-body">
                    {paragraphs.map((p, i) => (
                        <p key={i}>{p}</p>
                    ))}
                </div>

                {article.capavate_for_you && (
                    <div className="edu-reading-callout">
                        <div className="edu-reading-callout-bar" />
                        <div className="edu-reading-callout-inner">
                            <div className="edu-reading-callout-label">Capavate for you</div>
                            <p>{article.capavate_for_you}</p>
                        </div>
                    </div>
                )}

                {article.tags && article.tags.length > 0 && (
                    <div className="edu-reading-tags">
                        {article.tags.map((tag) => (
                            <span key={tag} className="edu-tag">{tag}</span>
                        ))}
                    </div>
                )}

                <div className="edu-reading-nav-bottom">
                    <button
                        className="edu-nav-btn"
                        onClick={onPrev}
                        style={{ visibility: index > 0 ? "visible" : "hidden" }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                        Previous
                    </button>
                    <button
                        className="edu-nav-btn"
                        onClick={onNext}
                        style={{ visibility: index < total - 1 ? "visible" : "hidden" }}
                    >
                        Next
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    );
}

/** Master-detail view: article list + reading pane */
function DetailView({ topbarTitle, topbarCount, articles, onBack, onFilterChange, filterValue }) {
    const [activeIndex, setActiveIndex] = useState(-1);
    const [showMobileReading, setShowMobileReading] = useState(false);
    const listRef = useRef(null);

    // Reset active article when articles list changes
    useEffect(() => {
        setActiveIndex(-1);
        setShowMobileReading(false);
    }, [articles]);

    const openArticle = useCallback((idx) => {
        setActiveIndex(idx);
        if (window.innerWidth <= 768) setShowMobileReading(true);
        // Scroll active item into view
        setTimeout(() => {
            const el = listRef.current?.querySelector(".edu-list-item--active");
            if (el) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
        }, 50);
    }, []);

    // Keyboard nav
    useEffect(() => {
        const handleKey = (e) => {
            if (activeIndex < 0) return;
            if (document.activeElement?.tagName === "INPUT") return;
            if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault();
                if (activeIndex > 0) openArticle(activeIndex - 1);
            }
            if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault();
                if (activeIndex < articles.length - 1) openArticle(activeIndex + 1);
            }
        };
        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [activeIndex, articles.length, openArticle]);

    const activeArticle = activeIndex >= 0 ? articles[activeIndex] : null;
    const isMobile = typeof window !== "undefined" && window.innerWidth <= 768;

    return (
        <div id="view-detail" className="edu-view edu-view--active">
            {/* Topbar */}
            <div className="edu-topbar">
                <button className="edu-back-btn" onClick={onBack}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    <span>All Categories</span>
                </button>
                <span className="edu-topbar-title">{topbarTitle}</span>
                <span className="edu-topbar-count">{topbarCount}</span>
            </div>

            {/* Split layout */}
            <div className="edu-split">
                {/* Left: article list */}
                <div
                    className={`edu-list-pane${showMobileReading ? " edu-list-pane--hidden" : ""}`}
                    id="edu-list-pane"
                >
                    <div className="edu-list-search">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="11" cy="11" r="8" />
                            <path d="M21 21l-4.35-4.35" />
                        </svg>
                        <input
                            type="text"
                            className="edu-filter-input"
                            placeholder="Filter articles..."
                            value={filterValue}
                            onChange={(e) => onFilterChange(e.target.value)}
                        />
                    </div>
                    <div className="edu-list-scroll" ref={listRef}>
                        {articles.length === 0 ? (
                            <div className="edu-no-results">
                                <p>No articles match your filter.</p>
                                <button className="edu-clear-filter-btn" onClick={() => onFilterChange("")}>
                                    Clear filter
                                </button>
                            </div>
                        ) : (
                            <div className="edu-articles-list">
                                {articles.map((a, i) => (
                                    <button
                                        key={i}
                                        className={`edu-list-item${i === activeIndex ? " edu-list-item--active" : ""}`}
                                        onClick={() => openArticle(i)}
                                    >
                                        <span className="edu-list-num">{i + 1}</span>
                                        <span className="edu-list-question">{a.question}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: reading pane */}
                <ReadingPane
                    article={activeArticle}
                    index={activeIndex}
                    total={articles.length}
                    onPrev={() => activeIndex > 0 && openArticle(activeIndex - 1)}
                    onNext={() => activeIndex < articles.length - 1 && openArticle(activeIndex + 1)}
                    isMobile={showMobileReading}
                    onMobileBack={() => setShowMobileReading(false)}
                />
            </div>
        </div>
    );
}

// ─── Main Education Page ──────────────────────────────────────────────────────
// ─── AskSection ───────────────────────────────────────────────────────────────

function AskSection() {
    const [formData, setFormData] = useState({ name: "", email: "", role: "founder", question: "" });
    const [submitted, setSubmitted] = useState(false);
    const [errors, setErrors] = useState({});

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        // Clear error for this field as user types
        if (errors[name]) {
            setErrors((prev) => ({ ...prev, [name]: "" }));
        }
    };

    const validate = () => {
        const newErrors = {};
        if (!formData.name.trim()) newErrors.name = "Name is required.";
        if (!formData.email.trim()) {
            newErrors.email = "Email is required.";
        } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
            newErrors.email = "Enter a valid email address.";
        }
        if (!formData.question.trim()) newErrors.question = "Please enter your question.";
        return newErrors;
    };

    const handleSubmit = () => {
        const validationErrors = validate();
        if (Object.keys(validationErrors).length > 0) {
            setErrors(validationErrors);
            return;
        }
        setErrors({});
        setSubmitted(true);
        setFormData({ name: "", email: "", role: "founder", question: "" });
        setTimeout(() => {
            setSubmitted(false)
        }, 3500);
    };

    return (
        <section className="edu-ask-section" id="ask">
            <div className="container">
                <div className="edu-ask-inner">

                    {/* Left: text */}
                    <div className="edu-ask-text">
                        <div className="section-label" style={{ color: "var(--capavate-gold)" }}>
                            Can't find an answer?
                        </div>
                        <h2 className="section-title">
                            Ask our <em>team directly.</em>
                        </h2>
                        <p className="section-body">
                            Submit your question and our team will respond with a clear, investor-grade answer.
                            The best questions may be added to the knowledge base for everyone.
                        </p>
                    </div>

                    {/* Right: form */}
                    <div className="edu-ask-form">

                        <div className="edu-form-group">
                            <label htmlFor="ask-name" className="edu-form-label">Your name</label>
                            <input
                                type="text"
                                id="ask-name"
                                name="name"
                                className={`edu-form-input${errors.name ? " edu-form-input--error" : ""}`}
                                placeholder="Jane Smith"
                                value={formData.name}
                                onChange={handleChange}
                            />
                            {errors.name && <span className="edu-form-error">{errors.name}</span>}
                        </div>

                        <div className="edu-form-group">
                            <label htmlFor="ask-email" className="edu-form-label">Email</label>
                            <input
                                type="email"
                                id="ask-email"
                                name="email"
                                className={`edu-form-input${errors.email ? " edu-form-input--error" : ""}`}
                                placeholder="jane@example.com"
                                value={formData.email}
                                onChange={handleChange}
                            />
                            {errors.email && <span className="edu-form-error">{errors.email}</span>}
                        </div>

                        <div className="edu-form-group">
                            <label htmlFor="ask-role" className="edu-form-label">I am a...</label>
                            <select
                                id="ask-role"
                                name="role"
                                className="edu-form-select "
                                value={formData.role}
                                onChange={handleChange}
                            >
                                <option value="founder">Founder</option>
                                <option value="investor">Investor</option>
                                <option value="advisor">Advisor</option>
                                <option value="other">Other</option>
                            </select>
                        </div>

                        <div className="edu-form-group edu-form-group--full">
                            <label htmlFor="ask-question" className="edu-form-label">Your question</label>
                            <textarea
                                id="ask-question"
                                name="question"
                                className={`edu-form-input edu-form-textarea${errors.question ? " edu-form-input--error" : ""}`}
                                placeholder="What would you like to know about fundraising, equity, or cap tables?"
                                rows={4}
                                value={formData.question}
                                onChange={handleChange}
                            />
                            {errors.question && <span className="edu-form-error">{errors.question}</span>}
                        </div>

                        {/* Submit button — hidden after successful submission */}
                        {!submitted && (
                            <button
                                type="button"
                                className="btn btn-primary btn-large edu-ask-submit"
                                onClick={handleSubmit}
                            >
                                Submit Question →
                            </button>
                        )}

                        {/* Success message */}
                        {submitted && (
                            <div className="edu-ask-success">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M20 6L9 17l-5-5" />
                                </svg>
                                Question delivered — our team will review it and get back to you shortly.
                            </div>
                        )}

                    </div>
                </div>
            </div>
        </section>
    );
}

export default function EducationData({ section = true }) {
    // "categories" | "detail"
    const [view, setView] = useState("categories");
    const [topbarTitle, setTopbarTitle] = useState("");
    const [topbarCount, setTopbarCount] = useState("");
    const [currentArticles, setCurrentArticles] = useState([]);
    const [filterValue, setFilterValue] = useState("");
    const [allVisibleArticles, setAllVisibleArticles] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchClearVisible, setSearchClearVisible] = useState(false);

    const mainRef = useRef(null);

    // Handle hash-based deep linking on mount
    useEffect(() => {
        if (window.location.hash) {
            const hash = decodeURIComponent(window.location.hash.slice(1));
            const match = QA_CATEGORIES.find(
                (c) => c.name.toLowerCase().replace(/\s+/g, "-") === hash.toLowerCase()
            );
            if (match) openCategory(match.name);
        }
    }, []);

    const scrollToMain = () => {
        if (mainRef.current) {
            window.scrollTo({ top: mainRef.current.offsetTop - 80, behavior: "smooth" });
        }
    };

    // ── Navigation helpers ──────────────────────────────────────────────────────

    const openCategory = (categoryName) => {
        const articles = QA_ARTICLES.filter((a) => a.category === categoryName);
        setAllVisibleArticles(articles);
        setCurrentArticles(articles);
        setTopbarTitle(categoryName);
        setTopbarCount(`${articles.length} articles`);
        setFilterValue("");
        setView("detail");
        scrollToMain();
    };

    const openAudiencePath = (audience) => {
        const relevantCats = AUDIENCE_CATEGORIES[audience] || [];
        const articles = QA_ARTICLES.filter((a) => relevantCats.includes(a.category));
        const label = audience === "founder" ? "Founder Path" : "Investor Path";
        setAllVisibleArticles(articles);
        setCurrentArticles(articles);
        setTopbarTitle(label);
        setTopbarCount(`${articles.length} articles`);
        setFilterValue("");
        setView("detail");
        scrollToMain();
    };

    // Open a category AND jump to a specific article (used by quickstart)
    const openCategoryAndArticle = (categoryName, questionText) => {
        openCategory(categoryName);
        // The detail view handles article opening via prop — pass via state
        // We store the target question so DetailView can auto-open it
        // Simpler: just open the category for now (DetailView resets on article list change)
    };

    const handleSearch = (query) => {
        if (!query.trim()) {
            setView("categories");
            return;
        }
        const q = query.toLowerCase();
        const results = QA_ARTICLES.filter(
            (a) =>
                a.question.toLowerCase().includes(q) ||
                a.answer.toLowerCase().includes(q) ||
                (a.tags && a.tags.some((t) => t.toLowerCase().includes(q)))
        );
        setAllVisibleArticles(results);
        setCurrentArticles(results);
        setTopbarTitle(`Search: "${query}"`);
        setTopbarCount(`${results.length} result${results.length !== 1 ? "s" : ""}`);
        setFilterValue("");
        setView("detail");
        scrollToMain();
    };

    const handleFilterChange = (val) => {
        setFilterValue(val);
        if (!val.trim()) {
            setCurrentArticles(allVisibleArticles);
            return;
        }
        const q = val.toLowerCase();
        setCurrentArticles(allVisibleArticles.filter((a) => a.question.toLowerCase().includes(q)));
    };

    const goBack = () => {
        setView("categories");
        setSearchQuery("");
        setSearchClearVisible(false);
        scrollToMain();
    };

    // ── Search input handlers ───────────────────────────────────────────────────

    const searchDebounce = useRef(null);
    const onSearchChange = (e) => {
        const val = e.target.value;
        setSearchQuery(val);
        setSearchClearVisible(val.length > 0);
        clearTimeout(searchDebounce.current);
        searchDebounce.current = setTimeout(() => handleSearch(val), 300);
    };

    const onSearchClear = () => {
        setSearchQuery("");
        setSearchClearVisible(false);
        setView("categories");
    };

    // ── Render ──────────────────────────────────────────────────────────────────

    return (
        <>
            {/* Hero */}
            <section className="edu-hero">
                <div className="container">
                    <div className="container edu-hero-inner">
                        <div className="edu-hero-left">
                            <h1 className="edu-hero-title">Knowledge Base</h1>
                            <div className="edu-hero-meta">660+ articles · Free &amp; open access</div>
                        </div>
                        <div className="edu-hero-right">
                            <div className="edu-search-bar">
                                <svg className="edu-search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="11" cy="11" r="8" />
                                    <path d="M21 21l-4.35-4.35" />
                                </svg>
                                <input
                                    type="text"
                                    className="edu-search-input"
                                    placeholder="Search articles — try 'valuation cap' or 'dilution'"
                                    autoComplete="off"
                                    value={searchQuery}
                                    onChange={onSearchChange}
                                />
                                {searchClearVisible && (
                                    <button className="edu-search-clear" aria-label="Clear search" onClick={onSearchClear}>
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                            <path d="M18 6L6 18M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Main content area */}
            <section className="edu-main" ref={mainRef}>
                <div className="container">
                    {view === "categories" ? (
                        <CategoriesView
                            onSelectCategory={openCategory}
                            onSelectPath={openAudiencePath}
                            onOpenArticle={openCategoryAndArticle}
                        />
                    ) : (
                        <DetailView
                            topbarTitle={topbarTitle}
                            topbarCount={topbarCount}
                            articles={currentArticles}
                            filterValue={filterValue}
                            onFilterChange={handleFilterChange}
                            onBack={goBack}
                        />
                    )}
                </div>
            </section>

            {/* ── Ask a question ── */}
            {section && (
                <AskSection />
            )}

        </>
    );
}