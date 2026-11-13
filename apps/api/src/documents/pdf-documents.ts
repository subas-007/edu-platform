import PDFDocument from 'pdfkit';

/**
 * Server-rendered PDFs (certificates, score cards, flashcard sheets). Generated on
 * the server so a certificate can only exist for a result the database confirms.
 * Uses the built-in PDF fonts (no font files to ship), which cover Latin-1 + WinAnsi.
 */

/** Fixed colours; the brand ones (accent, dark surfaces) come from PdfBrand. */
const COLORS = {
  text: '#1e293b',
  muted: '#64748b',
  good: '#059669',
  bad: '#dc2626',
  warn: '#d97706',
};

const WIN_ANSI_EXTRAS = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

/** Replaces characters the standard PDF fonts cannot draw (e.g. CJK, math symbols). */
export function toPdfText(value: string): string {
  return [...value.normalize('NFKC')]
    .map((ch) => {
      const code = ch.codePointAt(0)!;
      if (ch === '\n' || ch === '\t' || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return ch;
      if (WIN_ANSI_EXTRAS.has(ch)) return ch;
      const stripped = ch.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      return /^[\x20-\x7e]+$/.test(stripped) ? stripped : '?';
    })
    .join('');
}

/** The administrator's branding (see BrandingService.pdfBrand). */
export interface PdfBrand {
  name: string;
  /** Light accent, for use on the dark surfaces. */
  accent: string;
  /** Accent with at least 4.5:1 contrast on white. */
  accentOnLight: string;
  ink: string;
  panel: string;
  line: string;
  logo: Buffer | null;
}

function renderToBuffer(
  brand: PdfBrand,
  options: PDFKit.PDFDocumentOptions,
  draw: (doc: PDFKit.PDFDocument) => void,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ ...options, info: { Producer: toPdfText(brand.name), ...options.info } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    try {
      draw(doc);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/** The logo, centred in the box; skipped if it cannot be embedded (the text still names the site). */
function drawLogo(doc: PDFKit.PDFDocument, logo: Buffer | null, x: number, y: number, width: number, height: number) {
  if (!logo) return;
  try {
    doc.image(logo, x, y, { fit: [width, height], align: 'center', valign: 'center' });
  } catch {
    /* unreadable image: leave it out */
  }
}

const formatDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// -----------------------------------------------------------------------------

export interface CertificateData {
  certificateId: string;
  candidateName: string;
  examTitle: string;
  scorePercent: number;
  correctCount: number;
  totalQuestions: number;
  completedAt: Date;
}

export function renderCertificatePdf(data: CertificateData, brand: PdfBrand): Promise<Buffer> {
  return renderToBuffer(
    brand,
    { size: 'A4', layout: 'landscape', margin: 0, info: { Title: `Certificate - ${toPdfText(data.examTitle)}` } },
    (doc) => {
      const { width: W, height: H } = doc.page;

      doc.rect(0, 0, W, H).fill(brand.ink);
      doc.rect(24, 24, W - 48, H - 48).lineWidth(2).stroke(brand.accent);
      doc.rect(34, 34, W - 68, H - 68).lineWidth(0.5).stroke(brand.line);
      // corner accents
      for (const [x, y] of [[24, 24], [W - 84, 24], [24, H - 28], [W - 84, H - 28]] as const) {
        doc.rect(x, y, 60, 4).fill(brand.accent);
      }

      drawLogo(doc, brand.logo, W / 2 - 80, 42, 160, 30);
      doc.fillColor(brand.accent).font('Helvetica-Bold').fontSize(12)
        .text(toPdfText(brand.name).toUpperCase(), 0, 78, { width: W, align: 'center', characterSpacing: 6 });
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(40)
        .text('Certificate of Achievement', 0, 112, { width: W, align: 'center' });

      doc.fillColor('#94a3b8').font('Helvetica').fontSize(14)
        .text('This certifies that', 0, 188, { width: W, align: 'center' });
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(30)
        .text(toPdfText(data.candidateName), 60, 216, { width: W - 120, align: 'center' });
      doc.moveTo(W / 2 - 180, 262).lineTo(W / 2 + 180, 262).lineWidth(1).stroke(brand.accent);

      doc.fillColor('#94a3b8').font('Helvetica').fontSize(14)
        .text('has successfully completed the assessment', 0, 280, { width: W, align: 'center' });
      doc.fillColor('#e2e8f0').font('Helvetica-Bold').fontSize(20)
        .text(toPdfText(data.examTitle), 80, 306, { width: W - 160, align: 'center' });

      // score badge
      const cx = W / 2;
      const cy = 400;
      doc.circle(cx, cy, 42).fill(brand.panel);
      doc.circle(cx, cy, 42).lineWidth(3).stroke(brand.accent);
      doc.fillColor(brand.accent).font('Helvetica-Bold').fontSize(24)
        .text(`${Math.round(data.scorePercent)}%`, cx - 42, cy - 14, { width: 84, align: 'center' });
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(10)
        .text(`${data.correctCount} of ${data.totalQuestions} correct`, 0, cy + 50, { width: W, align: 'center' });

      doc.fillColor('#94a3b8').font('Helvetica').fontSize(10);
      doc.text(`Date of completion: ${formatDate(data.completedAt)}`, 70, H - 82, { width: 300 });
      doc.text(`Certificate ID: ${data.certificateId}`, W - 370, H - 82, { width: 300, align: 'right' });
    },
  );
}

// -----------------------------------------------------------------------------

export interface ScorecardData {
  candidateName: string;
  candidateEmail: string;
  examTitle: string;
  kind: 'Practice' | 'Exam program';
  mode: 'LEARNING' | 'EXAM';
  status: string;
  startedAt: Date;
  completedAt: Date | null;
  scorePercent: number;
  correctCount: number;
  totalQuestions: number;
  unansweredCount: number;
  certificateEligible: boolean;
  concepts: Array<{ conceptTag: string; correctAnswers: number; totalQuestions: number; accuracy: number }>;
  questions: Array<{ index: number; conceptTag: string; outcome: 'Correct' | 'Incorrect' | 'Unanswered' }>;
}

export function renderScorecardPdf(data: ScorecardData, brand: PdfBrand): Promise<Buffer> {
  return renderToBuffer(
    brand,
    { size: 'A4', margin: 48, info: { Title: `Score card - ${toPdfText(data.examTitle)}` } },
    (doc) => {
      const W = doc.page.width;
      const left = 48;
      const contentWidth = W - 96;

      doc.rect(0, 0, W, 110).fill(brand.ink);
      doc.rect(0, 110, W, 4).fill(brand.accent);
      doc.fillColor(brand.accent).font('Helvetica-Bold').fontSize(10)
        .text(`${toPdfText(brand.name).toUpperCase()}  ·  SCORE CARD`, left, 34, { characterSpacing: 2 });
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20)
        .text(toPdfText(data.examTitle), left, 52, { width: contentWidth - 120 });
      doc.fillColor(brand.accent).font('Helvetica-Bold').fontSize(30)
        .text(`${Math.round(data.scorePercent)}%`, W - 48 - 120, 46, { width: 120, align: 'right' });

      let y = 136;
      const row = (label: string, value: string) => {
        doc.fillColor(COLORS.muted).font('Helvetica').fontSize(10).text(label, left, y, { width: 130 });
        doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(10).text(toPdfText(value), left + 130, y, { width: contentWidth - 130 });
        y += 18;
      };
      row('Candidate', `${data.candidateName} (${data.candidateEmail})`);
      row('Assessment', `${data.kind} · ${data.mode === 'EXAM' ? 'Exam mode' : 'Learning mode'}`);
      row('Status', data.status === 'EXPIRED' ? 'Submitted automatically (time expired)' : 'Submitted');
      row('Started', data.startedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
      if (data.completedAt) row('Completed', data.completedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC');
      row('Result', `${data.correctCount} of ${data.totalQuestions} correct${data.unansweredCount ? ` · ${data.unansweredCount} unanswered` : ''}`);
      row(
        'Certificate',
        data.certificateEligible
          ? 'Awarded (score above 70% in exam mode)'
          : data.mode === 'EXAM'
            ? 'Not awarded (requires more than 70%)'
            : 'Not applicable (learning mode)',
      );

      y += 14;
      doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(13).text('Performance by concept', left, y);
      y += 22;
      for (const c of data.concepts) {
        if (y > doc.page.height - 80) { doc.addPage(); y = 48; }
        const pct = Math.round(c.accuracy * 100);
        doc.fillColor(COLORS.text).font('Helvetica').fontSize(10).text(toPdfText(c.conceptTag), left, y, { width: 200 });
        doc.fillColor(COLORS.muted).text(`${c.correctAnswers}/${c.totalQuestions}  (${pct}%)`, left + contentWidth - 90, y, { width: 90, align: 'right' });
        const barX = left + 210;
        const barW = contentWidth - 310;
        doc.roundedRect(barX, y + 2, barW, 7, 3).fill('#e2e8f0');
        if (pct > 0) {
          doc.roundedRect(barX, y + 2, Math.max(6, (barW * pct) / 100), 7, 3)
            .fill(c.accuracy < 0.5 ? COLORS.bad : c.accuracy < 0.7 ? COLORS.warn : COLORS.good);
        }
        y += 20;
      }

      y += 14;
      if (y > doc.page.height - 120) { doc.addPage(); y = 48; }
      doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(13).text('Question results', left, y);
      y += 22;
      doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(9);
      doc.text('#', left, y, { width: 30 });
      doc.text('CONCEPT', left + 40, y, { width: 300 });
      doc.text('RESULT', left + contentWidth - 100, y, { width: 100, align: 'right' });
      y += 14;
      for (const q of data.questions) {
        if (y > doc.page.height - 60) { doc.addPage(); y = 48; }
        doc.moveTo(left, y - 3).lineTo(left + contentWidth, y - 3).lineWidth(0.5).stroke('#e2e8f0');
        doc.fillColor(COLORS.text).font('Helvetica').fontSize(10).text(String(q.index), left, y, { width: 30 });
        doc.text(toPdfText(q.conceptTag), left + 40, y, { width: 300 });
        doc.fillColor(q.outcome === 'Correct' ? COLORS.good : q.outcome === 'Incorrect' ? COLORS.bad : COLORS.muted)
          .font('Helvetica-Bold').text(q.outcome, left + contentWidth - 100, y, { width: 100, align: 'right' });
        y += 18;
      }

      // The footer sits inside the bottom margin; without this pdfkit would start a new page for it.
      doc.page.margins.bottom = 0;
      doc.fillColor(COLORS.muted).font('Helvetica').fontSize(8)
        .text(`Generated ${new Date().toISOString().slice(0, 10)} by ${toPdfText(brand.name)}`, left, doc.page.height - 40, {
          width: contentWidth,
          align: 'center',
          lineBreak: false,
        });
    },
  );
}

// -----------------------------------------------------------------------------

export function renderFlashcardsPdf(
  materialTitle: string,
  cards: Array<{ frontText: string; backText: string }>,
  brand: PdfBrand,
): Promise<Buffer> {
  return renderToBuffer(
    brand,
    { size: 'A4', margin: 48, info: { Title: `Flashcards - ${toPdfText(materialTitle)}` } },
    (doc) => {
      const W = doc.page.width;
      const left = 48;
      const contentWidth = W - 96;

      doc.rect(0, 0, W, 90).fill(brand.ink);
      doc.rect(0, 90, W, 4).fill(brand.accent);
      doc.fillColor(brand.accent).font('Helvetica-Bold').fontSize(10)
        .text(`${toPdfText(brand.name).toUpperCase()}  ·  FLASHCARDS`, left, 28, { characterSpacing: 2 });
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18)
        .text(toPdfText(materialTitle), left, 46, { width: contentWidth - 80 });
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(10)
        .text(`${cards.length} cards`, W - 48 - 80, 50, { width: 80, align: 'right' });

      let y = 118;
      cards.forEach((card, i) => {
        const front = toPdfText(card.frontText);
        const back = toPdfText(card.backText);
        doc.font('Helvetica-Bold').fontSize(11);
        const frontH = doc.heightOfString(front, { width: contentWidth - 60 });
        doc.font('Helvetica').fontSize(10);
        const backH = doc.heightOfString(back, { width: contentWidth - 60 });
        const boxH = frontH + backH + 40;
        if (y + boxH > doc.page.height - 48) { doc.addPage(); y = 48; }

        doc.roundedRect(left, y, contentWidth, boxH, 8).lineWidth(1).stroke('#cbd5e1');
        doc.rect(left, y + 8, 3, boxH - 16).fill(brand.accentOnLight);
        doc.fillColor(brand.accentOnLight).font('Helvetica-Bold').fontSize(9).text(`Q${i + 1}`, left + 14, y + 12, { width: 30 });
        doc.fillColor(COLORS.text).font('Helvetica-Bold').fontSize(11).text(front, left + 46, y + 12, { width: contentWidth - 60 });
        const backY = y + 12 + frontH + 10;
        doc.fillColor(COLORS.muted).font('Helvetica-Bold').fontSize(9).text('A', left + 14, backY, { width: 30 });
        doc.fillColor(COLORS.text).font('Helvetica').fontSize(10).text(back, left + 46, backY, { width: contentWidth - 60 });
        y += boxH + 12;
      });
    },
  );
}

// -----------------------------------------------------------------------------

/** RFC 4180 CSV with spreadsheet formula-injection neutralised (=, +, -, @, tab, CR). */
export function renderFlashcardsCsv(cards: Array<{ frontText: string; backText: string }>): Buffer {
  const cell = (value: string) => {
    const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = ['"Front","Back"', ...cards.map((c) => `${cell(c.frontText)},${cell(c.backText)}`)];
  return Buffer.from('﻿' + lines.join('\r\n') + '\r\n', 'utf8'); // BOM so Excel reads UTF-8
}

/** Safe ASCII filename stem for Content-Disposition. */
export function toFilenameStem(title: string): string {
  const stem = title
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60);
  return stem || 'download';
}
