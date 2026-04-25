import enum


class UserRole(str, enum.Enum):
    admin = "admin"
    therapist = "therapist"
    patient = "patient"
