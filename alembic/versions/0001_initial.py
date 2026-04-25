"""Pełny schemat PostgreSQL — jedyna migracja (sesje emocjonalne, Daily, limity LLM).

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-24

Czyszczenie: ``alembic downgrade base``. Nowa baza: ``alembic upgrade head``.

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CRISIS_DEFAULT = (
    "Słyszę, że jest Ci teraz bardzo ciężko. "
    "Proszę, zadzwoń na Telefon Zaufania: 116 123 (czynny całą dobę) "
    "lub napisz do swojego terapeuty."
)


def upgrade() -> None:
    op.execute("CREATE TYPE userrole AS ENUM ('admin', 'therapist', 'patient')")
    op.execute(
        "CREATE TYPE sessionstatus AS ENUM ('in_progress', 'completed', 'crisis')"
    )
    op.execute(
        "CREATE TYPE sessionstage AS ENUM ("
        "'somatic', 'emotion_id', 'thought_excavation', 'chain_challenging', "
        "'closing', 'completed')"
    )
    op.execute(
        "CREATE TYPE therapyapproach AS ENUM "
        "('cbt', 'act', 'dbt', 'psychodynamic', 'mixed')"
    )
    op.execute(
        "CREATE TYPE challengeintensity AS ENUM ('gentle', 'moderate', 'confrontational')"
    )
    op.execute(
        "CREATE TYPE dailycheckinsessionstatus AS ENUM ('in_progress', 'completed')"
    )

    userrole = postgresql.ENUM(
        "admin", "therapist", "patient", name="userrole", create_type=False
    )
    sessionstatus = postgresql.ENUM(
        "in_progress", "completed", "crisis", name="sessionstatus", create_type=False
    )
    sessionstage = postgresql.ENUM(
        "somatic",
        "emotion_id",
        "thought_excavation",
        "chain_challenging",
        "closing",
        "completed",
        name="sessionstage",
        create_type=False,
    )
    therapyapproach = postgresql.ENUM(
        "cbt",
        "act",
        "dbt",
        "psychodynamic",
        "mixed",
        name="therapyapproach",
        create_type=False,
    )
    challengeintensity = postgresql.ENUM(
        "gentle",
        "moderate",
        "confrontational",
        name="challengeintensity",
        create_type=False,
    )
    dailystatus = postgresql.ENUM(
        "in_progress",
        "completed",
        name="dailycheckinsessionstatus",
        create_type=False,
    )

    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", userrole, nullable=False),
        sa.Column("first_name", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(100), nullable=True),
        sa.Column("professional_title", sa.String(100), nullable=True),
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("gdpr_consent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("last_login", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "llm_token_limit",
            sa.Integer(),
            nullable=False,
            server_default=sa.text("25000"),
        ),
        sa.Column(
            "llm_tokens_input_total",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
        sa.Column(
            "llm_tokens_output_total",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
    )
    op.create_index(op.f("ix_users_email"), "users", ["email"], unique=True)

    op.create_table(
        "invitations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("token", sa.String(255), nullable=False),
        sa.Column("therapist_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("patient_name_hint", sa.String(100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_patient_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.ForeignKeyConstraint(["therapist_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_patient_id"], ["users.id"]),
    )
    op.create_index(op.f("ix_invitations_token"), "invitations", ["token"], unique=True)

    op.create_table(
        "treatment_protocols",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("therapist_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "approach",
            therapyapproach,
            nullable=False,
            server_default=sa.text("'cbt'::therapyapproach"),
        ),
        sa.Column(
            "focus_areas",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("patient_context", sa.String(500), nullable=False, server_default=""),
        sa.Column("ai_instructions", sa.String(1000), nullable=False, server_default=""),
        sa.Column(
            "challenge_intensity",
            challengeintensity,
            nullable=False,
            server_default=sa.text("'moderate'::challengeintensity"),
        ),
        sa.Column("somatic_focus", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "max_session_length",
            sa.Integer(),
            nullable=False,
            server_default="30",
        ),
        sa.Column(
            "crisis_protocol",
            sa.Text(),
            nullable=False,
            server_default=sa.text("'" + _CRISIS_DEFAULT.replace("'", "''") + "'"),
        ),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["patient_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["therapist_id"], ["users.id"]),
    )
    op.create_index(
        op.f("ix_treatment_protocols_patient_id"),
        "treatment_protocols",
        ["patient_id"],
        unique=False,
    )

    op.create_table(
        "patient_daily_questions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("therapist_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("questions", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["patient_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["therapist_id"], ["users.id"]),
        sa.UniqueConstraint("patient_id", name="uq_patient_daily_questions_patient"),
    )
    op.create_index(
        "ix_patient_daily_questions_patient_id",
        "patient_daily_questions",
        ["patient_id"],
        unique=False,
    )

    op.create_table(
        "emotion_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "status",
            sessionstatus,
            nullable=False,
            server_default=sa.text("'in_progress'::sessionstatus"),
        ),
        sa.Column(
            "current_stage",
            sessionstage,
            nullable=False,
            server_default=sa.text("'somatic'::sessionstage"),
        ),
        sa.Column("trigger_text", sa.Text(), nullable=False),
        sa.Column("wellbeing_before", sa.Integer(), nullable=False),
        sa.Column("wellbeing_after", sa.Integer(), nullable=True),
        sa.Column("ai_summary", sa.Text(), nullable=True),
        sa.Column("patient_facing_analysis", sa.Text(), nullable=True),
        sa.Column("crisis_flag", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["users.id"]),
    )
    op.create_index(
        op.f("ix_emotion_sessions_patient_id"),
        "emotion_sessions",
        ["patient_id"],
        unique=False,
    )

    op.create_table(
        "daily_checkin_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("patient_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            "questions_snapshot",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "answers",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column(
            "status",
            dailystatus,
            nullable=False,
            server_default=sa.text("'in_progress'::dailycheckinsessionstatus"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["patient_id"], ["users.id"]),
    )
    op.create_index(
        "ix_daily_checkin_sessions_patient_id",
        "daily_checkin_sessions",
        ["patient_id"],
        unique=False,
    )

    op.create_table(
        "somatic_mappings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("body_region", sa.String(50), nullable=False),
        sa.Column("sensation", sa.String(200), nullable=False),
        sa.Column("intensity", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["session_id"], ["emotion_sessions.id"]),
    )
    op.create_index(
        op.f("ix_somatic_mappings_session_id"),
        "somatic_mappings",
        ["session_id"],
        unique=False,
    )

    op.create_table(
        "session_messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("session_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("role", sa.String(10), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("stage", sa.String(30), nullable=False),
        sa.Column(
            "extracted_data",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.ForeignKeyConstraint(["session_id"], ["emotion_sessions.id"]),
    )
    op.create_index(
        op.f("ix_session_messages_session_id"),
        "session_messages",
        ["session_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_session_messages_session_id"), table_name="session_messages")
    op.drop_table("session_messages")
    op.drop_index(op.f("ix_somatic_mappings_session_id"), table_name="somatic_mappings")
    op.drop_table("somatic_mappings")
    op.drop_index("ix_daily_checkin_sessions_patient_id", table_name="daily_checkin_sessions")
    op.drop_table("daily_checkin_sessions")
    op.drop_index(op.f("ix_emotion_sessions_patient_id"), table_name="emotion_sessions")
    op.drop_table("emotion_sessions")
    op.drop_index("ix_patient_daily_questions_patient_id", table_name="patient_daily_questions")
    op.drop_table("patient_daily_questions")
    op.drop_index(
        op.f("ix_treatment_protocols_patient_id"), table_name="treatment_protocols"
    )
    op.drop_table("treatment_protocols")
    op.drop_index(op.f("ix_invitations_token"), table_name="invitations")
    op.drop_table("invitations")
    op.drop_index(op.f("ix_users_email"), table_name="users")
    op.drop_table("users")

    op.execute("DROP TYPE dailycheckinsessionstatus")
    op.execute("DROP TYPE challengeintensity")
    op.execute("DROP TYPE therapyapproach")
    op.execute("DROP TYPE sessionstage")
    op.execute("DROP TYPE sessionstatus")
    op.execute("DROP TYPE userrole")
