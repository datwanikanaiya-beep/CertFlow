<div align="center">
  <div style="background-color: #0f172a; padding: 40px; border-radius: 16px; border: 1px solid #1e293b;">
    <h1 style="color: #fff; margin-bottom: 0;">CertFlow</h1>
    <p style="color: #94a3b8; font-size: 1.2rem;">Simple, stunning, and automated Let's Encrypt production certificates.</p>
  </div>
</div>

# 🚀 Quick Start

CertFlow is an intuitive, fully-featured desktop-style web application that makes generating **Production-Level Let's Encrypt SSL Certificates** incredibly easy. It handles the complete ACME DNS-01 lifecycle in a gorgeous, user-friendly UI.

## Features
- **Modern Dashboard**: Glowing dark-mode UI with glassmorphism panels.
- **Production Certificates**: Generates actual trusted Let's Encrypt `.cert` and `.key` files.
- **Wildcard & SAN Support**: Enter multiple domains like `example.com, *.example.com`.
- **Background Automation**: Handles ACME client handshakes, CSR generation, and background polling.

## 📦 How to Start

**Prerequisites:** [Node.js](https://nodejs.org/en) (v18+ recommended)

### 1. Install & Run (One Command)
Just clone the repository, install packages, and start the development server.

```bash
# 1. Install dependencies
npm install

# 2. Run the application
npm run dev
```

The application will start at `http://localhost:3000`.

### 2. Generate Your Certificate
1. Open the dashboard.
2. Enter your Domains (e.g., `example.com, www.example.com`).
3. Enter your Maintainer Email.
4. Toggle **"Production Mode"** on if you want real trusted certificates (leave it off for testing/staging to avoid rate limits).
5. Click **Generate Certificate**.
6. The app will provide you with **TXT Records** you need to add to your DNS provider. 
7. Click "Verify" once the records propagate, and download your newly minted certificates!

## ⚙️ Building for Production
If you want to run this as a standalone production server:
```bash
npm run build
npm run start
```
