# 🛒 Elsie — Your AI Grocery Coach

**Real-time AI grocery coach for chronic health conditions — powered by Gemini Live API**

Elsie watches grocery store shelves through your phone camera and tells you what to grab — and what to skip — based on your specific health profile. Upload your lab report once; Elsie extracts your key health markers, immediately deletes the report, and uses those markers to evaluate every product you see.

> *Built for the [Gemini Live Agent Challenge](https://geminiliveagentchallenge.devpost.com/) — Category: Live Agent*

## 🎯 Problem

155 million Americans with diabetes or prediabetes are told to "watch what they eat." But when they stand in a grocery aisle facing 40,000 products, they're on their own. Existing tools scan one barcode at a time or analyze meals after purchase. Nobody coaches them in real-time, at the shelf, through voice and vision.

## 💡 Solution

Elsie is the first AI agent that watches the aisle with you and tells you what to grab through voice coaching in your earbuds or silent text cards on your screen. She works at any store, knows 4 million+ products, and if she doesn't recognize something, she reads the nutrition label live through the camera.

## 🏗️ Architecture

```
┌─────────────────────────────────┐
│     User's Phone (Browser)       │
│  Camera + Mic → WebSocket        │
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│   Google Cloud Run (Backend)     │
│   FastAPI + Gemini Live API      │
│   WebSocket bidirectional        │
└──────┬──────┬──────┬────────────┘
       │      │      │
       ▼      ▼      ▼
   Firestore  USDA   Open Food
   (profiles) API    Facts API
```

## 🛠️ Tech Stack

| Component | Technology |
|-----------|-----------|
| AI Model | Gemini 2.0 Flash Live (via Vertex AI) |
| Backend | Python / FastAPI |
| Real-time | Gemini Live API (WebSocket, bidirectional audio+video) |
| Database | Google Cloud Firestore |
| Hosting | Google Cloud Run |
| Nutrition Data | USDA FoodData Central API + Open Food Facts API |
| Frontend | HTML/CSS/JS (Progressive Web App) |
| Agent Framework | Google GenAI SDK with function calling |

## 🚀 Setup & Deployment

### Prerequisites
- Google Cloud account with billing enabled
- Google Cloud CLI (`gcloud`) installed
- Python 3.12+

### Local Development

```bash
# Clone the repo
git clone https://github.com/priyanayyar27/elsie-grocery-coach.git
cd elsie-grocery-coach

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export GOOGLE_CLOUD_PROJECT=elsie-grocery-coach

# Run locally
python main.py
```

### Deploy to Google Cloud Run

```bash
# One-command automated deployment
chmod +x deploy.sh
./deploy.sh
```

This script will:
1. Set the GCP project
2. Enable required APIs
3. Build the container image via Cloud Build
4. Deploy to Cloud Run with public access
5. Output the live URL

### Manual Deployment

```bash
# Build
gcloud builds submit --tag gcr.io/elsie-grocery-coach/elsie-grocery-coach

# Deploy
gcloud run deploy elsie-grocery-coach \
  --image gcr.io/elsie-grocery-coach/elsie-grocery-coach \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=elsie-grocery-coach"
```

## 📱 How to Use

1. Open the app URL on your phone
2. Select your health conditions / dietary goals
3. (Optional) Upload a lab report — Elsie reads it and deletes it
4. Tap "Let's Shop!" and point your camera at products
5. Elsie coaches you through your earbuds or text cards

## 🔒 Privacy & Compliance

- **No medical claims** — Elsie is a wellness tool, not a medical device
- **Lab reports are never stored** — only extracted health markers are saved
- **FDA General Wellness compliant** — positioned as dietary preference guidance
- **User controls their data** — can view, edit, or delete stored markers anytime

## 📊 Data Sources

- **USDA FoodData Central** — Authoritative US government nutrition database (updated monthly)
- **Open Food Facts** — Open-source database with 4M+ products from 150 countries
- **Live Camera OCR** — Gemini Vision reads nutrition labels in real-time for unknown products

## 🏆 Hackathon Details

- **Challenge:** Gemini Live Agent Challenge
- **Category:** Live Agent
- **Google Cloud Project ID:** elsie-grocery-coach
- **Third-party integrations:** USDA FoodData Central API (public domain, CC0), Open Food Facts API (Open Database License)

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

*Created for the Gemini Live Agent Challenge hackathon. #GeminiLiveAgentChallenge*
