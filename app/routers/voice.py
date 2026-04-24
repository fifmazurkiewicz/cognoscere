from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from ..config import settings
from ..routers.deps import get_current_user

router = APIRouter()

SUPPORTED_TYPES = {
    "audio/webm", "audio/mp4", "audio/mpeg", "audio/ogg",
    "audio/wav", "audio/x-m4a", "video/webm",
}
MAX_SIZE_MB = 25


class TranscriptionResponse(BaseModel):
    text: str


@router.post("/voice/transcribe", response_model=TranscriptionResponse)
async def transcribe(
    audio: UploadFile = File(...),
    _user=Depends(get_current_user),
) -> TranscriptionResponse:
    if not settings.groq_api_key:
        raise HTTPException(
            status_code=503,
            detail="Transkrypcja głosu nie jest skonfigurowana (brak GROQ_API_KEY)",
        )

    content = await audio.read()
    if len(content) > MAX_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Plik za duży (max {MAX_SIZE_MB}MB)")

    from groq import AsyncGroq

    client = AsyncGroq(api_key=settings.groq_api_key)

    filename = audio.filename or "recording.webm"
    mime = audio.content_type or "audio/webm"

    transcription = await client.audio.transcriptions.create(
        file=(filename, content, mime),
        model="whisper-large-v3-turbo",
        language="pl",
        response_format="text",
    )

    return TranscriptionResponse(text=str(transcription).strip())
