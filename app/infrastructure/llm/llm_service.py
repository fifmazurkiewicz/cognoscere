import json
import logging
import re
from dataclasses import dataclass, field

from openai import AsyncOpenAI

from app.infrastructure.config import llm_configured, settings
from app.infrastructure.persistence.session import EmotionSession, SessionMessage, SessionStage, SomaticMapping

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
WAŻNE — advance_stage: Ustaw advance_stage=true po 3–4 sensownych wymianach LUB gdy pacjent podał wyraźną myśl automatyczną i da się sformułować twarde przekonanie (nie czekaj na „idealny” łańcuch).
intermediate_belief może być krótkim mostkiem lub powtórzeniem myśli, jeśli pacjent nie rozróżnia warstw.
Zawsze zwróć poprawny JSON (nigdy pustej odpowiedzi).
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
class AssistantTurnPayload:
    message: str
    stage: str
    advance_stage: bool = False
    crisis: bool = False
    extracted_data: dict = field(default_factory=dict)

    @classmethod
    def from_dict(cls, data: dict) -> "AssistantTurnPayload":
        return cls(
            message=str(data.get("message", "")),
            stage=str(data.get("stage", "emotion_id")),
            advance_stage=bool(data.get("advance_stage", False)),
            crisis=bool(data.get("crisis", False)),
            extracted_data=data.get("extracted_data", {}) or {},
        )

    @classmethod
    def fallback(cls, stage: str) -> "AssistantTurnPayload":
        return cls(
            message="Przepraszam, wystąpił chwilowy problem techniczny. Czy możesz powtórzyć?",
            stage=stage,
        )


@dataclass
class AssistantTurnResult:
    payload: AssistantTurnPayload
    input_tokens: int
    output_tokens: int


_MOCK: dict[SessionStage, AssistantTurnPayload] = {
    SessionStage.emotion_id: AssistantTurnPayload(
        message="Rozumiem, że to była trudna chwila. Opisałeś odczucia w ciele — to ważna wskazówka. Czy to co teraz czujesz bardziej przypomina strach przed czymś, czy złość na kogoś lub na sytuację?",
        stage="emotion_id",
    ),
    SessionStage.thought_excavation: AssistantTurnPayload(
        message="Dobrze, widzę te emocje. Chciałbym teraz zapytać o myśli które się wtedy pojawiły. Co dokładnie pomyślałeś w tamtej chwili — jaka była pierwsza myśl?",
        stage="thought_excavation",
    ),
    SessionStage.chain_challenging: AssistantTurnPayload(
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
- Pisz wyłącznie poprawną polszczyzną: naturalna składnia, zgodna z zasadami gramatyki i ortografii, polskie słownictwo (unikaj niepotrzebnych anglicyzmów i kalk z angielskiego), stosuj polskie znaki diakrytyczne tam, gdzie to norma (ą, ę, ó, ś, ć, ń, ż, ź).
- Stosuj prosty, potoczny język: zwykłe słowa, krótkie i jasne zdania, bez żargonu terapeutycznego i zbędnej terminologii naukowej — chyba że pacjent sam z niej korzysta; wtedy możesz się do niej odnieść, ale wyjaśniaj przystępnie.
- Jedno pytanie na raz (albo jedno krótkie zaproszenie do podzielenia się)
- ZAWSZE kończ pole `message` tak, by pacjent miał naturalną zachętę do odpowiedzi: konkretne pytanie albo miękkie wezwanie („Jak to u Ciebie brzmi?”, „Co czujesz przy tym?”). Nie kończ na suchym stwierdzeniu ani monologu bez wejścia dla użytkownika.
- Ciepły, obecny, bez oceniania
- Nie diagnozujesz
- Jeśli padną myśli samobójcze lub o samookaleczeniu: crisis=true — wtedy też, jeśli to bezpieczne, zostaw krótkie pytanie lub zaproszenie do kontaktu z kimś bliskim / pomocą

ODPOWIADASZ WYŁĄCZNIE W JSON (bez markdown). W polu `message` musi być pełna wypowiedź z końcową zachętą do wypowiedzi:
{{"message": "...", "stage": "{session.current_stage.value}", "advance_stage": false, "crisis": false, "extracted_data": {{}}}}"""


def _openrouter_client() -> AsyncOpenAI:
    referer = (settings.openrouter_http_referer or settings.frontend_url or "http://localhost:3000").strip()
    return AsyncOpenAI(
        api_key=(settings.openrouter_api_key or "").strip(),
        base_url=settings.openrouter_base_url.rstrip("/"),
        default_headers={
            "HTTP-Referer": referer,
            "X-Title": (settings.openrouter_app_title or "Cognoscere").strip(),
        },
    )


def _openrouter_extra_body() -> dict[str, object] | None:
    raw = (settings.openrouter_provider_order or "").strip()
    if not raw:
        return None
    order = [p.strip() for p in raw.split(",") if p.strip()]
    if not order:
        return None
    return {"provider": {"order": order}}


async def _openrouter_chat(
    *,
    system: str,
    user_assistant_messages: list[dict[str, str]],
    max_tokens: int,
    response_format: dict[str, str] | None = None,
) -> tuple[str, int, int, str | None]:
    client = _openrouter_client()
    extra = _openrouter_extra_body()
    kwargs: dict = {
        "model": settings.openrouter_model,
        "messages": [{"role": "system", "content": system}, *user_assistant_messages],
        "max_tokens": max_tokens,
    }
    if response_format is not None:
        kwargs["response_format"] = response_format
    if extra:
        kwargs["extra_body"] = extra
    response = await client.chat.completions.create(**kwargs)
    choice = response.choices[0]
    msg = choice.message
    text = (msg.content or "").strip()
    refusal = getattr(msg, "refusal", None)
    if refusal:
        logger.warning("LLM odmówił odpowiedzi: %s", refusal)
    usage = response.usage
    in_tok = int(getattr(usage, "prompt_tokens", 0) or 0) if usage else 0
    out_tok = int(getattr(usage, "completion_tokens", 0) or 0) if usage else 0
    finish = getattr(choice, "finish_reason", None)
    return text, in_tok, out_tok, finish


def _strip_markdown_json_fence(raw: str) -> str:
    s = raw.strip()
    if s.startswith("```"):
        parts = s.split("```")
        if len(parts) >= 2:
            inner = parts[1].lstrip()
            if inner.lower().startswith("json"):
                inner = inner[4:].lstrip()
            return inner.strip()
    return s


def _coerce_llm_json_dict(raw: str) -> dict | None:
    """Parsuje JSON z odpowiedzi modelu; akceptuje opcjonalny fence ``` oraz tekst wokół obiektu."""
    s = _strip_markdown_json_fence(raw)
    if not s:
        return None
    try:
        out = json.loads(s)
        return out if isinstance(out, dict) else None
    except json.JSONDecodeError:
        pass
    m = re.search(r"\{[\s\S]*\}", s)
    if m:
        try:
            out = json.loads(m.group(0))
            return out if isinstance(out, dict) else None
        except json.JSONDecodeError:
            return None
    return None


async def get_session_assistant_turn(
    session: EmotionSession,
    messages: list[SessionMessage],
    somatic_mappings: list[SomaticMapping],
    protocol,
    accumulated: dict,
    user_message: str | None = None,
) -> AssistantTurnResult:
    if not llm_configured():
        mock = _MOCK.get(session.current_stage, AssistantTurnPayload.fallback(session.current_stage.value))
        return AssistantTurnResult(mock, 0, 0)

    system_prompt = _build_system_prompt(session, somatic_mappings, protocol, accumulated)

    history = [{"role": m.role, "content": m.content} for m in messages]

    if user_message:
        history.append({"role": "user", "content": user_message})
    elif not history:
        history.append({"role": "user", "content": "Jestem gotowy, żeby porozmawiać."})

    json_mode: dict[str, str] | None = {"type": "json_object"}
    last_finish: str | None = None
    try:
        raw = ""
        total_in = total_out = 0
        for attempt in range(2):
            raw, in_tok, out_tok, last_finish = await _openrouter_chat(
                system=system_prompt,
                user_assistant_messages=history,
                max_tokens=1024,
                response_format=json_mode if attempt == 0 else None,
            )
            total_in += in_tok
            total_out += out_tok
            if raw:
                break
            logger.warning(
                "LLM zwrócił pustą treść (finish_reason=%s, próba %s/2)%s",
                last_finish,
                attempt + 1,
                "; ponawiam bez wymuszania JSON" if attempt == 0 else "",
            )

        parsed = _coerce_llm_json_dict(raw)
        if parsed is None:
            preview = (raw[:400] + "…") if len(raw) > 400 else raw
            logger.warning(
                "LLM JSON parse error: niepoprawny lub pusty JSON (finish_reason=%s, len=%s, preview=%r)",
                last_finish,
                len(raw),
                preview,
            )
            fb = AssistantTurnPayload.fallback(session.current_stage.value)
            return AssistantTurnResult(fb, total_in, total_out)

        return AssistantTurnResult(
            AssistantTurnPayload.from_dict(parsed), total_in, total_out
        )
    except (KeyError, TypeError) as e:
        logger.warning("LLM payload error: %s", e)
        fb = AssistantTurnPayload.fallback(session.current_stage.value)
        return AssistantTurnResult(fb, 0, 0)
    except Exception:
        logger.exception("LLM API error")
        raise


def _build_local_patient_analysis(
    session: EmotionSession,
    messages: list[SessionMessage],
    somatic_mappings: list[SomaticMapping],
    accumulated: dict,
) -> str:
    parts: list[str] = []
    parts.append(
        "Poniżej znajduje się zestawienie zapisów z sesji (tryb lokalny — bez wywołania modelu AI w chmurze)."
    )
    parts.append("")
    parts.append(f"Opisana sytuacja: {session.trigger_text}")
    after = session.wellbeing_after
    parts.append(
        f"Samopoczucie przed sesją: {session.wellbeing_before}/10"
        + (f", po sesji: {after}/10" if after is not None else "")
    )
    if somatic_mappings:
        parts.append("")
        parts.append("Odczucia w ciele:")
        for m in somatic_mappings:
            parts.append(f"– {m.body_region}: {m.sensation} (intensywność {m.intensity}/10)")
    if accumulated:
        parts.append("")
        parts.append("Dane zebrane w kolejnych etapach rozmowy:")
        parts.append(json.dumps(accumulated, ensure_ascii=False, indent=2))
    if session.ai_summary:
        parts.append("")
        parts.append("Podsumowanie z etapu pracy z przekonaniami:")
        parts.append(session.ai_summary)
    parts.append("")
    parts.append("Przebieg rozmowy (skrót):")
    for m in messages:
        label = "Pacjent" if m.role == "user" else "Asystent"
        excerpt = m.content if len(m.content) <= 600 else m.content[:600] + "…"
        parts.append(f"– {label}: {excerpt}")
    return "\n".join(parts)


async def generate_patient_session_analysis(
    session: EmotionSession,
    messages: list[SessionMessage],
    somatic_mappings: list[SomaticMapping],
    accumulated: dict,
) -> tuple[str, int, int]:
    if not llm_configured():
        return _build_local_patient_analysis(session, messages, somatic_mappings, accumulated), 0, 0

    transcript = "\n".join(
        f"{'Pacjent' if m.role == 'user' else 'Asystent'}: {m.content}" for m in messages
    )
    if somatic_mappings:
        somatic_txt = "\n".join(
            f"- {m.body_region}: {m.sensation} ({m.intensity}/10)" for m in somatic_mappings
        )
    else:
        somatic_txt = "(brak zapisanych mapowań)"

    after = session.wellbeing_after if session.wellbeing_after is not None else "—"
    payload = f"""Materiał z sesji samopomocy (dialog z asystentem AI):

Sytuacja wyjściowa:
{session.trigger_text}

Samopoczucie: przed {session.wellbeing_before}/10, po (jeśli zapisano): {after}/10

Odczucia somatyczne:
{somatic_txt}

Dane zebrane w kolejnych etapach (JSON):
{json.dumps(accumulated, ensure_ascii=False)}

Krótkie podsumowanie z etapu podważania przekonań (jeśli było):
{session.ai_summary or "(brak)"}

Transkrypt rozmowy:
{transcript}

---

Napisz po polsku zwięzłą, ciepłą analizę DLA PACJENTA (2–5 akapitów zwykłego tekstu).
Wytłumacz prostym językiem, co udało się nazwać i jakie wzorce widać; dodaj jedną łagodną sugestię do przemyślenia po sesji.
Nie stawiaj diagnoz klinicznych, nie oceniaj moralnie. Same akapity — bez nagłówków i list markdown."""

    system = (
        "Piszesz wyłącznie po polsku, poprawną polszczyzną (gramatyka, ortografia, naturalne sformułowania, "
        "polskie znaki diakrytyczne tam, gdzie to norma). Prosty, zrozumiały język — krótkie zdania, bez "
        "żargonu, chyba że cytujesz pacjenta. Czytelnik to pacjent po sesji samopomocy — ton wspierający, "
        "konkretny i spokojny."
    )
    try:
        text, in_tok, out_tok, _finish = await _openrouter_chat(
            system=system,
            user_assistant_messages=[{"role": "user", "content": payload}],
            max_tokens=2048,
        )
        return text, in_tok, out_tok
    except Exception:
        logger.exception("LLM patient analysis error")
        return _build_local_patient_analysis(session, messages, somatic_mappings, accumulated), 0, 0
