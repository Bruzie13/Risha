"""Draws a FETCH system test plan as a PDF, in the layout of the plans of
29 Oct 2026 (updadmin/updcashier/updsupplier.pdf): legal landscape, the
project header with the status legend, then one table of Module / TESTCASE /
ID / DESCRIPTION / EXPECTED RESULT / ACTUAL RESULT / COMMENT / STATUS whose
header repeats on every page.

The plan itself is data (admin_plan.py and the others): a role, then modules,
each with test cases, each with (description, expected) steps. **text**
is set in bold. Edit the data, run this again:

    python3 QA/test-plans/build_plan.py admin  out.pdf
"""
import importlib
import pathlib
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_RIGHT
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, NextPageTemplate, PageTemplate,
                                Paragraph, Spacer, Table, TableStyle)

# Carlito, the original's font, is Calibri's metric twin; Word ships Calibri
FONTS = pathlib.Path('/Applications/Microsoft Word.app/Contents/Resources/DFonts')
pdfmetrics.registerFont(TTFont('Cal', str(FONTS / 'Calibri.ttf')))
pdfmetrics.registerFont(TTFont('Cal-B', str(FONTS / 'Calibrib.ttf')))
pdfmetrics.registerFontFamily('Cal', normal='Cal', bold='Cal-B', italic='Cal', boldItalic='Cal-B')
# Calibri has no ✓ or ⌘; those two come from Arial Unicode (the original used DejaVu Sans)
pdfmetrics.registerFont(TTFont('Sym', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
SYMBOLS = '✓⌘'

GREEN = colors.HexColor('#32735F')       # project row, column header
PASSED = colors.HexColor('#70C567')
FAILED = colors.HexColor('#E43C30')
INPROG = colors.HexColor('#F5C342')
ROLE = colors.HexColor('#F1CDB1')
MODULE = colors.HexColor('#2C4D5D')
TESTCASE = colors.HexColor('#FDF2D0')
TESTCASE_TEXT = colors.HexColor('#7A611D')
LABEL = colors.HexColor('#2C4D5D')

PAGE = (1008, 612)
LEFT = 35.8
WIDTH = 971.8 - LEFT
COLS = [111.9, 104.3, 37.8, 222.3, 209.7, 98.3, 78.1, 73.6]       # as measured on the original

body = ParagraphStyle('body', fontName='Cal', fontSize=9.3, leading=11.6)
num = ParagraphStyle('num', parent=body, alignment=TA_RIGHT)
head = ParagraphStyle('head', fontName='Cal-B', fontSize=9.3, leading=11.6, textColor=colors.white, alignment=TA_CENTER)
band = ParagraphStyle('band', fontName='Cal-B', fontSize=9.3, leading=11.6)
title = ParagraphStyle('title', fontName='Cal-B', fontSize=11.5, leading=14, alignment=TA_CENTER)


def rich(text):
    """**bold** into <b>bold</b>, with the rest made safe for a Paragraph."""
    t = str(text).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
    t = re.sub(f'([{SYMBOLS}]+)', r'<font name="Sym">\1</font>', t)
    return t.replace('\n', '<br/>')


def header_block(project):
    """Project name, the four blank lines for the tester, and the status legend."""
    p = lambda s, st=band: Paragraph(s, st)
    lab = ParagraphStyle('lab', parent=band, textColor=LABEL)
    white = ParagraphStyle('w', parent=band, textColor=colors.white, fontSize=10.5, leading=13)
    leg = ParagraphStyle('leg', parent=band, alignment=TA_CENTER, textColor=LABEL)
    legw = ParagraphStyle('legw', parent=leg, textColor=colors.white)
    rows = [
        [p('Project Name', white), p(project, white), '', ''],
        [p('Testing Start', lab), '', '', ''],
        [p('Date/Time', lab), '', p('Passed (Result is same as expected)', leg), ''],
        [p('Testing End', lab), '', p('Failed (Actual result is NOT same as expected result)', legw), ''],
        [p('Name/s:', lab), '', p('In Progress (Test is still in progress or not yet done)', leg), ''],
        ['', '', p('Open (Not yet tested)', leg), ''],
    ]
    t = Table(rows, colWidths=[111.9, 280.2, 224.8, 319.1], rowHeights=[15.2] + [15] * 5)
    t.setStyle(TableStyle([
        ('GRID', (0, 0), (-1, -1), 0.6, colors.black),
        ('SPAN', (1, 0), (3, 0)),
        ('BACKGROUND', (0, 0), (-1, 0), GREEN),
        ('BACKGROUND', (2, 2), (2, 2), PASSED),
        ('BACKGROUND', (2, 3), (2, 3), FAILED),
        ('BACKGROUND', (2, 4), (2, 4), INPROG),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, -1), 1), ('BOTTOMPADDING', (0, 0), (-1, -1), 1),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
    ]))
    return t


HEADS = ['Module', 'TESTCASE', 'ID', 'DESCRIPTION', 'EXPECTED RESULT', 'ACTUAL RESULT', 'COMMENT', 'STATUS']
BASE = [
    ('GRID', (0, 0), (-1, -1), 0.6, colors.black),
    ('VALIGN', (0, 0), (-1, -1), 'TOP'),
    ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ('LEFTPADDING', (0, 0), (-1, -1), 5), ('RIGHTPADDING', (0, 0), (-1, -1), 5),
]


def column_header():
    t = Table([[Paragraph(h, head) for h in HEADS]], colWidths=COLS, rowHeights=[22])
    t.setStyle(TableStyle(BASE + [('BACKGROUND', (0, 0), (-1, 0), GREEN), ('VALIGN', (0, 0), (-1, 0), 'MIDDLE')]))
    return t


def case_tables(plan):
    """One table per test case, with its heading rows (role, module, test case)."""
    out = []
    lead = [(plan['role'], ROLE, band)]
    for module, cases in plan['modules']:
        lead.append((module, MODULE, ParagraphStyle('m', parent=band, textColor=colors.white)))
        for case, steps in cases:
            rows, style = [], list(BASE)
            for text, bg, st in lead:
                r = len(rows)
                rows.append([Paragraph(text, st)] + [''] * 7)
                style += [('SPAN', (0, r), (-1, r)), ('BACKGROUND', (0, r), (-1, r), bg), ('VALIGN', (0, r), (-1, r), 'MIDDLE'),
                          ('TOPPADDING', (0, r), (-1, r), 2), ('BOTTOMPADDING', (0, r), (-1, r), 3)]
            lead = []
            r = len(rows)
            rows.append(['', Paragraph(rich(case), ParagraphStyle('tc', parent=band, textColor=TESTCASE_TEXT))] + [''] * 6)
            style += [('SPAN', (1, r), (-1, r)), ('BACKGROUND', (0, r), (-1, r), TESTCASE), ('VALIGN', (0, r), (-1, r), 'MIDDLE'),
                      ('TOPPADDING', (0, r), (-1, r), 2), ('BOTTOMPADDING', (0, r), (-1, r), 3)]
            for i, (desc, exp) in enumerate(steps, 1):
                rows.append(['', '', Paragraph(str(i), num), Paragraph(rich(desc), body), Paragraph(rich(exp), body), '', '', ''])
            t = Table(rows, colWidths=COLS, splitByRow=1)
            t.setStyle(TableStyle(style))
            # a case may run onto the next page, but its headings never stay
            # behind without at least its first step
            t.wrap(WIDTH, 100000)
            heads = len(rows) - len(steps)
            out += [CondPageBreak(sum(t._rowHeights[:heads + 1]) + 2), t]
    return out


def build(plan, out):
    """Page 1: title, project header, column header, then the plan. Every
    later page starts with the column header, drawn above its frame."""
    top, bottom = 40, 36
    header = column_header()
    _, hh = header.wrap(WIDTH, 100)

    def later(canvas, doc):
        header.wrapOn(canvas, WIDTH, hh)
        header.drawOn(canvas, LEFT, PAGE[1] - top - hh)

    first = Frame(LEFT, bottom, WIDTH, PAGE[1] - top - bottom, id='first', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    rest = Frame(LEFT, bottom, WIDTH, PAGE[1] - top - hh - bottom, id='rest', leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc = BaseDocTemplate(str(out), pagesize=PAGE, title=plan['title'].title(), author='FETCH')
    doc.addPageTemplates([PageTemplate('first', [first]), PageTemplate('rest', [rest], onPage=later)])
    story = [NextPageTemplate('rest'), Paragraph(plan['title'], title), Spacer(1, 12), header_block(plan['project']), Spacer(1, 17), column_header()]
    doc.build(story + case_tables(plan))


if __name__ == '__main__':
    sys.path.insert(0, str(pathlib.Path(__file__).parent))
    which, out = sys.argv[1], sys.argv[2]
    build(importlib.import_module(f'{which}_plan').PLAN, out)
    print('written', out)
