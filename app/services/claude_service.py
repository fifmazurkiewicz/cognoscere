import json
import logging
from dataclasses import dataclass, field

import anthropic

from ..config import settings
from ..models.session import EmotionSession, SessionMessage, SessionStage, SomaticMapping

logger = logging.getLogger(__name__)

APPROACH_LABELS = {
    "cbt": "Terapia Poznawczo-Behawioralna (CBT)",
    "act": "Acceptance and Commitment Therapy (ACT)",
    "dbt": "Dialectical Behavior Therapy (DBT)",
    "psychodynamic": "Terapia psychodynamiczna",
    "mixed": "Podejście mieszane",
}

INTENSITY_LABELS = {
    "gentle": "delikatne i wspierające, bez konfrontacji",
    "moderate": "zrównoważone — wspierające ale aktywne",
    "confrontational": "aktywnie konfrontacyjne, bezpośrednie podważanie",
}

STAGE_INSTRUCTIONS = {
    SessionStage.emotion_id: """\
ETAP: Identyfikacja emocji (2/5)
Zadanie: Zadawaj pytania różnicujące by pomóc pacjentowi nazwać 1-3 emocje.
Przykłady: "Czy to bardziej przypomina strach czy złość?", "Na kogo lub co kierujesz to uczucie?"
Maksymalnie 5 pytań. Gdy emocje jasno zidentyfikowane: advance_stage=true.
extracted_data: {"identified_emotions": [{"type": "fear|anger|sadness|shame|disgust|guilt|anxiety", "intensity": 1-10}]}""",

    SessionStage.thought_excavation: """\
ETAP: Wydobycie myśli (3/5)
Zadanie: Techniki sokratejskie — od myśli automatycznej do przekonania podstawowego.
Pytania: "Co pomyślałeś w tamtej chwili?", "Co to o Tobie mówi?", "Skąd wiesz że tak będzie?"
Gdy łańcuch kompletny: advance_stage=true.
extracted_data: {"automatic_thought": "...", "intermediate_belief": "...", "core_belief": "..."}""",

    SessionStage.chain_challenging: """\
ETAP: Podważenie przekonań (4/5)
Zadanie: Zidentyfikuj zniekształcenie poznawcze, zadaj pytania które je kwestionują.
Zniekształcenia: catastrophizing, mind_reading, personalization, mental_filter, all_or_nothing, should_statements, emotional_reasoning, labeling
Pytania: "Jakie masz dowody za i przeciw?", "Co powiedziałbyś przyjacielowi?", "Jaki jest najbardziej realistyczny scenariusz?"
Po 4-6 wymianach zakończ: advance_stage=true.
extracted_data: {"cognitive_distortion": "...", "alternative_perspective": "...", "summary": "3-4 zdania co pacjent odkrył w tej sesji"}""",
}


@dataclass
class ClaudeResponse:
    message: str
    stage: str
    advance_stage: bool = False
    crisis: bool = False
    extracted_data: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict) -> "ClaudeResponse":
        return cls(
            message=str(data.get("message", "")),
            stage=str(data.get("stage", "emotion_id")),
            advance_stage=bool(data.get("advance_stage", False)),
            crisis=bool(data.get("crisis", False)),
            extracted_data=data.get("extracted_data", {}) or {},
        )

    @classmethod
    def fallback(cls, stage: str) -> "ClaudeResponse":
        return cls(
            message="Przepraszam, wystąpił chwilowy problem techniczny. Czy możesz powtórzyć?",
            stage=stage,
        )


# Mock responses for local dev without ANTHROPIC_API_KEY
_MOCK: dict[SessionStage, ClaudeResponse] = {
    SessionStage.emotion_id: ClaudeResponse(
        message="Rozumiem, że to była trudna chwila. Opisałeś odczucia w ciele — to ważna wskazówka. Czy to co teraz czujesz bardziej przypomina strach przed czymś, czy złość na kogoś lub na sytuację?",
        stage="emotion_id",
    ),
    SessionStage.thought_excavation: ClaudeResponse(
        message="Dobrze, widzę te emocje. Chciałbym teraz zapytać o myśli które się wtedy pojawiły. Co dokładnie pomyślałeś w tamtej chwili — jaka była pierwsza myśl?",
        stage="thought_excavation",
    ),
    SessionStage.chain_challenging: ClaudeResponse(
        message="Słyszę tę myśl. Jakie masz dowody że tak właśnie jest? Czy zdarzało Ci się kiedyś coś co temu przeczy?",
        stage="chain_challenging",
    ),
}


def _build_system_prompt(
    session: EmotionSession,
    somatic_mappings: list[SomaticMapping],
    protocol,
    accumulated: dict,
) -> str:
    protocol_section = ""
    if protocol:
        approach = APPROACH_LABELS.get(protocol.approach, "CBT")
        intensity = INTENSITY_LABELS.get(protocol.challenge_intensity, "zrównoważone")
        focus = ", ".join(protocol.focus_areas) if protocol.focus_areas else "ogólne"
        protocol_section = f"""
KONFIGURACJA TERAPEUTY:
Podejście: {approach} | Styl: {intensity} | Fokus: {focus}
Kontekst: {protocol.patient_context or "brak"}
Instrukcje: {protocol.ai_instructions or "brak"}"""

    somatic_lines = ""
    if somatic_mappings:
        lines = [f"- {m.body_region}: {m.sensation} ({m.intensity}/10)" for m in somatic_mappings]
        somatic_lines = "ODCZUCIA W CIELE:\n" + "\n".join(lines)

    context_lines = ""
    parts = []
    if "identified_emotions" in accumulated:
        emotions = [
            f"{e.get('type')} ({e.get('intensity')}/10)"
            for e in accumulated["identified_emotions"]
        ]
        parts.append(f"Emocje: {', '.join(emotions)}")
    if "automatic_thought" in accumulated:
        parts.append(f"Myśl automatyczna: {accumulated['automatic_thought']}")
    if "core_belief" in accumulated:
        parts.append(f"Przekonanie podstawowe: {accumulated['core_belief']}")
    if parts:
        context_lines = "ZEBRANE DANE:\n" + "\n".join(parts)

    stage_instruction = STAGE_INSTRUCTIONS.get(session.current_stage, "")

    return f"""Jesteś asystentem terapeutycznym prowadzącym strukturyzowaną sesję emocjonalną po polsku.

SYTUACJA: {session.trigger_text}

{somatic_lines}

{context_lines}

{protocol_section}

{stage_instruction}

ZASADY:
- Jedno pytanie na raz
- Ciepły, obecny, bez oceniania
- Nie diagnozujesz
- Jeśli padną myśli samobójcze lub o samookaleczeniu: crisis=true

ODPOWIADASZ WYŁĄCZNIE W JSON (bez markdown):
{{"message": "...", "stage": "{session.current_stage.value}", "advance_stage": false, "crisis": false, "extracted_data": {{}}}}"""


async def get_claude_response(
    session: EmotionSession,
    messages: list[SessionMessage],
    somatic_mappings: list[SomaticMapping],
    protocol,
    accumulated: dict,
    user_message: str | None = None,
) -> ClaudeResponse:
    if not settings.anthropic_api_key:
        return _MOCK.get(session.current_stage, ClaudeResponse.fallback(session.current_stage.value))

    client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key)
    system_prompt = _build_system_prompt(session, somatic_mappings, protocol, accumulated)

    history = [{"role": m.role, "content": m.content} for m in messages]

    if user_message:
        history.append({"role": "user", "content": user_message})
    elif not history:
        history.append({"role": "user", "content": "Jestem gotowy, żeby porozmawiać."})

    try:
        response = await client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1024,
            system=system_prompt,
            messages=history,
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json").strip()
        return ClaudeResponse.from_dict(json.loads(raw))
    except (json.JSONDecodeError, KeyError, IndexError) as e:
        logger.warning("Claude JSON parse error: %s", e)
        return ClaudeResponse.fallback(session.current_stage.value)
    except Exception:
        logger.exception("Claude API error")
        raise
