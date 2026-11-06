"""
Builds the business case on the organisers' template. Numbers come from analytics/output, so re-running
the analysis and this script keeps them in step. Bundle prices match tests/unit/domain/pricing.

Usage: python docs/business-case/build_deck.py <base.pptx> <output.pptx>
<base.pptx> is the template with slide 2 duplicated so it holds 10 slides.
"""
import json
import sys
from pathlib import Path

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.dml.color import RGBColor
from pptx.enum.chart import XL_CHART_TYPE, XL_LABEL_POSITION, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.util import Inches, Pt

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "analytics" / "output"
baseline = json.loads((OUTPUT / "baseline.json").read_text(encoding="utf-8"))
impact = json.loads((OUTPUT / "impact_model.json").read_text(encoding="utf-8"))
propensity = json.loads((OUTPUT / "propensity.json").read_text(encoding="utf-8"))
signals = json.loads((OUTPUT / "signals.json").read_text(encoding="utf-8"))

RED = RGBColor(0xE4, 0x00, 0x00)
INK = RGBColor(0x1B, 0x1B, 0x1B)
MUTED = RGBColor(0x5A, 0x5A, 0x5A)
TINT = RGBColor(0xFF, 0xF1, 0xF1)
GREY_FILL = RGBColor(0xF5, 0xF5, 0xF5)
BAR_GREY = RGBColor(0xBD, 0xBD, 0xBD)
LINE = RGBColor(0xE3, 0xE3, 0xE3)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)
FONT = "Arial"
SOURCE = "smb_leads.csv, Apr-Jun 2026 (synthetic)"


def inr(value):
    """Indian digit grouping, such as Rs 28,080 or Rs 1,23,456."""
    digits = str(round(value))
    if len(digits) > 3:
        head, tail = digits[:-3], digits[-3:]
        groups = []
        while len(head) > 2:
            groups.insert(0, head[-2:])
            head = head[:-2]
        groups.insert(0, head)
        digits = ",".join(groups) + "," + tail
    return f"₹{digits}"


def lakh(value):
    return f"₹{value / 100000:.1f} lakh"


def write(slide, x, y, w, h, runs, size=12, color=INK, bold=False, align=PP_ALIGN.LEFT, anchor=MSO_ANCHOR.TOP, name=None):
    """Adds a text box. runs is a string, or a list of paragraphs, each a string or list of (text, options)."""
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    if name:
        box.name = name
    fill_text(box.text_frame, runs, size, color, bold, align, anchor)
    return box


def fill_text(frame, runs, size, color, bold, align, anchor, margin=0.0):
    frame.word_wrap = True
    frame.vertical_anchor = anchor
    frame.margin_left = frame.margin_right = Inches(margin)
    frame.margin_top = frame.margin_bottom = Inches(margin / 2)
    paragraphs = [runs] if isinstance(runs, str) else runs
    for index, paragraph in enumerate(paragraphs):
        p = frame.paragraphs[0] if index == 0 else frame.add_paragraph()
        p.alignment = align
        if index:
            p.space_before = Pt(4)
        parts = [(paragraph, {})] if isinstance(paragraph, str) else paragraph
        for text, options in parts:
            run = p.add_run()
            run.text = text
            run.font.name = FONT
            run.font.size = Pt(options.get("size", size))
            run.font.bold = options.get("bold", bold)
            run.font.color.rgb = options.get("color", color)


def title(slide, text):
    write(slide, 0.5, 0.68, 9.0, 0.72, text, size=20, bold=True, anchor=MSO_ANCHOR.TOP, name="Title")


def source(slide, text):
    write(slide, 0.5, 5.1, 7.6, 0.22, text, size=8, color=MUTED, name="Source")


def card(slide, x, y, w, h, fill=GREY_FILL, name=None):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.adjustments[0] = 0.06
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill
    shape.line.fill.background()
    shape.shadow.inherit = False
    if name:
        shape.name = name
    return shape


def card_text(slide, x, y, w, h, runs, fill=GREY_FILL, size=11, color=INK, anchor=MSO_ANCHOR.MIDDLE, align=PP_ALIGN.LEFT, name=None):
    shape = card(slide, x, y, w, h, fill, name)
    fill_text(shape.text_frame, runs, size, color, False, align, anchor, margin=0.1)
    return shape


def stat(slide, x, y, w, h, number, label, fill=GREY_FILL, number_color=RED):
    card_text(
        slide, x, y, w, h,
        [[(number, {"size": 18, "bold": True, "color": number_color})], [(label, {"size": 9, "color": MUTED})]],
        fill=fill,
        name=f"Stat: {label}",
    )


def table(slide, x, y, w, rows, widths, row_height=0.34, size=10, header_size=10, highlight=(), name="Table"):
    frame = slide.shapes.add_table(len(rows), len(rows[0]), Inches(x), Inches(y), Inches(w), Inches(row_height * len(rows)))
    frame.name = name
    grid = frame.table
    for column, width in enumerate(widths):
        grid.columns[column].width = Inches(width)
    for r, row in enumerate(rows):
        grid.rows[r].height = Inches(row_height)
        for c, value in enumerate(row):
            cell = grid.cell(r, c)
            cell.fill.solid()
            cell.fill.fore_color.rgb = INK if r == 0 else (TINT if r in highlight else WHITE if r % 2 else GREY_FILL)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.margin_left = cell.margin_right = Inches(0.06)
            cell.margin_top = cell.margin_bottom = Inches(0.025)
            fill_text(cell.text_frame, str(value), header_size if r == 0 else size, WHITE if r == 0 else INK, r == 0, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
            cell.text_frame.margin_left = cell.text_frame.margin_right = Inches(0.06)
    return grid


def bar_chart(slide, x, y, w, h, categories, series, heading, kind=XL_CHART_TYPE.BAR_CLUSTERED, number_format="#,##0", highlight=None, colors=None, legend=False, descr=""):
    data = CategoryChartData()
    data.categories = categories
    for name, values in series:
        data.add_series(name, values)
    frame = slide.shapes.add_chart(kind, Inches(x), Inches(y), Inches(w), Inches(h), data)
    frame.name = heading
    frame._element.nvGraphicFramePr.cNvPr.set("descr", descr or heading)
    chart = frame.chart
    chart.font.name = FONT
    chart.font.size = Pt(9)
    chart.font.color.rgb = INK
    chart.has_title = True
    chart.chart_title.text_frame.text = heading
    run = chart.chart_title.text_frame.paragraphs[0].runs[0]
    run.font.size = Pt(10)
    run.font.bold = True
    run.font.name = FONT
    chart.has_legend = legend
    if legend:
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False
    axis = chart.category_axis
    axis.reverse_order = True
    axis.has_major_gridlines = False
    axis.format.line.color.rgb = LINE
    axis.tick_labels.font.size = Pt(9)
    value_axis = chart.value_axis
    value_axis.visible = False
    value_axis.has_major_gridlines = False
    value_axis.minimum_scale = 0
    plot = chart.plots[0]
    plot.gap_width = 45
    plot.overlap = -5 if len(series) > 1 else 0
    plot.has_data_labels = True
    labels = plot.data_labels
    labels.number_format = number_format
    labels.number_format_is_linked = False
    labels.position = XL_LABEL_POSITION.OUTSIDE_END
    labels.font.size = Pt(9)
    labels.show_value = True
    for s_index, s in enumerate(plot.series):
        s.format.fill.solid()
        s.format.fill.fore_color.rgb = colors[s_index] if colors else BAR_GREY
        s.invert_if_negative = False
        if highlight is not None:
            point = s.points[highlight]
            point.format.fill.solid()
            point.format.fill.fore_color.rgb = RED
    return chart


# ---- Data shared across slides

kpis = baseline["kpis"]
funnel = baseline["funnel"]
steep = baseline["drop_reasons"]["steepest_drop"]
segments = {row["segment"]: row for row in baseline["segments"]}
MICRO, PROF, MULTI, MFG = (
    "Micro retail & services",
    "Professional offices",
    "Small multi-site businesses",
    "Small manufacturers",
)
SHORT = {MICRO: "Micro", PROF: "Professional", MULTI: "Multi-site", MFG: "Manufacturers"}
cases = impact["cases"]
sensitivity = impact["sensitivity"]
field_micro = impact["field_visits_to_micro"]
by_source = {(row["segment"], row["source"]): row for row in baseline["segment_by_source"]}
provider = {row["current_provider"]: row for row in signals["current_provider"]}
prop = propensity["metrics_without_language_and_state"]


def slide_title(s):
    write(s, 0.6, 2.72, 3.9, 0.5, "Project Udyam Digital", size=24, bold=True, color=WHITE, name="Title")
    write(s, 0.6, 3.22, 3.45, 0.55, "A digital-first way for small businesses to find, buy and activate Accel Business bundles", size=12, color=WHITE, name="Subtitle")
    write(s, 0.6, 3.92, 3.7, 0.5, ["Enterprise Track A business case", "Team name to be added"], size=10, color=WHITE, name="Team")
    s.notes_slide.notes_text_frame.text = "Add the team name before submitting. All data is synthetic, and Accel Telecom is fictional."


def slide_problem(s):
    title(s, f"Only {kpis['lead_to_activation_pct']}% of leads activate, and the steepest drop is about price")
    bar_chart(
        s, 0.45, 1.32, 5.1, 3.72,
        [row["stage"] for row in funnel],
        [("Leads", [row["leads"] for row in funnel])],
        "Leads reaching each stage",
        highlight=3,
        descr="Funnel from 5,000 leads to 368 activations, with quote accepted highlighted as the steepest drop.",
    )
    w, gap, left = 1.82, 0.1, 5.75
    stat(s, left, 1.4, w, 0.82, inr(kpis["acquisition_cost_inr"]), "acquisition cost per activation")
    stat(s, left + w + gap, 1.4, w, 0.82, f"{kpis['time_to_activate_days']} days", "from lead to activation")
    stat(s, left, 2.3, w, 0.82, f"{kpis['status_chases']:.2f}", "status chases per customer")
    stat(s, left + w + gap, 2.3, w, 0.82, f"{kpis['churn_6m_pct']}%", "6-month churn")
    card_text(
        s, left, 3.22, 2 * w + gap, 1.74,
        [
            [("Why quotes aren't accepted", {"bold": True, "size": 11})],
            [(f"{steep['price_or_competitor_pct']:.0f}%", {"bold": True, "color": RED}), (" of these drops cite price or a cheaper competitor.", {})],
            [(f"{steep['slow_or_complex_quote_pct']:.0f}%", {"bold": True, "color": RED}), (" cite a slow or complex quote.", {})],
            "So a clearer quote is needed, but isn't enough. We also need smaller bundles.",
        ],
        fill=TINT,
        anchor=MSO_ANCHOR.TOP,
    )
    source(s, f"Source: {SOURCE}. analytics/baseline.py")
    s.notes_slide.notes_text_frame.text = (
        "Script: analytics/baseline.py, keys kpis, funnel, drop_reasons.steepest_drop. Acquisition cost is total spend over all leads "
        "divided by activations, not an average over activated leads. No activation has had six full months by the pack's date of "
        "15 July 2026, so the churn label is used as given."
    )


def slide_segments(s):
    title(s, "Start where the value is: leads and value sit in different segments")
    order = [MICRO, PROF, MULTI, MFG]
    bar_chart(
        s, 0.45, 1.32, 4.55, 2.72,
        [SHORT[name] for name in order],
        [("Share of leads", [segments[n]["lead_share_pct"] for n in order]), ("Share of bundle value", [segments[n]["bundle_value_share_pct"] for n in order])],
        "Share of leads against share of monthly bundle value, %",
        number_format='0"%"',
        colors=[BAR_GREY, RED],
        legend=True,
        descr="Micro is 54 percent of leads and 6 percent of value. Multi-site is 15 percent of leads and 57 percent of value.",
    )
    rows = [["Segment", "Activation", "Acquisition cost", "Payback, months", "Churn"]]
    for name in order:
        row = segments[name]
        rows.append([SHORT[name], f"{row['activation_pct']}%", inr(row["acquisition_cost_inr"]), row["payback_months_of_revenue"], f"{row['churn_6m_pct']}%"])
    table(s, 5.15, 1.42, 4.35, rows, [1.15, 0.78, 0.92, 0.8, 0.7], row_height=0.42, size=10, header_size=9, highlight=(1,), name="Segment economics")
    card_text(
        s, 5.15, 3.62, 4.35, 1.36,
        [
            [("Proposed order", {"bold": True})],
            "1. Professional offices and multi-site, for their value and fit.",
            "2. Micro on a digital-only route, once it costs far less to serve.",
            "3. Manufacturers stay led by people, because leased lines need it.",
        ],
        fill=GREY_FILL,
        size=10,
        anchor=MSO_ANCHOR.TOP,
    )
    card_text(
        s, 0.5, 4.14, 4.5, 0.84,
        [[(f"Field visits to micro took {field_micro['share_of_all_spend_pct']}% of all spend for {field_micro['share_of_all_activations_pct']}% of activations", {"bold": True, "color": RED}), (f": {inr(by_source[(MICRO, 'Field sales')]['acquisition_cost_inr'])} per activation.", {})]],
        fill=TINT,
        size=11,
    )
    source(s, f"Source: {SOURCE}. Payback is months of median bundle revenue, not margin. analytics/baseline.py, impact_model.py")
    s.notes_slide.notes_text_frame.text = (
        "Script: analytics/baseline.py, keys segments and segment_by_source; analytics/impact_model.py, key field_visits_to_micro. "
        "The pack has no cost data, so payback is revenue and not margin. The segment order is a proposal."
    )


def slide_bundles(s):
    title(s, "One clear bundle for each segment, with a single monthly price")
    rows = [
        ["Order", "Segment", "Route", "Example bundle", "A month", "Setup", "Contract"],
        ["1", "Professional offices", "Fully digital", "Fibre 300, 2 Postpaid 599, 8 email users, 7 endpoint licences, Cloud Backup", inr(5618), inr(0), "12 months"],
        ["1", "Small multi-site", "Digital quote, a person confirms each site", "8 sites of Fibre 300 with failover, 3 Postpaid 599, 3 POS counters, 4 cameras", inr(22924), inr(26700), "12 months"],
        ["2", "Micro retail and services", "Digital only, no field visits", "Fibre 100, 1 Postpaid 299, Secure Wi-Fi. Needs no GSTIN", inr(1947), inr(1000), "12 months"],
        ["3", "Small manufacturers", "Led by people, advisor qualifies", "Leased Line 20, Managed Firewall, 3 Postpaid 599, 10 email users, 10 endpoint licences", inr(17216), inr(14000), "24 months"],
    ]
    table(s, 0.5, 1.28, 9.0, rows, [0.5, 1.25, 1.5, 3.1, 0.82, 0.83, 0.0 + 0.0 + 1.0 - 0.0], row_height=0.52, size=10, header_size=10, name="Bundles by segment")
    w = 2.9
    card_text(s, 0.5, 4.02, w, 0.94, [[("Why this bundle", {"bold": True})], "Each item ties to a need the owner stated. Micro isn't upsold past them."], size=10, anchor=MSO_ANCHOR.TOP)
    card_text(s, 0.5 + w + 0.15, 4.02, w, 0.94, [[("Why this price", {"bold": True})], "Midpoint of each catalogue range. Historic prices show no pattern by tier, segment or volume."], size=10, anchor=MSO_ANCHOR.TOP)
    card_text(s, 0.5 + 2 * (w + 0.15), 4.02, w, 0.94, [[("Why this contract", {"bold": True})], "The longest in the bundle, shown before any commitment, including when a toggle changes it."], size=10, anchor=MSO_ANCHOR.TOP)
    source(s, "Prices at the catalogue midpoint, excl. GST. Quantities are examples the owner can edit. product_catalogue.csv; tests/unit/domain/pricing")
    s.notes_slide.notes_text_frame.text = (
        "These bundles are repriced in tests/unit/domain/pricing/pricing.test.ts. Setup fees and contract lengths use formulas that match "
        "all 368 historic bundles (tests/regression/historic-bundles.test.ts). The midpoint is a team assumption, held in one constant. "
        "Tax treatment isn't stated in the catalogue."
    )


def slide_journey(s):
    title(s, "Buy and track on a phone, with code making every decision")
    steps = [
        ("Advisor", "Asks a few questions in the owner's language, then recommends one bundle and says why."),
        ("Quote", "One monthly price. Add-ons toggle, and blocked ones show the reason."),
        ("Smart KYC", "Consent first, then lookups and document checks with specific next steps."),
        ("Tracker", "What happens next and when, in place of the three status calls."),
    ]
    w, gap = 2.12, 0.173
    for index, (name, text) in enumerate(steps):
        x = 0.5 + index * (w + gap)
        card_text(s, x, 1.3, w, 1.95, [[(f"Screenshot to add: {name}", {"size": 10, "color": MUTED})]], align=PP_ALIGN.CENTER, name=f"Screenshot placeholder: {name}")
        write(s, x, 3.3, w, 0.26, f"{index + 1}. {name}", size=12, bold=True)
        write(s, x, 3.56, w, 0.72, text, size=10, color=MUTED)
    card_text(
        s, 0.5, 4.36, 9.0, 0.62,
        [[("Code decides eligibility, price and KYC verdicts. The LLM only asks and explains. ", {"bold": True}), ("If the LLM, OCR or a registry is down, the owner can still finish or come back.", {})]],
        fill=TINT,
        size=11,
    )
    source(s, "Prototype screens are for Accel Business, the case's fictional operator.")
    s.notes_slide.notes_text_frame.text = "Replace the four grey panels with phone screenshots once the screens are built."


def slide_kyc(s):
    title(s, "KYC in seconds, with consent first and only the data needed")
    steps = ["Consent", "Number lookup", "Upload and read", "Checks", "Verdict"]
    w = 1.76
    for index, name in enumerate(steps):
        shape = s.shapes.add_shape(MSO_SHAPE.PENTAGON if index == 0 else MSO_SHAPE.CHEVRON, Inches(0.5 + index * (w + 0.05)), Inches(1.3), Inches(w), Inches(0.46))
        shape.name = f"Step: {name}"
        shape.fill.solid()
        shape.fill.fore_color.rgb = INK if index else RED
        shape.line.fill.background()
        shape.shadow.inherit = False
        fill_text(shape.text_frame, name, 10, WHITE, True, PP_ALIGN.CENTER, MSO_ANCHOR.MIDDLE)
    left, sw = 0.5, 2.75
    stat(s, left, 1.92, sw, 0.72, "12 of 12", "specimen applicants reached the expected result, by our own reading")
    stat(s, left, 2.72, sw, 0.72, "96.8%", "of fields read correctly, or 99.2% with GSTIN repair")
    stat(s, left, 3.52, sw, 0.72, "0.8 s", "median per page, on a laptop with local OCR")
    write(s, left, 4.3, sw, 0.72, "Clean applicants passing matters as much as faults being caught. Phone photos are not yet tested.", size=9, color=MUTED)
    rows = [
        ["DPDP Act 2023", "What the design does"],
        ["Notice and consent", "Shown before any collection. Separate per purpose, unticked, and enforced on the server."],
        ["Purpose limitation", "KYC data never feeds marketing or lead scoring. Marketing is never bundled."],
        ["Data minimisation", "Asks only for the documents this bundle needs. A lookup can replace a document."],
        ["Security", "Documents stay local and encrypted, identifiers are masked, and none of it reaches the LLM."],
        ["Retention and rights", "Raw images deleted after verification. Owners can view, correct, withdraw and complain."],
    ]
    table(s, 3.45, 1.92, 6.05, rows, [1.55, 4.5], row_height=0.51, size=10, header_size=10, name="DPDP mapping")
    source(s, "Source: our test on the 47 specimen images, docs/spikes/ocr-accuracy.md.")
    s.notes_slide.notes_text_frame.text = (
        "OCR figures: docs/spikes/ocr-accuracy.md. Specimen results: tests/regression/kyc-specimens.test.ts. K06 and K10 first ask the owner to "
        "confirm a GSTIN that fails the checksum. Every statement in the DPDP table must be true of the code, so re-check it after Phase 8."
    )


def slide_people(s):
    title(s, "Field and partners close what the advisor can't, and keep credit")
    order = [MICRO, PROF, MULTI, MFG]
    bar_chart(
        s, 0.45, 1.32, 4.1, 3.7,
        [SHORT[name] for name in order],
        [("Acquisition cost", [by_source[(name, "Field sales")]["acquisition_cost_inr"] for name in order])],
        "Field sales: acquisition cost per activation, ₹",
        number_format="#,##0",
        highlight=0,
        descr="Field sales costs about 53 thousand rupees per activation on micro, against about 16 to 18 thousand on the other segments.",
    )
    x, w = 4.75, 4.75
    card_text(s, x, 1.38, w, 1.12, [[("Field force", {"bold": True, "size": 12})], f"Move off micro and onto multi-site and manufacturers: site surveys, leased lines and large accounts. A simple score puts the best leads first, with the top tenth converting at {prop['top_decile_lift']:.1f} times the average."], size=10, anchor=MSO_ANCHOR.TOP)
    card_text(s, x, 2.58, w, 1.12, [[("Channel partners", {"bold": True, "size": 12})], "Sit with the owner on the same journey, seeing masked data and no raw documents. An attribution code keeps their credit if the owner finishes alone, so digital doesn't compete with them."], size=10, anchor=MSO_ANCHOR.TOP)
    card_text(s, x, 3.78, w, 1.2, [[("Advisor", {"bold": True, "size": 12})], "Handles the rest, and hands over what it can't close with the reason attached, so a person starts informed. It also serves owners who only want one product."], fill=TINT, size=10, anchor=MSO_ANCHOR.TOP)
    source(s, f"Source: {SOURCE}. Commission terms aren't in the data and need confirming. analytics/baseline.py, propensity.py")
    s.notes_slide.notes_text_frame.text = (
        f"Scripts: analytics/baseline.py, key segment_by_source; analytics/propensity.py. Score tested on June leads after training on April and May: "
        f"top-decile activation {prop['top_decile_activation_pct']}% against a base rate of {prop['base_rate_pct']}%. Language and state are excluded."
    )


def slide_targets(s):
    title(s, "Modelled: the base case doubles activation, with an 11.5% floor")
    low, base, high = (cases[name]["total"] for name in ("low", "base", "high"))
    rows = [
        ["KPI", "Today", "Target", "Low", "Base", "High"],
        ["Lead-to-activation", f"{kpis['lead_to_activation_pct']}%", "15%", f"{low['lead_to_activation_pct']}%", f"{base['lead_to_activation_pct']}%", f"{high['lead_to_activation_pct']}%"],
        ["Acquisition cost", inr(kpis["acquisition_cost_inr"]), f"{inr(7000)} or less", inr(low["acquisition_cost_inr"]), inr(base["acquisition_cost_inr"]), inr(high["acquisition_cost_inr"])],
        ["Days to activate", f"{kpis['time_to_activate_days']}", "10 or fewer", low["days_to_activate_blended"], base["days_to_activate_blended"], high["days_to_activate_blended"]],
        ["Status chases", f"{kpis['status_chases']:.2f}", "1 or fewer", "Not modelled", "", ""],
        ["6-month churn", f"{kpis['churn_6m_pct']}%", "12% or less", "Not modelled", "", ""],
    ]
    grid = table(s, 0.5, 1.38, 5.45, rows, [1.45, 0.72, 1.0, 0.76, 0.76, 0.76], row_height=0.42, size=10, header_size=10, name="KPI targets")
    for row_index in (4, 5):
        grid.cell(row_index, 3).merge(grid.cell(row_index, 5))
    card_text(
        s, 0.5, 4.02, 5.45, 0.96,
        [
            [("Guardrails, all to be zero", {"bold": True})],
            "Bundles breaking a rule (56 of 368 today). Activations on an inactive GSTIN (22 today). False KYC rejections.",
        ],
        fill=TINT,
        size=10,
        anchor=MSO_ANCHOR.TOP,
    )
    labels = [
        ("Today", kpis["lead_to_activation_pct"]),
        ("Journey-only fixes", sensitivity["only_reasons_the_journey_removes_outright"]["lead_to_activation_pct"]),
        ("40% of leads adopt", sensitivity["adoption_40pct"]["lead_to_activation_pct"]),
        ("No price recovery", sensitivity["no_price_recovery"]["lead_to_activation_pct"]),
        ("Base: 60% adopt", sensitivity["base_case"]["lead_to_activation_pct"]),
    ]
    bar_chart(
        s, 6.05, 1.32, 3.5, 3.72,
        [label for label, _ in labels],
        [("Activation", [value for _, value in labels])],
        "What the result rests on: activation, %",
        number_format='0.0"%"',
        highlight=4,
        descr="Activation is 7.4 percent today, 11.5 percent counting only reasons the journey removes outright, and 15.6 percent in the base case.",
    )
    source(s, f"Modelled from {SOURCE}. Assumptions are named in analytics/impact_model.py")
    s.notes_slide.notes_text_frame.text = (
        "Every number on this slide except Today is modelled, because the prototype has no real customers. Main assumptions: 60% of leads adopt "
        "the digital journey, each drop reason has its own recovery rate, and extra activations still cost 30% of the historic Rs 5,385. Recovered "
        "leads are assumed to behave like any other lead, which may flatter the result. Micro's rise from 4.1% to 11.7% is the most uncertain line."
    )


def slide_rollout(s):
    title(s, "Roll out in three stages, proving each before funding the next")
    accel = provider["Accel (mobile only)"]
    micro_base = next(row for row in cases["base"]["by_segment"] if row["segment"] == MICRO)
    stages = [
        (
            "1. Pilot",
            "Professional offices who already hold an Accel mobile line, in two tier 1 cities, in Hindi and English.",
            f"Warm and cheap to reach: this base is {accel['n'] / kpis['leads'] * 100:.0f}% of leads and converts best, at {accel['raw_pct']}%. Run it against today's route to measure adoption.",
            "Gate: activation above the 11.5% floor, no rule-breaking bundles, false rejections near zero.",
        ),
        (
            "2. Core",
            "Add multi-site and partners' assisted mode, across all 22 cities. Replace the mocks with real GST and Udyam services, DigiLocker and e-sign.",
            f"Multi-site holds {segments[MULTI]['bundle_value_share_pct']:.0f}% of bundle value, so this is where the money is.",
            f"Gate: acquisition cost at {inr(7000)} or less, status chases at 1 or fewer.",
        ),
        (
            "3. Extend",
            "Bring micro on the digital-only route and move field visits off it. Add regional-language chat, starting with the languages converting worst today.",
            "Tamil, Punjabi and Kannada leads convert at about 5%, against 8% for Hindi and English.",
            f"Gate: micro payback near the modelled {micro_base['payback_months_of_median']} months, down from {segments[MICRO]['payback_months_of_revenue']}.",
        ),
    ]
    w, gap = 2.9, 0.15
    for index, (name, what, why, gate) in enumerate(stages):
        x = 0.5 + index * (w + gap)
        shape = s.shapes.add_shape(MSO_SHAPE.PENTAGON, Inches(x), Inches(1.3), Inches(w), Inches(0.42))
        shape.name = f"Stage: {name}"
        shape.fill.solid()
        shape.fill.fore_color.rgb = RED if index == 0 else INK
        shape.line.fill.background()
        shape.shadow.inherit = False
        fill_text(shape.text_frame, name, 12, WHITE, True, PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE, margin=0.1)
        write(s, x, 1.8, w, 1.05, what, size=10)
        write(s, x, 2.85, w, 1.0, why, size=10, color=MUTED)
        card_text(s, x, 3.92, w, 1.06, gate, fill=TINT, size=10)
    source(s, f"Stages and gates are proposals. Figures from {SOURCE}. analytics/signals.py, impact_model.py")
    s.notes_slide.notes_text_frame.text = (
        "Durations and city choices need confirming with the business. Language figures come from analytics/signals.py, adjusted for segment. "
        "We chose those three languages after seeing the data, so treat the gap as a reason to test, not as proof of cause."
    )


def slide_risks(s):
    title(s, "The main risks are known, and each has a test or a guardrail")
    no_price = sensitivity["no_price_recovery"]["lead_to_activation_pct"]
    adoption = sensitivity["adoption_40pct"]["lead_to_activation_pct"]
    rows = [
        ["Risk", "What we do about it"],
        ["Fewer owners use the digital journey than assumed", f"Even 40% adoption models at {adoption}%. The pilot measures this first."],
        ["Price stays the main objection", f"Starter bundles and single products. The model still reaches {no_price}% with no price recovery at all."],
        ["Field and partners push back", "Attribution and assisted mode keep their credit. Commission terms need agreeing early."],
        ["KYC struggles with real phone photos", "The owner confirms what OCR misreads, and explainable mismatches go to a person. Test in the pilot."],
        ["A data breach, with DPDP penalties up to ₹250 crore", "Consent first, encryption, masking and no documents sent to the LLM. Independent audit before launch."],
        ["Software doesn't shorten installs", "Leased lines take 21 to 30 days. The tracker sets expectations, and AirFiber covers sites without fibre."],
    ]
    table(s, 0.5, 1.26, 9.0, rows, [3.5, 5.5], row_height=0.42, size=10, header_size=10, name="Risks and responses")
    card_text(
        s, 0.5, 4.32, 9.0, 0.66,
        [[("What we need to proceed: ", {"bold": True, "color": RED}), ("approval for the pilot, access to real GST and Udyam services, and a decision on partner commission for digital sales.", {})]],
        fill=TINT,
        size=11,
    )
    source(s, "Modelled figures from analytics/impact_model.py. Penalty per the DPDP Act 2023 Schedule.")
    s.notes_slide.notes_text_frame.text = "Check the DPDP penalty against the current text of the Act before submitting."


def main():
    base, out = sys.argv[1], sys.argv[2]
    deck = Presentation(base)
    if len(deck.slides) != 10:
        raise SystemExit(f"Expected 10 slides in the base deck, found {len(deck.slides)}")
    builders = [
        slide_title, slide_problem, slide_segments, slide_bundles, slide_journey,
        slide_kyc, slide_people, slide_targets, slide_rollout, slide_risks,
    ]
    for slide, builder in zip(deck.slides, builders):
        builder(slide)
    deck.save(out)
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
