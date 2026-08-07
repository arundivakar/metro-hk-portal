# Metro HK Portal - Project Handover Document

This document serves as the complete context and handover guide for the Fedora Antigravity IDE instance to seamlessly continue development on the **Metro HK Portal** project. 

## 1. Project Overview
- **Name:** Metro HK Portal
- **Purpose:** A centralized Housekeeping (HK) & Inventory management system that replaces an older Google Sheets-based workflow for a metro rail network.
- **Tech Stack:** 
  - **Frontend:** React 19, Vite, React Router DOM v6
  - **Styling:** Custom CSS with CSS variables (`src/styles/`), minimal external UI libraries.
  - **Backend/Database:** Supabase (PostgreSQL, Auth, REST API).
  - **Hosting:** Render (Frontend). Supabase (Backend).

## 2. Key Terminology & Domain Logic
- **ALS (Asset & Logistics Supervisor):** The primary admin role that manages master data, approves requests, and runs reports.
- **Stations:** The portal supports multiple stations (e.g., PNCU, ALVA, JLSD, etc.). Users are assigned to stations via `user_stations`.
- **Tender Year:** Inventory pricing and tracking are strictly bound to "Tender Years" (e.g., `2024-25`). **CRITICAL RULE:** Any items from tender years containing "Before 2024" or `2023` are excluded from official monthly billing calculations.
- **Units & Conversions (`src/utils/units.js`):**
  - **Database Storage (Base Units):** `ml`, `g`, `Nos`.
  - **UI Display (Display Units):** `Ltr`, `Kg`, `Nos`.
  - *Rule:* Always store in base units. Convert to display units only on the frontend.
- **Floating Point Math:** Because some units are handled fractionally, there are tolerances built into consumption validation to prevent constraints like `current_stock >= 0` from failing when dealing with values like `0.9999`.

## 3. Database Schema Highlights
The database uses Supabase PostgreSQL. Key tables include:
- `stations`: List of all metro stations.
- `inventory_items`: Master list of consumables and assets.
- `rate_master`: Stores pricing, supplier info (e.g., Tricuesta, KleanTrade), and tender years.
- `station_inventory`: The current snapshot of stock per item per station (`current_stock`).
- `consumption_logs`: Every time an item is used or transferred, a log is created here. Triggers automatically update `station_inventory.current_stock`.
- `stock_received`: Logs of new stock arrivals (or opening stock initializations). Triggers update `station_inventory`.
- `consumable_requests` & `request_approvals`: Workflow for stations requesting items and ALS approving them.

## 4. Most Recent Work (August 2026)
### Business Continuity Module
We recently built a Business Continuity & Emergency Recovery Module to ensure operations can fallback to Google Sheets if the portal goes down.
- **Location:** `src/pages/BusinessContinuity.jsx` and `src/lib/businessContinuityExporter.js`.
- **Details:** Generates complex Excel workbooks with 9 sheets (Opening Stock, Stock Received, Consumption, Transfers, Current Stock, Monthly Bill, Requests, Approvals, Verification).
- **Gotchas Fixed:** Supabase JS v2 filter chaining required reassignment (`query = query.filter()`), and we removed `!inner` alias hints because PostgREST was silently failing joins.

### UI/UX Refinements
- **Stock Validation Tolerance:** Fixed a bug where `0.999` stock (displayed as `1 Nos`) threw an error when consuming `1`. A `.01` tolerance was added in `StockMovement.jsx`.
- **Number Input Scrolling:** Disabled mouse-wheel scrolling and removed up/down spinner arrows on `input[type="number"]` across the application via `src/styles/index.css` and a global listener in `src/main.jsx`.

## 5. Instructions for Fedora Antigravity
When you pick up this project:
1. **Environment Setup:** Ensure `.env` is properly loaded with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
2. **Execution:** Standard run command is `npm run dev` or `vite build`. Note that on Windows, some commands previously required `cmd /c`, but on Fedora, standard Bash commands (`npm install`, `npm run dev`) will work perfectly.
3. **Strict Constraints:** **DO NOT** modify core inventory math or database triggers unless explicitly requested. The portal is actively balancing fractional units, and any math changes can break the monthly billing aggregate logic in `MonthlyBill.jsx`.

## 6. Current Pending/Next Steps
- Monitor the **Business Continuity Module** for any data discrepancies from the ALS user.
- Await the user's next directive regarding feature enhancements or UI tweaks.
