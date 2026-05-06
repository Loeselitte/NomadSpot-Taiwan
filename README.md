# NomadSpot Taiwan ☕

> 台灣數位遊牧咖啡廳探索地圖 — A curated workspace discovery map for digital nomads in Taiwan.

![NomadSpot Taiwan](public/assets/icons/NomadSpot%20TW.svg)

---

## Overview

NomadSpot Taiwan is an interactive, multilingual web application that helps digital nomads, remote workers, and café-hoppers discover the best café workspaces across Taiwan. It combines real-time weather and AQI data with a composite **Work Index** to help users find the ideal spot to settle in and get things done.

**Supported Languages  English

---

## 功能特色 / Features

- 🗺️ **Interactive Leaflet.js Map** — browse cafés by city or region with custom SVG map markers
- 📊 **Work Index** — composite score based on Wi-Fi, seating, noise, power outlets, and hours
- 🌤️ **Real-time Weather & AQI** — live environmental data per location via external APIs
- 🖼️ **Café Detail Panel** — responsive drawer / bottom-sheet with photos, amenities, and contact info
- 🌐 **Multilingual UI** — full i18n across Traditional Chinese, English, Dutch, and French
- 📱 **Responsive Design** — two-page architecture optimised for both desktop and mobile
- 🎨 **Editorial Heritage Design System** — custom typography, palette, and iconography

---

##  Project Structure

```
/NomadSpot-Taiwan
│
├── .gitignore
├── package.json                # Node.js dependencies & scripts
├── package-lock.json
├── server.js                   # Production Express server (Vercel)
├── server_local.js             # Local development server
├── vercel.json                 # Vercel deployment configuration

│
├── data/
│   └── cafes.json              # Curated café dataset (all locations & metadata)
│
├── design-refs/                # UI design reference screenshots
│   ├── cafe-detail.png         # Café detail panel mockup
│   ├── intro.png               # Landing page mockup
│   └── map.png                 # Map view mockup
│
├── public/                     # Static frontend assets served to browser
│   ├── index.html              # Landing / intro page
│   ├── map.html                # Main map application page
│   ├── map.js                  # Map logic — English version
│   ├── styles.css              # Global styles — English version
│   │
│   └── assets/
│       ├── favicon.svg
│       ├── index.svg           # Landing page illustration
│       │
│       ├── cafe-images/        # Café photography (cafe-1.jpg … cafe-27.jpg)
│       │
│       └── icons/              # UI icons & region markers
│           ├── logo.svg
│           ├── NomadSpot TW.svg
│           ├── north.svg       # Region: North Taiwan
│           ├── central.svg     # Region: Central Taiwan
│           ├── south.svg       # Region: South Taiwan
│           ├── east.svg        # Region: East Taiwan
│           ├── bicycle2.svg
│           ├── clock.svg / clock.png
│           ├── location.png
│           ├── instagram.png
│           ├── phone.png
│           ├── star.png
│           ├── rain.png
│           └── wind.png
│
└── scripts/
    └── verify-bff.mjs          # BFF (Backend-for-Frontend) verification script
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5, CSS3, Vanilla JavaScript |
| Map Engine | [Leaflet.js](https://leafletjs.com/) |
| Backend | [Express.js](https://expressjs.com/) (Node.js) |
| HTTP Client | Axios |
| Environment | dotenv |
| Deployment | [Vercel](https://vercel.com/) |
| Data | Static JSON (`data/cafes.json`) |

---

##  Getting Started

###  Prerequisites

- Node.js `>= 18.x`
- npm

### 安裝 / Installation

```bash
git clone https://github.com/<your-username>/NomadSpot-Taiwan.git
cd NomadSpot-Taiwan
npm install
```

###  Environment Variables

Create a `.env` file in the project root (see `.env` for reference):

```env
WEATHER_API_KEY=your_openweather_api_key
AQI_API_KEY=your_aqi_api_key
PORT=3000
```

> ⚠️ Never commit `.env` to version control. It is listed in `.gitignore`.

###  Local Development

```bash
node server_local.js
```

Open [http://localhost:3000](http://localhost:3000) in your browser.


## Scripts

| Script | Description |
|---|---|
| `node server.js` | Start production server |
| `node server_local.js` | Start local development server |
| `node scripts/verify-bff.mjs` | Verify Backend-for-Frontend proxy routes |

---

## 授權 / License

This project is for personal and educational use. All café images and data are curated independently.

---

## Acknowledgements

Built with ☕ and 💻 by Victor, Lieselotte, Sophie, and Shelly.

> *Find your spot. Do your best work.*
