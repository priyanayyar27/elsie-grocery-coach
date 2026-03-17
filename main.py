"""
Elsie — AI Grocery Coach Backend
================================
Real-time AI grocery coaching for people managing chronic health conditions.
Built with Gemini Live API + Google Cloud for the Gemini Live Agent Challenge.

Architecture:
    Phone Camera → WebSocket → Gemini Live API (continuous vision context)
    User Question → /api/ask → Gemini generate_content (reliable evaluation)
    Lab Reports  → /api/upload-report → Gemini Vision (marker extraction)
    Health Data   → Firestore (profile persistence)

Author: Priyanka Nayyar
"""

import os
import json
import asyncio
import base64
import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse, JSONResponse


# ============================================================
# App Configuration
# ============================================================

app = FastAPI(title="Elsie - AI Grocery Coach")
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT", "elsie-grocery-coach")
LIVE_MODEL = "gemini-2.0-flash-live-preview-04-09"
EVAL_MODEL = "gemini-2.0-flash-001"


# ============================================================
# Lazy-initialized Clients (Cloud Run cold start optimization)
# ============================================================

_db = None
_client = None


def get_db():
    """Lazy Firestore client — initialized on first request, reused after."""
    global _db
    if _db is None:
        from google.cloud import firestore as fs
        _db = fs.AsyncClient(project=PROJECT_ID)
    return _db


def get_genai_client():
    """Lazy Gemini client — initialized on first request, reused after."""
    global _client
    if _client is None:
        from google import genai
        _client = genai.Client(vertexai=True, project=PROJECT_ID, location="us-central1")
    return _client


# ============================================================
# Elsie's Personality & Evaluation Prompts
# ============================================================

ELSIE_SYSTEM_PROMPT = """You are Elsie, a delightfully witty AI grocery coach.

PERSONALITY:
- Warm, playful, genuinely enthusiastic about helping people eat well
- Clever food puns: "That cereal has more sugar than a birthday cake wearing a lab coat!"
- Celebrate good choices: "Ooh, jackpot! That salmon is an omega-3 goldmine!"
- Never judgmental — gently redirect with humor
- Keep it to 2-3 sentences max. Grocery aisles move fast.
- Natural filler: "Hmm let me take a look...", "Ooh good question!"

WHEN YOU SEE A PRODUCT:
1. Identify it by name and brand
2. Read any visible nutrition info
3. Evaluate against user's health profile
4. Give a clear BUY or SKIP verdict with reason

RESPONSE PATTERNS:
- GOOD: "Ooh nice pick! That [product] is great for you — [reason]. Toss it in!"
- BAD: "Hmm, I'd skip the [product] — [reason]. Try [alternative] instead!"
- NEED INFO: "Flip it over so I can read the nutrition label!"
- ALLERGEN: "Whoa, hold up! That's got [allergen]. Put that one back, friend."
- CAN'T SEE: "Can you hold it a bit closer?"

RULES:
- NEVER say diagnose, treat, cure, or prevent disease
- Frame as dietary preferences, not medical management
- You are a wellness and nutrition info tool, not a medical device"""


ELSIE_EVAL_PROMPT = """You are Elsie, a witty AI grocery coach. The user is showing you a product through their phone camera while shopping.

USER'S HEALTH PROFILE:
{user_profile}

USER'S QUESTION: {question}

Look at the product image carefully. Identify it by name and brand if visible. Then answer based on their health profile. Be specific about the product. Keep response to 2-3 sentences. Be warm and witty. If you cannot identify the product, ask them to hold it closer."""


# ============================================================
# Helper: User Profile from Firestore
# ============================================================

async def get_user_profile(user_id: str) -> dict:
    """Retrieve user health profile from Firestore."""
    try:
        db = get_db()
        doc = await db.collection("users").document(user_id).get()
        if doc.exists:
            return doc.to_dict()
    except Exception as e:
        print(f"[Profile] Error loading {user_id}: {e}")
    return {"conditions": [], "markers": {}, "allergies": []}


# ============================================================
# Helper: Nutrition Lookup APIs
# ============================================================

async def lookup_nutrition(product_name: str) -> dict:
    """Look up product nutrition from USDA FoodData Central API."""
    api_key = os.environ.get("USDA_API_KEY", "DEMO_KEY")
    url = "https://api.nal.usda.gov/fdc/v1/foods/search"
    params = {"api_key": api_key, "query": product_name, "dataType": ["Branded"], "pageSize": 3}
    async with httpx.AsyncClient() as http:
        try:
            resp = await http.get(url, params=params, timeout=10)
            data = resp.json()
            if data.get("foods"):
                food = data["foods"][0]
                nutrients = {n.get("nutrientName", ""): n.get("value", 0) for n in food.get("foodNutrients", [])}
                return {"found": True, "product": food.get("description", product_name), "brand": food.get("brandOwner", "Unknown"), "nutrients": nutrients}
        except Exception as e:
            print(f"[USDA] Lookup error: {e}")
    return {"found": False, "message": f"No results for {product_name}"}


async def lookup_openfoodfacts(query: str) -> dict:
    """Look up product from Open Food Facts (4M+ products worldwide)."""
    url = "https://world.openfoodfacts.org/cgi/search.pl"
    params = {"search_terms": query, "json": 1, "page_size": 3}
    async with httpx.AsyncClient() as http:
        try:
            resp = await http.get(url, params=params, timeout=10)
            data = resp.json()
            if data.get("products"):
                p = data["products"][0]
                return {"found": True, "product": p.get("product_name", query), "brand": p.get("brands", "Unknown"), "nutrients": p.get("nutriments", {}), "allergens": p.get("allergens", "")}
        except Exception as e:
            print(f"[OFF] Lookup error: {e}")
    return {"found": False, "message": f"No results for {query}"}


# ============================================================
# Routes: Pages
# ============================================================

@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Run."""
    return {"status": "healthy"}


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Serve the Elsie web app."""
    return templates.TemplateResponse("index.html", {"request": request})


# ============================================================
# Routes: User Profile
# ============================================================

@app.post("/api/profile/{user_id}")
async def update_profile(user_id: str, request: Request):
    """Save or update user health profile to Firestore."""
    data = await request.json()
    db = get_db()
    await db.collection("users").document(user_id).set(data, merge=True)
    return {"status": "updated", "user_id": user_id}


@app.get("/api/profile/{user_id}")
async def read_profile(user_id: str):
    """Read user health profile from Firestore."""
    db = get_db()
    doc = await db.collection("users").document(user_id).get()
    if doc.exists:
        return doc.to_dict()
    return {"conditions": [], "markers": {}, "allergies": []}


# ============================================================
# Routes: Lab Report Upload & Marker Extraction
# ============================================================

@app.post("/api/upload-report/{user_id}")
async def upload_report(user_id: str, file: UploadFile = File(...)):
    """
    Upload a lab report (PDF/image). Gemini Vision extracts health markers.
    The report is processed in-memory and immediately discarded — only
    extracted key-value markers are saved to Firestore.
    """
    contents = await file.read()
    b64_data = base64.b64encode(contents).decode()
    mime = file.content_type or "application/pdf"

    try:
        c = get_genai_client()
        response = c.models.generate_content(
            model=EVAL_MODEL,
            contents=[{
                "role": "user",
                "parts": [
                    {"inline_data": {"data": b64_data, "mime_type": mime}},
                    {"text": "Extract ALL health markers, lab values, and test results from this report. Return ONLY a JSON object: {\"markers\": {\"marker_name\": value, ...}, \"conditions_detected\": [...]}. Include every single value you can read — blood counts, vitamins, minerals, hormones, liver function, kidney function, thyroid, cholesterol panel, metabolic panel, iron, ferritin, B12, vitamin D, calcium, everything present in the report. Use lowercase_snake_case for marker names. Use numeric values only (no units in values)."}
                ]
            }],
        )
        text = response.text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        markers_data = json.loads(text)
    except Exception as e:
        print(f"[Upload] Extraction error: {e}")
        markers_data = {"markers": {}, "conditions_detected": []}

    try:
        db = get_db()
        await db.collection("users").document(user_id).set(markers_data, merge=True)
    except Exception as e:
        print(f"[Upload] Firestore error: {e}")

    return {"status": "markers_extracted", "data": markers_data, "note": "Report processed and deleted."}


# ============================================================
# Routes: Product Evaluation (Reliable Path)
# ============================================================

@app.post("/api/ask/{user_id}")
async def ask_elsie(user_id: str, request: Request):
    """
    Evaluate a grocery product against the user's health profile.
    
    Input: { "question": "Can I buy this?", "image": "<base64 JPEG>" }
    Process: Camera frame + question + user profile → Gemini Vision
    Output: { "response": "Elsie's evaluation text" }
    
    Uses the same proven generate_content format as the upload endpoint.
    """
    try:
        data = await request.json()
        question = data.get("question", "What is this product? Should I buy it?")
        image_b64 = data.get("image", "")

        if not image_b64:
            return {"response": "I can't see anything! Point your camera at a product and try again."}

        # Load user health profile from Firestore
        profile = await get_user_profile(user_id)
        profile_str = json.dumps(profile, indent=2)

        # Build evaluation prompt with health context
        prompt = ELSIE_EVAL_PROMPT.format(user_profile=profile_str, question=question)

        # Send image + prompt to Gemini (same format as proven upload endpoint)
        c = get_genai_client()
        response = c.models.generate_content(
            model=EVAL_MODEL,
            contents=[{
                "role": "user",
                "parts": [
                    {"inline_data": {"data": image_b64, "mime_type": "image/jpeg"}},
                    {"text": prompt}
                ]
            }],
        )

        answer = response.text.strip()
        print(f"[Elsie] {answer[:100]}")
        return {"response": answer}

    except Exception as e:
        print(f"[Ask] Error: {e}")
        return {"response": "Hmm, I had trouble seeing that. Can you try again?"}


# ============================================================
# WebSocket: Gemini Live API (Real-time Vision Streaming)
# ============================================================

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """
    Bidirectional WebSocket connecting the user's phone camera to Gemini Live API.
    
    This maintains a persistent vision context — Gemini continuously observes
    the shopping environment through streamed video frames. When the user asks
    a question, this context enriches Gemini's understanding of what products
    are visible and what the shopping environment looks like.
    
    The Live API session also handles any spontaneous text responses Gemini
    generates based on what it observes.
    """
    await websocket.accept()
    profile = await get_user_profile(user_id)
    system = ELSIE_SYSTEM_PROMPT + "\n\nUSER PROFILE:\n" + json.dumps(profile, indent=2)

    try:
        from google import genai
        from google.genai import types

        config = types.LiveConnectConfig(
            response_modalities=[types.Modality.TEXT],
            system_instruction=types.Content(
                role="user",
                parts=[types.Part(text=system)],
            ),
        )

        c = get_genai_client()
        print("[WS] Connecting to Gemini Live API...")
        async with c.aio.live.connect(model=LIVE_MODEL, config=config) as session:
            print("[WS] Live session established")

            async def stream_from_browser():
                """Receive camera frames from browser and stream to Gemini Live."""
                try:
                    while True:
                        data = await websocket.receive_text()
                        msg = json.loads(data)
                        if msg["type"] == "video":
                            image_bytes = base64.b64decode(msg["data"])
                            await session.send_realtime_input(
                                video=types.Blob(data=image_bytes, mime_type="image/jpeg")
                            )
                except WebSocketDisconnect:
                    print("[WS] Browser disconnected")
                except Exception as e:
                    print(f"[WS] Stream error: {e}")

            async def relay_to_browser():
                """Forward any Gemini Live responses to the browser."""
                try:
                    async for response in session.receive():
                        if response.text:
                            print(f"[WS] Gemini says: {response.text[:60]}")
                            await websocket.send_json({"type": "text", "data": response.text})
                except WebSocketDisconnect:
                    pass
                except Exception as e:
                    print(f"[WS] Relay error: {e}")

            await asyncio.gather(stream_from_browser(), relay_to_browser())

    except Exception as e:
        print(f"[WS] Session error: {e}")
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ============================================================
# Entry Point
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080)
    