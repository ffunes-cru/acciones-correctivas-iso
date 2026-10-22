"""Pure approval rules (ported from SpecialReleaseDetails.tsx / ChangeRequestDetails.tsx)."""

SPECIAL_RELEASE_AREAS = ("calidad", "ingenieria", "comercial", "operaciones")


def special_release_status(rows, posventa_confirmed):
    """rows: iterable of (state, excluded) for the four areas. Returns pending_approval|approved|rejected.

    Any non-excluded rejection rejects at once; otherwise approved only when every non-excluded area has
    evaluated AND Posventa confirmed receipt.
    """
    active = [state for state, excluded in rows if not excluded]
    if any(state == "rejected" for state in active):
        return "rejected"
    if all(state != "pending" for state in active) and posventa_confirmed:
        return "approved"
    return "pending_approval"


def change_request_status_after_review(current, reviews):
    """reviews: iterable of (applies, state). Any applicable rejection rejects; all applicable approved
    advances to final approval. With no applicable review the status is kept (the legacy `every()` on an
    empty list advanced it; sending requires at least one applicable area anyway)."""
    active = [state for applies, state in reviews if applies]
    if not active:
        return current
    if any(state == "rejected" for state in active):
        return "rejected"
    if all(state == "approved" for state in active):
        return "pending_approval"
    return current
