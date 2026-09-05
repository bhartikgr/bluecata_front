# Capavate Collective — In-Platform Communications Audit
**Audit Date:** May 9, 2026  
**Auditor:** Web automation subagent  
**Credentials used:**
- Company side: Ozan.isinak@gmail.com → NovaPay AI company dashboard
- Investor side: avinayquicktech@gmail.com → Collective investor dashboard (MyScreenName! / Accredited Investor)

**Platform URL:** https://capavate.com/investor/dashboard (Investor/Shareholder side = "Collective")  
**Company dashboard URL:** https://capavate.com/dashboard

---

## Platform Architecture Overview

Capavate has **two separate authenticated portals**:

| Portal | URL | Login page | Who uses it |
|--------|-----|------------|-------------|
| **Company Portal** | `/dashboard` | `/user/login` | Founders / company owners |
| **Investor / Collective Portal** | `/investor/dashboard` | `/investor/login` | Investors, shareholders, accredited members |

The investor portal login page carries specific gating language:
- Title: **"Investors & Shareholders Login"**
- Subtitle: *"You're entering a secure, invitation-only investor portal."*
- Shield icon: *"Capavate's verified network."*
- Bottom banner: **"Verified Investors & Shareholders Portal 🔒 — Access restricted to invited and accredited Capavate members"**

---

## Surface 1: Investor (Collective) Member Dashboard

**URL:** `https://capavate.com/investor/dashboard`

### Layout

Three-column layout:
- **Left column (~23% width):** User identity panel + navigation sidebar
- **Center column (~55% width):** Two side-by-side panels — Messages (left ~35%) and Posts Feed (right ~65%)
- **Right column (~22% width):** Investor Reports and Stats widgets

### Left Sidebar — Identity Panel

| Element | Value (live example) |
|---------|---------------------|
| Avatar | Profile photo (thumbnail, ~48px circle) |
| Screen name | **MyScreenName!** (pseudonym) |
| Role badge | **Accredited Investor** |
| Network badge | **Member of Capavate Angel Network** (green pill, star icon) |
| Status indicator (top-left of header) | **"Investor: NOT on a cap table"** (red tag/badge) |
| Location | Dellach im Drautal, Carinthia, Austria (📍 icon) |
| Investment type | Private equity/growth equity fund (late-stage or special situations) (💼 icon) |

### Left Sidebar — Navigation Items

1. Edit Profile → `/investor/profile`
2. My Portfolio & Watchlist → `/investor/company/watch-list`
3. Incoming Invitations → `/investor/company-invitation-list`
4. Archived Page → `/investor/company-list/archive`
5. My Contacts & Connections → `/investor/contact-connections`
6. Discover Companies → `/investor/discover-companies`
7. Knowledge Hub → `/investor/knowledge-hub`
8. Angel Profile (with 👁 eye icon for visibility toggle)
9. Dashboard HOME button (top bar)
10. Your Role/Permissions button (top bar, company side only)

### Center — Messages from Shareholders Panel (LEFT box)

**Section header:** "Messages from Shareholders" (with chat bubble icon 💬)

**Sub-header row:**
- 🔄 Refresh icon (left)
- **"💬 View All Messages"** button (red/coral, pill shape)

**Filter tabs:**
- **All** (active tab, dark)
- **★ Starred (1)** (star icon + count badge)
- **↓ Newest** (arrow icon)

**Conversation list items — each row contains:**
- Avatar circle (initials, 40px, colored)
- **Name** (screen name or company name, bold)
- **Type badge** — pill badge: `Company` (dark gray) or `Investor` (blue/teal)
- **Date** (e.g., "Apr 19", "Apr 30", relative timestamp)
- **★ Star icon** (right side, orange/filled if starred, hollow if not) — on-hover or persistent
- **Green dot** (online status indicator, small circle below avatar, left side)
- **Preview text** (below name, gray, truncated) — either last message content like "hi" or "Start a conversation" placeholder if no messages yet

**Live conversation list observed:**
| Row | Name | Type | Date | Preview |
|-----|------|------|------|---------|
| 1 | MMM | Company | Apr 19 | 🤩😎🤘🏻🤙 (emoji) — STARRED (🔴 pin icon) |
| 2 | corpw | Company | Apr 30 | ⭐ star (hollow) |
| 3 | vg | Company | Apr 23 | "Start a conversation" ⭐ |
| 4 | Unknown | Investor | Apr 20 | "Start a conversation" ⭐ |
| 5 | A K | Investor | Apr 20 | "Start a conversation" ⭐ |

**Empty state (no conversations):** Speech bubble emoji icon + text "No conversations yet"

### Center — Post Composer (RIGHT area, top)

**Post composer row:**
- Circular avatar of current user (orange "O" initials, ~40px)
- Text input field: placeholder **"Start a post"** (gray text)
- 🔄 Refresh icon (right of input)

### Center — Posts Feed (RIGHT area, below composer)

**Filter tabs row:**
- **All** (active)
- **★ Starred (1)** (with count)
- **↓ Newest**

**Post card structure** (each card is a white rounded card with shadow):

```
┌─────────────────────────────────────────────────────────┐
│ [Avatar 48px] [Name — bold]    [Timestamp]    [•••]     │
│               [Network badge pill]                       │
│               [Role badge pill]                          │
│               [📍 Location]                              │
│                                                          │
│  [Post content text / image]                            │
│                                                          │
│  👍 [count]  💬 [count]  ↗ [share]   [Follow Name]btn  │
│                                    OR [Following] btn    │
└─────────────────────────────────────────────────────────┘
```

**Post card elements in detail:**

| Element | Details |
|---------|---------|
| Avatar | Circle, ~48px, initials or photo |
| Name | Bold, clickable screen name |
| Timestamp | Relative (e.g., "14d ago", "17d ago", "18d ago", "22d ago") |
| Ellipsis (•••) | More options button (3 dots) |
| Network badge | Pill badge, e.g., "🏅 Capavate Angel Network" (orange/gold) |
| Role badge | Pill badge, e.g., "💼 Investor" (green), "👤 Social Network Member" (green) |
| Location | 📍 City, State/Country (gray, small) |
| Post content | Free text, media image (optional) |
| Like button | 👍 with count (e.g., 0, 1, 2) |
| Comment button | 💬 with count (e.g., 0, 3) |
| Share button | ↗ icon |
| Follow CTA | "Follow [ScreenName]" (outline button, gray) OR "Following" (filled/gray when already followed) |

**Live posts observed:**

| User | Badge | Location | Content | Likes | Comments |
|------|-------|----------|---------|-------|----------|
| corpw | Capavate Angel Network | Canillo, Andorra | "Gg" | 0 | 0 |
| corpw | Capavate Angel Network | Canillo, Andorra | "Capavate" | 0 | 0 |
| Ozan Isinak | Investor | Dellach im Drautal, Austria | "s" | 2 | 0 |
| Warrantcheck | Social Network Member | Mir Bachah Köt, Kabul, Afghanistan | [image of avatar/stock photo] | 1 | 3 |

### Right Panel — Investor Reports Widget

| Metric | Value |
|--------|-------|
| Total Portfolio Companies | 3 |
| Total Investor Reports Reviewed | 0 |
| Number Of Participating Rounds | 1 |

### Right Panel — Additional Widgets

- **My Ownership Distribution** (empty state, no chart data)
- **Portfolio Statistics And Status** (empty panel)

---

## Surface 2: Company Detail Page — Overview Tab

**URL pattern:** `https://capavate.com/investor/company-discover-view/{id}`  
**Example:** `/investor/company-discover-view/29` (NovaPay AI)

### Company Header

Full-width dark red/maroon banner:
- Company logo (circle with initials, ~64px)
- Company name (large, bold)
- Industry + Est. date (subtitle)
- Tags row: 📍 Location pill | 👥 Employee count pill | 🏛 Visibility status pill (e.g., "public") | 🌐 Website link
- **"💬 Message"** button (top-right, white outline, message bubble icon)

### Stats Row

Horizontal row of metric boxes:

| Icon | Label | Example value |
|------|-------|--------------|
| 🏭 | Industry | Fintech & Digital Payments |
| 📅 | Incorporated | Mar 14th, 2023 |
| 👥 | Employees | 11-50 |
| 🔢 | Business No. | 765432109 |
| 📈 | Exchange | — |

### Tab Navigation

Horizontal tab bar:
1. **🏢 Overview** (active, dark background)
2. **📋 Contact**
3. **🛡️ Legal**
4. **📊 Business**
5. **🎯 Strategic**
6. **⚖️ Governance**

### Overview Tab — Content (Above Fold)

Two-column card layout:

**Left card: "🏢 Company Info"**
- Company Name
- Industry
- Incorporated (date)
- Employees (range)
- Brand Color (hex + color swatch)

**Right card: "📝 About"**
- Description (long text)
- Problem (long text)
- Solution (long text)

### Overview Tab — Below the Fold / Soft-Circle Communication

**FINDING:** For the test company (NovaPay AI, company-discover-view/29) with 0 investors and no active round, **NO additional communication sections were found below the Company Info / About cards.**

The page text extraction confirms only: Company Info fields + About (Description, Problem, Solution). No "Soft-Circle Channel", "Cap Table Channel", "Investor Discussion", or "Round Q&A" surface is rendered.

**Likely reason:** The soft-circle / cap table communication channel is **conditionally rendered** based on:
1. Whether the investor is on the cap table for that company, OR
2. Whether there is an active soft-circle round, OR  
3. Whether the company has configured a communication channel

The investor account (avinayquicktech) is "Investor: NOT on a cap table" per the dashboard status badge, so gated communication surfaces are not displayed.

**Design implication:** The soft-circle channel is a **conditional section** that appears below the Company Info / About cards in the Overview tab, visible only to eligible users (cap table members, soft-circled investors, or confirmed participants in a round).

---

## Surface 3: Company Detail Header — Message Button

**Location:** Top-right of company header banner

**Button:** "💬 Message" — white outline button, speech bubble icon  
**Action:** Opens a direct message thread with the company/founder

This is the primary CTA for direct investor → company communication from the company discovery view.

---

## Surface 4: My Contacts & Connections — Member Directory

**URL:** `https://capavate.com/investor/contact-connections`

### Layout

Full-width list page with tab navigation at top.

### Tab Navigation

| Tab | Label | Count (observed) |
|-----|-------|-----------------|
| 1 | **All Contacts** | 0 |
| 2 | **Cap Table Connections** | 0 |
| 3 | **Social Media Connections** | 0 |
| 4 | **Capavate Angel Network Connections** | 0 |

### Tab Details (from tab labels)

- **All Contacts:** Aggregate of all connection types
- **Cap Table Connections:** Fellow shareholders on the same cap table(s) — filtered by company membership
- **Social Media Connections:** Connections made via the social feed/posts
- **Capavate Angel Network Connections:** Connections within the Angel Network specifically

### Empty State

Text: "There are no records to display"  
Search field: "Search Here..." (top right)

**Note:** For the audited investor account, all tabs show 0 connections. The structural data (tab names) implies:
- Cap Table Connections are **segmented by relationship type** (not by company)
- Identity shown on connections would be **screen name** (based on profile privacy rules)
- No visible CTA buttons could be observed since empty state

---

## Surface 5: Direct Messaging UX

**Trigger:** Click "View All Messages" button on dashboard, or click a conversation row in the Messages panel

### Layout Pattern

**Split Modal Overlay** (not a full page, not a separate route):
- Modal opens centered over the dashboard
- Left panel (~40% of modal): Conversation list
- Right panel (~60% of modal): Active thread view
- Close button (✕) in top-right corner of modal

### Messages Modal — Left Panel (Conversation List)

**Header:** "Messages"  
**Search field:** "Search conversations..." (with 🔍 icon)

**Filter tabs:**
- **All** (dark/active)
- **★ Starred**
- **↓ Newest**

**Empty state:** Speech bubble icon + "No conversations yet"

### Messages Modal — Right Panel (Thread View)

**When no conversation selected:**
- Large speech bubble emoji illustration
- Text: **"Select a conversation"**
- Sub-text: *"Choose from your existing conversations"*

**When conversation selected (MMM thread example):**

**Thread header:**
- Avatar circle (initials, ~40px, colored)
- **Name:** MMM (company screen name)
- **Type badge:** `company` (blue pill)
- **Online status:** "● Offline" (gray dot + "Offline" text) OR "● Online" (green dot)
- **Location:** 📍 City, Province, Country (gray, small)
- **✕ Close button** (top right)

**Message bubbles:**

| Side | Alignment | Color | Shape |
|------|-----------|-------|-------|
| Sender (current user) | Right-aligned | Red/coral (#E94040 approx) | Rounded rect, ~8px radius |
| Recipient | Left-aligned | White/light gray | Rounded rect with avatar |

**Each message includes:**
- Message text content
- Timestamp: "Apr [DD], [YYYY] [HH:MM] [AM/PM]"
- **Read receipt:** Double checkmark ✓✓ (dark/ticked = read, gray = delivered)

**Date dividers:** Gray centered text, e.g., "April 10, 2026" — separates messages by day

**Recipient messages** also show:
- Small avatar circle (initial) to the left of the bubble

**Input area (bottom of thread):**
- 😊 Emoji button (left)
- Text input: placeholder **"Message [ScreenName]..."** (e.g., "Message MMM...")
- Send button: 📤 Paper plane icon (red/coral, right side of input)

**Live thread example (MMM conversation):**
```
[April 9] "So" (sent) ✓✓ 08:25 AM
[April 10] "Hi" (sent) ✓✓ 02:53 AM  
[April 14] "Hiii" (received, MMM avatar)  11:29 PM
[April 17] "ji" (sent) ✓✓ 09:54 PM
[April 19] "🤩😎🤘🏻🤙" (sent) ✓✓ 06:07 AM
```

---

## Surface 6: Posts Feed and Post Composer

### Composer

**Location:** Center column, top of posts feed area

**Layout:**
- Current user avatar (circle, ~40px, orange initials "O")
- Text input field: placeholder **"Start a post"** (gray text, full width)
- 🔄 Refresh/reload icon (right side)

**Visibility controls:** Not explicitly shown in the composer surface (no "Post to whom?" dropdown was observed — composer is minimal)

### Feed Sort/Filter

Tabs immediately below composer:
- **All** (default active)
- **★ Starred (1)** — with count badge
- **↓ Newest** — sort option

### Post Card Structure (Full Detail)

```
┌──────────────────────────────────────────────────┐
│ ○ [Avatar]  [Bold ScreenName]  [timestamp] [•••] │
│             [🏅 Network Badge pill]              │
│             [💼 Role Badge pill] (optional)      │
│             [📍 Location, Country]               │
│                                                  │
│  [Post body text — multiline]                    │
│  [Optional: image attachment]                    │
│                                                  │
│  👍 [N]   💬 [N]   ↗              [Follow btn]  │
└──────────────────────────────────────────────────┘
```

**Network/Role badge variants observed:**

| Badge text | Color | Context |
|-----------|-------|---------|
| "🏅 Capavate Angel Network" | Gold/orange | Angel network member |
| "🏅 Capavate Angel Network - california" | Gold/orange | Regional variant |
| "💼 Investor" | Green | Investor role |
| "💼 Social Network Member" | Green | Network-only member |

**Follow button states:**
- **"Follow [ScreenName]"** — outline button (gray), user not yet followed
- **"Following"** — filled button (gray), already following

**Company-side post feed note:** The company dashboard shows the same post feed structure, but instead of "Follow" the viewer (as founder) sees the same follow button pattern since posts from investors appear in their "Messages from Shareholders" feed.

---

## Surface 7: Discover Companies List

**URL:** `https://capavate.com/investor/discover-companies`

### Layout

Full-width table/list view.

### Filter Tabs (top)

- **All [27]** (total companies in network)
- **❤️ Interested [0]** (companies marked interested)
- **Not Interested [27]**

### Table Columns

| Column | Content |
|--------|---------|
| Company Name | Text, clickable (no navigation on click — only eye icon navigates) |
| Location | City, Province, Country |
| Date of Incorporation | "Mar 14th, 2023" format |
| Company Overview | 👁 Eye icon (red) — click opens company detail in new tab |
| Actions | "❤️ Mark Interested" button (outline, gray) |

**Rows per page:** 10 (with pagination: 1-10 of 27, navigation arrows)  
**Search:** "Search Here..." field (top right)

---

## Surface 8: Investor Profile — Identity / Privacy Model

**URL:** `https://capavate.com/investor/profile`

### Profile Tabs (3 steps)

1. **Contact Info** — "Used for cap table management"
2. **Investor Profile**
3. **Network Profile**

### Step 1: Contact Info — Key Fields

**"Your Current Role/Work" section** — "Used for cap table management"

| Field | Value |
|-------|-------|
| **Screen Name** | "MyScreenName!" |
| Current Company Name | "Acme Ventures" |
| Company Country | (dropdown) |
| Current Job Title | "Managing Partner" |
| Company Website | "https://acmeventures.com" |

**Screen Name Privacy Note** (verbatim from UI):
> "NOTE: Your screen name will be visible to all shareholders on the same cap table and across all social media sections of Capavate.com. Your portfolio companies, where you are a shareholder, will have access to your real name."

**"Contact Information" section** — "Used for cap table management"

| Field | Value |
|-------|-------|
| First Name | Ozan |
| Last Name | Isinak |
| Contact (Email) | avinayquicktech@gmail.com |
| Country | Austria |
| State | Carinthia |
| City | Dellach im Drautal |
| Contact (Mobile) | +1 212 122 222 |

---

## Surface 9: Company Dashboard (Founder Side)

**URL:** `https://capavate.com/dashboard`  
**Login required:** `/user/login` (separate from investor login)

### Layout

Three-column layout (same structure as investor dashboard):
- **Left column:** Company info panel + navigation
- **Center column:** Two boxes — Messages + Posts
- **Right column:** Investor Reports + Round Statistics

### Left Sidebar — Company Info Panel

| Element | Value |
|---------|-------|
| Company name | NovaPay AI (bold header) |
| Sector | YES |
| Headquarters | 200 University Avenue, Toronto, Ontario - M5H 3C6, Canada |
| Account Owner | Ozan Isinak |

### Left Sidebar — Navigation Items

1. ⭐ Join Capavate Angel Network
2. ✏️ Edit Company Information
3. 📁 Dataroom Management & Executive Summary
4. 📊 Investor Reporting
5. ⚙️ Round Management (expandable)
   - Start/Record/Edit a round
   - Invite Investors to your round
   - Investor Interest
   - Confirm/Validate Investors
6. 👤 Contact (CRM contacts) (expandable)
7. ⚙️ Settings (expandable)

### Center — Messages from Shareholders Panel

**Section header:** "Messages from Shareholders" (with chat bubble icon 💬)

Same layout as investor side:
- "💬 View All Messages" button
- Filter tabs: All | ★ Starred | ↓ Newest
- **Empty state:** "No conversations yet"

### Center — Post Composer

- Company avatar (circle with initials "N")
- "Start a post" input field
- 🔄 Refresh icon

### Center — Post Feed

Same structure as investor feed. Posts appear from investors/shareholders.

### Right Panel — Investor Reports Widget

| Item | Action/Value |
|------|-------------|
| Q1 2026 Investor Update | February 15, 2026 |
| Annual Performance Report | January 10, 2026 |
| Funding Round Summary | N/A |
| "Create Investor Report" button | Red/coral, prominent CTA |

### Right Panel — Current Round Statistics

- "Round not found" (empty state)

### Bottom Left — Analytics Widgets (below navigation)

**Cap Table Analytics:**
| Metric | Value |
|--------|-------|
| Founders | 0 |
| ESOP | 0% |
| Total Investors | 0 |
| Cap Table | View → |

**Round A Analytics:**
- Invited Investors: 0
- Investor engagement: 0

---

## Surface 10: Round Management — Investor Interest Modal

**Trigger:** Click "Investor Interest" in Round Management submenu

**Layout:** Modal dialog (centered overlay)

**Header:** 👤 "Investors Interest"  
**Close button:** ✕ (top right)  
**Empty state:** "No investors found"

**Purpose:** Shows investors who have expressed interest in the company's round (soft-circle list from founder perspective)

---

## Soft-Circle Channel — Observations & Architecture Notes

### What Was Found
- The investor account tested is **"NOT on a cap table"** (shown in the top header badge)
- No soft-circle or cap table communication channel was visible on any Company Detail page Overview tab
- The platform clearly **gates communication surfaces** based on cap table membership and round participation status

### What the Architecture Implies
Based on the observable patterns:
1. The "Cap Table Connections" tab on the Contacts page implies cap-table-specific grouping of co-investors
2. The "Messages from Shareholders" label on the company dashboard implies a **shareholders-only feed**
3. The soft-circle/cap table channel is **conditionally rendered** below Company Info / About on the Overview tab when:
   - The investor IS on the cap table (then "real name" is shown to the company)
   - The investor is soft-circled (expressed interest in an active round)
4. The investor sees screen names; company sees real names if on cap table

---

## DESIGN PATTERN INVENTORY

| Pattern Name | Description |
|-------------|-------------|
| **Split-Center Dashboard** | Three-column layout: sidebar identity / dual-box center (messages + posts) / stats widgets |
| **Two-Box Communication Center** | Dashboard center always shows TWO boxes side-by-side: (1) Messages/DM panel on left, (2) Posts/Feed on right |
| **Messages Panel** | Conversation list with avatar + screen name + type badge + date + star icon + green online dot |
| **Star/Pin Starring** | ★ icon on conversation rows and post cards; tap to star/pin; "Starred" filter tab shows starred items |
| **Post Composer Row** | Single-line input "Start a post" + user avatar + refresh icon — minimal, no visible visibility controls |
| **Post Card** | Avatar + screen name + network badge pill + role badge pill + location + timestamp + content + like/comment/share + follow toggle |
| **Follow Toggle Button** | "Follow [ScreenName]" (outline) → "Following" (filled) on post cards |
| **Network Badge Pill** | Gold/orange pill with network icon: "Capavate Angel Network" shown on qualifying users' posts/messages |
| **Role Badge Pill** | Green pill: "Investor" / "Social Network Member" shown on posts/messages |
| **Direct Message Modal** | Centered modal overlay with split left-list / right-thread layout; NOT a full page |
| **Message Bubble** | Right-aligned coral/red bubbles (sender) + left-aligned white bubbles (recipient) + double-checkmark read receipts |
| **Date Divider** | Centered gray text "Month DD, YYYY" between messages from different days |
| **Screen Name Pseudonym** | Investors display as "screen name" to other shareholders; real name only visible to portfolio companies where they hold shares |
| **Cap Table Status Badge** | "Investor: NOT on a cap table" red badge in top header — persistent status indicator |
| **Cap Table Connections Tab** | Separate tab in Contacts page grouping co-investors by cap table membership |
| **Discover Companies Table** | List view with eye icon (👁) to open company detail; "Mark Interested" action per company |
| **Company Detail Header** | Full-width colored banner (brand color) with logo, name, industry, tags, "💬 Message" CTA button |
| **Tabbed Company Detail** | 6 tabs: Overview / Contact / Legal / Business / Strategic / Governance |
| **Conditional Communication Section** | Below-fold section in Overview tab, only visible to cap table members / soft-circle eligible investors (not observed in empty-state companies) |
| **Investor Interest Modal** | Founder-side modal showing soft-circle list (investors who expressed interest) |
| **Online Status Dot** | Small colored dot below/beside avatar: green = online, gray = offline |
| **Angel Profile Visibility Toggle** | Eye icon (👁) next to "Angel Profile" in sidebar — toggle public visibility of investor's angel profile |

---

## VISIBILITY RULES INVENTORY

| Rule | Details |
|------|---------|
| **Screen name default** | All investors use a "Screen Name" (pseudonym) by default across the platform |
| **Screen name → shareholders** | Screen name is visible to all shareholders on the same cap table AND across all social media sections of Capavate |
| **Real name → portfolio companies** | Real name is only shared with portfolio companies WHERE the investor is a confirmed shareholder |
| **Investor portal is invite-only** | "Invitation-only investor portal" — access restricted to "invited and accredited Capavate members" |
| **Cap table status shown** | "Investor: NOT on a cap table" / presumably "Investor: on cap table" — shown in top header of all pages |
| **Communication surface gating** | Cap table channel / soft-circle channel in company detail is only shown to eligible users (on cap table or soft-circled) |
| **Angel Profile visibility toggle** | Eye icon 👁 next to "Angel Profile" in nav — investor can toggle whether their angel profile is publicly visible |
| **Social Network Member** | A separate role/badge below "Investor" — social-only member with no investment relationship |
| **"public" company tag** | Companies can be tagged "public" (seen on avinay test company) — implies some companies are private/restricted |
| **Starred conversations filter** | Investors can star conversations to surface them in a "Starred" filter — private to the individual user |
| **Company visibility** | Companies appear on "Discover" list visible to all network members; eye icon opens detail |
| **Cap Table Connections segmentation** | Contacts are segmented into: All / Cap Table Connections / Social Media Connections / Angel Network Connections — each has separate visibility context |

---

## ICON / COMPONENT INVENTORY

### Icons

| Icon | Context | Meaning |
|------|---------|---------|
| 💬 Speech bubble | Dashboard section header, "View All Messages" button, company header "Message" button | Messaging/communications |
| ★ Star (hollow) | Conversation row right side | Star/pin a conversation |
| ★ Star (filled orange) | Conversation row — starred | Item is starred |
| 🔴 Pin/tack icon | Starred conversation in dashboard list | Pinned/starred |
| 🔄 Circular arrows | Next to "View All Messages", next to post composer | Refresh feed |
| 📍 Location pin | Profile, post cards, company header | Location indicator |
| 💼 Briefcase | Investor type badge | Investment role |
| 🏅 Medal/badge | Network badge on posts | Network membership |
| 👁 Eye (red) | Company list "Company Overview" column | View company detail |
| 👁 Eye with slash | "Angel Profile" in nav (when hidden) | Profile visibility off |
| 👤 Person silhouette | Profile navigation icon | User identity |
| 📊 Bar chart | Investor Reporting | Analytics |
| 📁 Folder | Dataroom | Documents |
| ⚙️ Gear | Round Management, Settings | Settings/config |
| 👍 Thumbs up | Post card action | Like/react |
| 💬 Bubble (post) | Post card action | Comment |
| ↗ Arrow | Post card action | Share |
| ✓✓ Double checkmark | Message bubble | Read receipt (sent + read) |
| 😊 Emoji | DM input area (left) | Emoji picker |
| 📤 Paper plane | DM input area (right) | Send message |
| ✕ X | Modal close button | Close modal |
| ⭐ Star (filter) | Starred filter tab | Filter starred items |
| ↓ Arrow (filter) | Newest filter tab | Sort order |
| 🔍 Magnifier | Search bar | Search |
| 🏭 Factory | Industry stat | Company industry |
| 📅 Calendar | Incorporated stat | Date |
| 👥 People | Employees stat | Team size |
| 🔢 Hash | Business No. stat | Business ID |
| 📈 Chart | Exchange stat | Stock exchange |
| ← Back arrow | Pagination/navigation | Back/previous |
| → Forward arrow | Pagination/next step | Forward |
| ❤️ Heart | "Mark Interested" button | Express interest |
| 🔒 Lock | Investor portal login banner | Secure/restricted |
| 🛡️ Shield | Login page verification indicator | Security/verified |

### Buttons

| Button | Style | Location |
|--------|-------|---------|
| "💬 View All Messages" | Red/coral pill, speech bubble icon | Dashboard messages panel |
| "Start a post" | Gray placeholder input | Post composer |
| "Follow [Name]" | Gray outline pill | Post cards |
| "Following" | Filled gray pill | Post cards (already following) |
| "💬 Message" | White outline pill | Company detail header |
| "Create Investor Report" | Red/coral fill | Investor Reports widget |
| "View/Edit The Round Dashboard" | Dark outline | Company dashboard |
| "View Interested Investors" | Dark fill | Company dashboard |
| "❤️ Mark Interested" | Gray outline | Discover companies list |
| "Access this account." | Blue fill | User dashboard company card |
| Login | Red fill | Login pages |
| "← Previous" / "Next →" | Outline | Profile edit steps |

### Badges / Pills

| Badge | Color | Meaning |
|-------|-------|---------|
| "Investor: NOT on a cap table" | Red/dark | User's current cap table status |
| "Accredited Investor" | Subtitle under name | User's investor type |
| "Member of Capavate Angel Network" | Green with star | Angel network member |
| "Capavate Angel Network" | Gold/orange on posts | Angel network affiliation on post |
| "Investor" | Blue on messages | Person's role type in DM list |
| "Company" | Dark gray on messages | Sender is a company in DM list |
| "💼 Investor" | Green on post cards | Investor role indicator |
| "💼 Social Network Member" | Green on post cards | Social-only member |
| Type tag (public) | Gray/blue | Company visibility setting |

---

## Screenshots Taken

| File | Content |
|------|---------|
| screenshot_company_dashboard.jpg | Company (founder) dashboard — full view |
| screenshot_messages_modal.jpg | Messages modal overlay (empty state) |
| (in-session) Investor dashboard | Full investor dashboard with messages + posts |
| (in-session) DM thread open | MMM conversation thread in modal |
| (in-session) Company Detail — NovaPay AI | Overview tab above fold |
| (in-session) My Contacts & Connections | 4 tabs visible |
| (in-session) Investor Profile | Screen name + privacy note |
| (in-session) Discover Companies | Company list table |

---

## Notes for Build Subagent

### What is confirmed / live

1. **The platform IS live and accessible** at `https://capavate.com` with separate `/investor/login` and `/user/login` flows
2. **Two communication boxes on the dashboard** — confirmed (Messages panel left + Posts feed right)
3. **Screen name / pseudonym system** — confirmed and documented with exact privacy note text
4. **Messages are a modal overlay** — NOT a separate page route. Split list/thread layout.
5. **Post cards have**: avatar + screen name + two badge types (network + role) + location + like/comment/share + follow toggle
6. **Cap Table Connections** is a dedicated tab in contacts — confirmed segment name
7. **Message thread**: coral/red sender bubbles, white recipient bubbles, double-checkmark read receipts, date dividers, emoji button + paper plane send

### What could NOT be confirmed (due to empty data)

1. **Soft-circle / Cap Table channel** in Company Detail Overview tab — architecture implies it exists but was NOT rendered (investor has 0 cap table memberships, no soft-circle rounds)
2. **Cap Table Connections** with actual members — list was empty (0 connections)
3. **Angel Profile page** — URL 404'd; page exists as a modal or different route
4. **Visibility of real name** when on cap table — only screen name flow was observed
5. **Post commenting UI** — comment count was non-zero on some posts but comment thread UI was not opened

### Key Design Decisions to Replicate

- Screen name is the **PRIMARY identity** shown everywhere in social/communications surfaces
- Real name is only revealed in cap table management context
- The "Messages from Shareholders" feed title implies the feed is **company-specific** (only shareholders of that company can post into a company's feed)
- The platform has three connection types: Cap Table / Social / Angel Network — each is separately counted and managed
- The investor portal login has stronger language about exclusivity than the company login
