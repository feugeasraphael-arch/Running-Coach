"""Entry point kept for `uvicorn app:app` / `python app.py`.

The HTTP layer now lives in the api/ package (one router per domain); all
analytics logic stays in coach.py / cook.py / effort.py / activity_insights.py
and all storage access in db.py.
"""
from api.main import app  # noqa: F401

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
