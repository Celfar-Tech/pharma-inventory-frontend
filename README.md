# Pharma Inventory Frontend

Frontend for the Pharma Inventory application — a pharmacy management dashboard built with **React 19 + TypeScript + Vite** and **Mantine UI**. It covers inventory management, medicine management, manufacturing data, billing, and invoice management, backed by the `pharma-inventory-backend` REST API.

## Tech Stack

- **React 19** with **TypeScript** and **Vite** (HMR)
- **Mantine UI** (`@mantine/core`, `@mantine/dates`, `@mantine/form`, `@mantine/hooks`, `@mantine/notifications`) for components, forms, and notifications
- **React Router** for navigation
- **@tabler/icons-react** + **lucide-react** for icons
- **@react-oauth/google** for Google sign-in
- **html2canvas** + **jspdf** for generating/downloading invoice PDFs

## Getting Started

```bash
# Install dependencies
npm install

# Start the dev server
npm run dev

# Lint
npm run lint

# Type-check + production build
npm run build

# Preview the production build
npm run preview
```

The app expects the backend API at the URL set via the `VITE_API_URL` environment variable (see `src/services/apiClient.ts`). The dev server is available at `http://129.121.135.236:5173/` by default.

## Features

- **Authentication** — login / sign-up with Google OAuth (see `src/services/authcontext.tsx`, `src/components/login.tsx`, `src/services/ProtectedRoute.tsx`)
- **Dashboard** — overview metrics and insights (`src/components/dashboard.tsx`)
- **Inventory** — stock management, add inventory entries (`src/components/inventory.tsx`, `src/components/addinventory.tsx`)
- **Medicines** — medicine catalogue management (`src/components/addmedicine.tsx`)
- **Manufacturers** — manufacturer data management
- **Billing** — create invoices with line items, discounts, GST breakdown (`src/components/billing.tsx`)
- **Invoices** — list, view, edit, and **print / download as PDF** (`src/components/Invoices.tsx`)

## Invoice Printing & PDF Download

Invoices can be printed or saved as a PDF directly from the **Invoices** page:

1. Click the **Print** action on any invoice row. This opens a print-preview modal (it fetches the full invoice detail via `GET /billing/invoice/:invoiceNumber`).
2. Use the **Print** button to open the rendered invoice in a new window and trigger the browser's print dialog (`window.open` + `window.print`).
3. Use the **Download PDF** button to rasterise the invoice with `html2canvas` and save it as a multi-page A4 PDF with `jspdf` (filename = invoice number).

### Printable layout — `src/components/InvoicePrint.tsx`

- A self-contained A4 **tax invoice** component rendered with `forwardRef` pointing at the A4 sheet.
- All styling is scoped in a `<style>` block using plain CSS (no framework classes), so the same node can be printed in a new window or rasterised to a PDF without losing its look. It is **794px** wide on screen and switches to **210mm** under `@media print`.
- Shows pharmacy letterhead, invoice meta, billing/doctor details, an itemised medicines table (batch, expiry, pack, MRP, rate, discount, GST, taxable, amount), tax breakup, totals (gross, item discount, flat discount, subtotal, final payable), and the amount in words (Indian numbering system).

> **To update the pharmacy letterhead** (name, tagline, address, phone, email, GSTIN, DL number) edit the `PHARMACY` constant at the top of `src/components/InvoicePrint.tsx`. There is no backend pharmacy config yet.

## Project Structure

```
src/
├── main.tsx              # App entry
├── App.tsx               # Route definitions
├── components/           # UI screens & shared components
│   ├── dashboard.tsx
│   ├── inventory.tsx
│   ├── billing.tsx
│   ├── Invoices.tsx      # Invoice list + print/PDF preview modal
│   ├── InvoicePrint.tsx  # Printable A4 tax-invoice layout
│   ├── addinventory.tsx
│   ├── addmedicine.tsx
│   ├── login.tsx
│   ├── header.tsx
│   ├── sidebar.tsx
│   └── ...
├── services/             # API clients & types
│   ├── apiClient.ts
│   ├── authcontext.tsx
│   ├── billing.ts
│   ├── inventory.ts
│   ├── medicine.ts
│   ├── manufacturer.ts
│   ├── user.ts
│   └── ...
└── utils/
    └── debounce.ts
```

## Dependencies Added for Invoicing

- `html2canvas` — rasterises the on-screen invoice into a canvas image
- `jspdf` — packs the canvas into a downloadable multi-page A4 PDF
