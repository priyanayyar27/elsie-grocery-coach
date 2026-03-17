#!/bin/bash
# ===== Elsie Grocery Coach — Automated Cloud Deployment =====
# This script automates the deployment to Google Cloud Run
# Required for the +0.2 hackathon bonus points

set -e

PROJECT_ID="elsie-grocery-coach"
REGION="us-central1"
SERVICE_NAME="elsie-grocery-coach"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🛒 Deploying Elsie to Google Cloud Run..."
echo "==========================================="

# Step 1: Set project
echo "📋 Setting project to ${PROJECT_ID}..."
gcloud config set project ${PROJECT_ID}

# Step 2: Enable required APIs (idempotent)
echo "🔌 Enabling APIs..."
gcloud services enable \
    aiplatform.googleapis.com \
    firestore.googleapis.com \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    containerregistry.googleapis.com \
    --project=${PROJECT_ID}

# Step 3: Build container image using Cloud Build
echo "🏗️ Building container image..."
gcloud builds submit --tag ${IMAGE_NAME} --project=${PROJECT_ID}

# Step 4: Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
    --image ${IMAGE_NAME} \
    --platform managed \
    --region ${REGION} \
    --allow-unauthenticated \
    --set-env-vars="GOOGLE_CLOUD_PROJECT=${PROJECT_ID}" \
    --memory=1Gi \
    --cpu=2 \
    --timeout=3600 \
    --max-instances=10 \
    --min-instances=0 \
    --project=${PROJECT_ID}

# Step 5: Get the URL
echo ""
echo "==========================================="
echo "✅ Elsie is LIVE!"
SERVICE_URL=$(gcloud run services describe ${SERVICE_NAME} --platform managed --region ${REGION} --format 'value(status.url)' --project=${PROJECT_ID})
echo "🌐 URL: ${SERVICE_URL}"
echo "==========================================="
echo ""
echo "Open this URL on your phone and start shopping! 🛒"
