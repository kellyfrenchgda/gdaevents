"""Generate a branded event run sheet PDF using ReportLab."""
import io
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
)

# ── GDA brand palette ────────────────────────────────────────────────────────
INK       = colors.HexColor("#0F2233")
AMBER     = colors.HexColor("#E9A21B")
AMBER_DPR = colors.HexColor("#C57B08")
PAPER     = colors.HexColor("#EDF1EC")
RULE      = colors.HexColor("#CFD9D2")
INK2      = colors.HexColor("#3E5768")
WHITE     = colors.white

BRAND_COLOURS = {
    "Gage Roads Brew Co":     "#0B4F8A",
    "Single Fin":             "#F5B301",
    "Matso's Broome Brewery": "#E2571F",
    "Atomic Beer Project":    "#D81E5B",
    "Alby":                   "#1E7A45",
    "Hello Sunshine":         "#00A39B",
    "Miller Chill":           "#B3122B",
    "Good Drinks (house)":    "#253746",
}


def _brand_colour(brand: str) -> colors.HexColor:
    return colors.HexColor(BRAND_COLOURS.get(brand, "#7A8F9C"))


def _fmt_time(iso: str) -> str:
    try:
        d = datetime.fromisoformat(iso)
        h, m = d.hour, d.minute
        ap = "pm" if h >= 12 else "am"
        h = h % 12 or 12
        return f"{h}:{m:02d}{ap}"
    except Exception:
        return "TBC"


def _fmt_date(iso: str) -> str:
    try:
        d = datetime.fromisoformat(iso)
        return d.strftime("%-d %B %Y")
    except Exception:
        return iso


def _fmt_full(iso: str) -> str:
    try:
        d = datetime.fromisoformat(iso)
        return d.strftime("%A %-d %B %Y, ") + _fmt_time(iso)
    except Exception:
        return iso


def build_runsheet(event: dict) -> bytes:
    """Return PDF bytes for the given event dict (including allocations list)."""
    buf = io.BytesIO()
    W, H = A4
    margin = 18 * mm

    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=22 * mm,
        bottomMargin=18 * mm,
        title=f"Run Sheet — {event.get('name', 'Event')}",
        author="Good Drinks Australia",
    )

    brand       = event.get("brand", "")
    brand_col   = _brand_colour(brand)
    is_general  = event.get("type") == "general"
    allocations = event.get("allocations", [])
    capacity    = int(event.get("capacity") or 0)
    allocated   = sum(int(a.get("seats") or 0) for a in allocations)
    remaining   = max(0, capacity - allocated)

    base  = getSampleStyleSheet()
    story = []

    # ── header stripe ────────────────────────────────────────────────────────
    # Drawn via a single-cell table so we get a background colour block
    header_title = event.get("team") or event.get("name") if not is_general else event.get("name", "")
    sub_line = ""
    if not is_general:
        opp = event.get("opponent", "")
        sub_line = f"v {opp}" if opp else ""

    hdr_style = ParagraphStyle("hdr", fontName="Helvetica-Bold", fontSize=22,
                               textColor=WHITE, leading=26, spaceAfter=2)
    sub_style = ParagraphStyle("sub", fontName="Helvetica", fontSize=11,
                               textColor=colors.HexColor("#C8D8E4"), leading=14)
    eyebrow   = ParagraphStyle("eye", fontName="Helvetica", fontSize=8,
                               textColor=AMBER, leading=10, spaceAfter=4,
                               letterSpacing=1.5)

    hdr_content = [
        Paragraph("GOOD DRINKS AUSTRALIA · EVENT RUN SHEET", eyebrow),
        Paragraph(header_title, hdr_style),
    ]
    if sub_line:
        hdr_content.append(Paragraph(sub_line, sub_style))

    hdr_table = Table([[hdr_content]], colWidths=[W - 2 * margin])
    hdr_table.setStyle(TableStyle([
        ("BACKGROUND",  (0, 0), (-1, -1), INK),
        ("LEFTPADDING",  (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING",   (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 14),
        ("LINEBELOW",    (0, 0), (-1, -1), 3, brand_col),
    ]))
    story.append(hdr_table)
    story.append(Spacer(1, 5 * mm))

    # ── key details grid ─────────────────────────────────────────────────────
    key_label = ParagraphStyle("kl", fontName="Helvetica-Bold", fontSize=7,
                               textColor=INK2, leading=9, letterSpacing=1.2)
    key_val   = ParagraphStyle("kv", fontName="Helvetica", fontSize=11,
                               textColor=INK, leading=14)
    key_val_b = ParagraphStyle("kvb", fontName="Helvetica-Bold", fontSize=11,
                               textColor=INK, leading=14)

    def krow(label, value, bold=False):
        st = key_val_b if bold else key_val
        return [Paragraph(label.upper(), key_label), Paragraph(str(value), st)]

    details = [
        krow("Date & time", _fmt_full(event.get("start", ""))),
        krow("Venue", event.get("venue") or "—"),
        krow("State", event.get("state") or "—"),
    ]
    if not is_general:
        details.append(krow("Sport", event.get("sport") or "—"))
        details.append(krow("Team", event.get("team") or "—"))
        if event.get("opponent"):
            details.append(krow("Opponent", event["opponent"]))
    details.append(krow("Major brand", brand or "—", bold=True))

    det_table = Table(details, colWidths=[40 * mm, W - 2 * margin - 40 * mm])
    det_table.setStyle(TableStyle([
        ("VALIGN",       (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",   (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("LINEBELOW",    (0, 0), (-1, -1), 0.5, RULE),
    ]))
    story.append(det_table)
    story.append(Spacer(1, 5 * mm))

    # ── seat summary bar ─────────────────────────────────────────────────────
    seat_style = ParagraphStyle("seat", fontName="Helvetica-Bold", fontSize=26,
                                textColor=INK, leading=28)
    seat_cap   = ParagraphStyle("sc",  fontName="Helvetica", fontSize=9,
                                textColor=INK2, leading=11)

    def seat_cell(number, label):
        return [Paragraph(str(number), seat_style), Paragraph(label, seat_cap)]

    remaining_col = colors.HexColor("#D2442F") if remaining == 0 else (
                    colors.HexColor("#C57B08") if capacity and remaining / capacity <= 0.25 else INK)
    seat_style_r = ParagraphStyle("seatr", parent=seat_style, textColor=remaining_col)

    seat_table = Table(
        [[seat_cell(capacity, "TOTAL CAPACITY"),
          seat_cell(allocated, "ALLOCATED"),
          [Paragraph(str(remaining), seat_style_r), Paragraph("REMAINING", seat_cap)]]],
        colWidths=[(W - 2 * margin) / 3] * 3
    )
    seat_table.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, -1), PAPER),
        ("TOPPADDING",   (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 10),
        ("LEFTPADDING",  (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("LINEBEFORE",   (1, 0), (2, 0),   0.5, RULE),
        ("BOX",          (0, 0), (-1, -1), 0.5, RULE),
    ]))
    story.append(seat_table)
    story.append(Spacer(1, 6 * mm))

    # ── notes ────────────────────────────────────────────────────────────────
    if event.get("notes"):
        note_hdr = ParagraphStyle("nh", fontName="Helvetica-Bold", fontSize=9,
                                  textColor=INK, letterSpacing=1.2, spaceAfter=3)
        note_body = ParagraphStyle("nb", fontName="Helvetica", fontSize=10,
                                   textColor=INK, leading=14)
        story.append(Paragraph("NOTES", note_hdr))
        story.append(Paragraph(event["notes"], note_body))
        story.append(Spacer(1, 5 * mm))

    # ── allocations table ────────────────────────────────────────────────────
    alloc_hdr = ParagraphStyle("ah", fontName="Helvetica-Bold", fontSize=9,
                               textColor=INK, letterSpacing=1.2, spaceAfter=4)
    story.append(Paragraph(f"GUEST ALLOCATIONS  ({allocated} of {capacity} seats)", alloc_hdr))

    col_hdr = ParagraphStyle("ch", fontName="Helvetica-Bold", fontSize=8,
                             textColor=INK2, letterSpacing=0.8)
    cell_nm  = ParagraphStyle("cn", fontName="Helvetica-Bold", fontSize=10, textColor=INK, leading=13)
    cell_org = ParagraphStyle("co", fontName="Helvetica",      fontSize=9,  textColor=INK2, leading=12)
    cell_note= ParagraphStyle("ck", fontName="Helvetica",      fontSize=8,  textColor=INK2, leading=11)
    cell_num = ParagraphStyle("cs", fontName="Helvetica-Bold", fontSize=13, textColor=INK, leading=15)
    cell_st  = ParagraphStyle("ct", fontName="Helvetica",      fontSize=8,  leading=10)

    col_w = W - 2 * margin
    col_widths = [col_w * 0.38, col_w * 0.30, col_w * 0.16, col_w * 0.10, col_w * 0.06]

    tdata = [[
        Paragraph("GUEST", col_hdr),
        Paragraph("COMPANY / NOTE", col_hdr),
        Paragraph("STATUS", col_hdr),
        Paragraph("SEATS", col_hdr),
        Paragraph("", col_hdr),   # sign-off column
    ]]

    row_styles = [
        ("BACKGROUND",   (0, 0), (-1,  0), INK),
        ("TEXTCOLOR",    (0, 0), (-1,  0), WHITE),
        ("FONTNAME",     (0, 0), (-1,  0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1,  0), 8),
        ("TOPPADDING",   (0, 0), (-1,  0), 7),
        ("BOTTOMPADDING",(0, 0), (-1,  0), 7),
        ("LEFTPADDING",  (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("VALIGN",       (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [WHITE, colors.HexColor("#F4F7F4")]),
        ("LINEBELOW",    (0, 0), (-1, -1), 0.5, RULE),
        ("BOX",          (0, 0), (-1, -1), 0.5, RULE),
        ("GRID",         (0, 0), (-1, -1), 0.3, RULE),
    ]

    if allocations:
        for i, a in enumerate(allocations):
            status  = (a.get("status") or "confirmed").capitalize()
            st_col  = colors.HexColor("#0A6E63") if status == "Confirmed" else colors.HexColor("#C57B08")
            note    = a.get("note") or ""
            org     = a.get("org") or ""
            guest_content = [Paragraph(a.get("name", ""), cell_nm)]
            if org:
                guest_content.append(Paragraph(org, cell_org))
            org_note = note if note else "—"
            tdata.append([
                guest_content,
                Paragraph(org_note, cell_note),
                Paragraph(status, ParagraphStyle("st", parent=cell_st, textColor=st_col, fontName="Helvetica-Bold")),
                Paragraph(str(int(a.get("seats") or 0)), cell_num),
                Paragraph("□", ParagraphStyle("cb", fontName="Helvetica", fontSize=14, textColor=RULE)),
            ])
    else:
        tdata.append([
            Paragraph("No seats allocated yet.", cell_org),
            "", "", "", ""
        ])

    alloc_table = Table(tdata, colWidths=col_widths, repeatRows=1)
    alloc_table.setStyle(TableStyle(row_styles))
    story.append(alloc_table)
    story.append(Spacer(1, 6 * mm))

    # ── sign-off / on-the-night section ──────────────────────────────────────
    story.append(HRFlowable(width="100%", thickness=0.5, color=RULE))
    story.append(Spacer(1, 3 * mm))

    sof_label = ParagraphStyle("sfl", fontName="Helvetica-Bold", fontSize=9,
                               textColor=INK, letterSpacing=1.2, spaceAfter=4)
    sof_line  = ParagraphStyle("sfv", fontName="Helvetica", fontSize=10, textColor=INK, leading=22)

    story.append(Paragraph("ON THE NIGHT", sof_label))
    signoff_rows = [
        ["Host / rep on the night:", ""],
        ["Guest arrival time:", ""],
        ["Suite / location:", ""],
        ["Catering arranged:", "   Yes  /  No"],
    ]
    sof_table = Table(
        [[Paragraph(r[0], sof_line), Paragraph(r[1], sof_line)] for r in signoff_rows],
        colWidths=[60 * mm, col_w - 60 * mm]
    )
    sof_table.setStyle(TableStyle([
        ("LEFTPADDING",  (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING",   (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 0),
        ("LINEBELOW",    (1, 0), (1, -1),  0.5, RULE),
        ("VALIGN",       (0, 0), (-1, -1), "BOTTOM"),
    ]))
    story.append(sof_table)

    # ── footer ───────────────────────────────────────────────────────────────
    generated = datetime.now(timezone.utc).strftime("%-d %B %Y")
    footer_st = ParagraphStyle("ft", fontName="Helvetica", fontSize=7,
                               textColor=colors.HexColor("#8FA6B3"), leading=9)
    story.append(Spacer(1, 6 * mm))
    story.append(HRFlowable(width="100%", thickness=0.5, color=RULE))
    story.append(Spacer(1, 2 * mm))
    story.append(Paragraph(
        f"Good Drinks Australia · Confidential · Generated {generated}",
        footer_st
    ))

    doc.build(story)
    return buf.getvalue()
