# AtomQuest Goals Portal 🚀

**AtomQuest** is a comprehensive, enterprise-grade Performance Management SaaS application designed to streamline goal setting, quarterly check-ins, automated compliance escalations, and HR governance across organizations.

![Dark Mode Dashboard](https://img.shields.io/badge/UI-Dark%20Mode%20Ready-black) ![Node.js](https://img.shields.io/badge/Node.js-v20+-green) ![Express.js](https://img.shields.io/badge/Express.js-Backend-blue) ![SQLite](https://img.shields.io/badge/SQLite-Database-lightblue) ![AI Powered](https://img.shields.io/badge/AI-Gemini%201.5%20Flash-orange)

---

## 🌐 Live Demo
The application is live and available for review at:
**[https://atomquest-portal-6bkr.onrender.com](https://atomquest-portal-6bkr.onrender.com)**

---

## 🌟 Key Features

### 🎯 Automated SMART Goal Scoring Engine
- **Intelligent Evaluation:** Employs Google Gemini AI to evaluate employee goals instantly against strict SMART criteria (Specific, Measurable, Achievable, Relevant, Time-bound).
- **Interactive Scoring Panel:** Provides employees with immediate visual feedback (green checkmarks/red cross-marks), an overall 1-10 score badge, and actionable one-sentence improvement tips.
- **Robust Local Fallback:** Features a zero-dependency regex keyword-matching expert system that seamlessly intercepts missing API keys or network timeouts to provide reliable local scoring without breaking the user flow.

### 🤖 Built-in Local Expert AI Fallback System for Suggestions
- **Zero-Dependency Smart Suggestions:** Generates professional, measurable SMART goals tailored specifically to AtomQuest Thrust Areas (Strategic Growth, Operational Excellence, Customer Success, Innovation & Tech).
- **Seamless GenAI Integration:** Leverages Gemini 1.5 Flash for contextual rationale while automatically falling back to pre-curated expert suggestions if API quota limits or billing prompts occur.

### 🚨 Automated Escalation & Notification Hub
- **Daily Cron Scheduler:** Background jobs (`node-cron`) automatically evaluate goal submission delays, manager approval bottlenecks, and quarterly check-in compliance.
- **Multi-channel Alerts:** Generates simulated Microsoft Teams webhooks and direct HR/Skip-Level escalation emails based on configurable threshold days.
- **Admin Escalation Dashboard:** Centralized monitoring of overdue submissions with one-click override capabilities and complete escalation audit logs.

### 🏢 Enterprise SSO Integration (Microsoft Entra ID)
- **Seamless Authentication Gateway:** Enterprise OAuth login flow with Azure AD / Microsoft Entra ID.
- **Automated Directory Sync:** Dynamically maps organizational directory groups and manager hierarchy attributes to strict system tiers (HR Admin, Manager, Employee).
- **Dual-Authentication Support:** Flawlessly supports both legacy plain text passwords (from initial SQLite demo seeding) and secure `bcrypt` password hashes.

### 🔐 Strict Role-Based Access Control (RBAC)
Dedicated portals and API validation for three user tiers:
1. **Employees:** View assigned performance goals, log quarterly check-ins (Q1-Q4), and track overall achievement percentages dynamically.
2. **Managers:** Review team overview metrics, approve or reject incoming goal sheets, unlock approved goal sheets for mid-cycle revisions, and monitor direct reports' completion progress.
3. **HR Admins:** Gain a bird's-eye view of organizational compliance, unlock any employee goal sheet across the company with full audit traceability, export system-wide reports to CSV, and monitor granular changes via the System Audit Log.

### 🎨 Modern, Dynamic UI
- **Real-time Tab Switching:** Eliminates jarring page refreshes using seamless DOM injection for a true Single Page Application (SPA) feel.
- **Global Theme Support:** Fully integrated Dark Mode / Light Mode capability utilizing Tailwind CSS, with user preferences persisting via local storage.
- **Advanced Action Controls:** Side-by-side management actions including instant Approve/Reject workflows, Goal Sheet Unlocking, and granular employee reviews.
- **Responsive Design:** Engineered to look beautiful and professional across desktops, tablets, and mobile devices.

### 🛡️ Robust Backend Architecture
- Express.js middleware enforces strict role verification on all API routes to prevent privilege escalation.
- Comprehensive SQLite3 database schema supporting foreign-key constraints for users, managers, goal sheets, individual goals, check-ins, escalation logs, and audit logs.
- Automatic EADDRINUSE crash protection.

---

## 🛠️ Technology Stack

* **Frontend:** HTML5, Vanilla JavaScript, Tailwind CSS (via CDN), Google Material Symbols.
* **Backend:** Node.js, Express.js.
* **Database:** SQLite3.
* **AI & Automation:** `@google/generative-ai`, `node-cron`, `@azure/msal-node`, `bcrypt`.

---

## 🚀 Getting Started

### Prerequisites
Make sure you have [Node.js](https://nodejs.org/) installed on your machine.

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Swanand08/atomberg-atomquest.git
   cd atomquest-portal
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   Copy the example environment file and add your Gemini API key (if applicable) and session secrets.
   ```bash
   cp .env.example .env
   ```

4. **Initialize the Database:**
   *(Optional)* If you want to start with a fresh slate of mock data, simply delete `atomquest.db` and the server will automatically seed realistic data upon startup.

5. **Start the Server:**
   ```bash
   npm run dev
   ```
   *or*
   ```bash
   node server.js
   ```

6. **Access the Portal:**
   Open your browser and navigate to `http://localhost:3000`.

### 🔑 Demo Credentials

To test the different portals, you can log in using the pre-seeded credentials:

| Role | Email | Password | Notes |
| :--- | :--- | :--- | :--- |
| **HR Admin** | `admin1@company.com` | `admin123` | Full system access |
| **Manager** | `manager1@company.com` | `mgr123` | Team oversight & approvals |
| **Employee** | `emp1@company.com` | `emp123` | Pre-loaded with demo goals & check-ins |
| **Employee (Clean Slate)** | `emp2@company.com` | `emp123` | No goals — perfect for live demo! |

---

## 🏗️ Architecture

```mermaid
graph TD
    Client[Browser / UI] -->|HTTP GET/POST| Express[Express.js Server]
    
    subgraph Backend
        Express -->|Validation| Auth[Auth Middleware]
        Auth --> Routes[API Routes: /api/goals, /api/manager, /api/admin, /api/ai]
    end

    Routes -->|Query / Execute| DB[(SQLite3 Database)]
    Routes -->|GenAI Scoring & Suggestions| Gemini[Gemini 1.5 Flash API]
    Routes -->|Scheduled Jobs| Cron[Node Cron Scheduler]
    
    DB -.->|Schema| Users[Users]
    DB -.->|Schema| Goals[Goal Sheets & Check-ins]
    DB -.->|Schema| Logs[Audit & Escalation Logs]
```

---

## 📁 Project Structure

```text
├── public/                 # Static frontend files (HTML, CSS, JS config)
│   ├── login.html          # Unified authentication gateway
│   ├── employee.html       # Employee dashboard & goal check-ins
│   ├── goal-form.html      # Goal creation with SMART scoring UI
│   ├── manager.html        # Team oversight & goal sheet approvals
│   └── admin.html          # Global compliance, audit logs, & exports
├── routes/                 # Express API backend endpoints
│   ├── auth.js             # Login, logout, dual-auth verification & profile data
│   ├── goals.js            # Goal creation, editing, & check-in logic
│   ├── manager.js          # Manager approval workflows & team activity
│   ├── admin.js            # System-wide metrics, audit log fetching & CSV generation
│   └── ai.js               # Gemini AI SMART scoring & goal generation endpoints
├── cron/                   # Automated background schedulers
│   └── escalations.js      # Daily escalation checks & mock webhook triggers
├── server.js               # Main Express application entry point & middleware
├── database.js             # SQLite3 connection & auto-seeding logic
└── .env                    # Environment configurations (Port, DB path, API keys)
```

---

## 👨‍💻 Development & Contribution
This application uses a centralized error-handling strategy and requires specific role authorizations for API access. When contributing:
- Always enforce `requireRole([roles])` on new API endpoints.
- Ensure any UI tab functionality utilizes the existing `tab-content` hidden/block toggling system to maintain SPA consistency.

---

**Built with dedication for performance, intelligence, and stability.**
