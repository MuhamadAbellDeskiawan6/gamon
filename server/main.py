from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO

import base64
import cv2
import numpy as np
import uvicorn

# =====================================
# APP
# =====================================

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"]
)

# =====================================
# LOAD MODEL
# =====================================

model = YOLO("yolov8n.pt")

# =====================================
# ROOT
# =====================================

@app.get("/")
def root():

    return {
        "status": "running"
    }

# =====================================
# DETECT
# =====================================

@app.post("/detect")
async def detect(request: Request):

    try:

        data = await request.json()

        image = data["image"]

        if "," in image:
            image = image.split(",")[1]

        img_bytes = base64.b64decode(image)

        nparr = np.frombuffer(
            img_bytes,
            np.uint8
        )

        frame = cv2.imdecode(
            nparr,
            cv2.IMREAD_COLOR
        )

        results = model(frame)

        objects = []

        for r in results:

            for box in r.boxes:

                cls = int(box.cls[0])

                conf = float(box.conf[0])

                name = model.names[cls]

                x1, y1, x2, y2 = box.xyxy[0]

                objects.append({
                    "name": name,
                    "confidence": round(conf, 2),
                    "x1": int(x1),
                    "y1": int(y1),
                    "x2": int(x2),
                    "y2": int(y2)
                })

        return {
            "status": "success",
            "objects": objects
        }

    except Exception as e:

        return {
            "status": "error",
            "message": str(e)
        }

# =====================================
# RUN
# =====================================

if __name__ == "__main__":

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000
    )