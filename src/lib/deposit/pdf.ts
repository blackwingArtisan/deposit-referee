/**
 * A small PDF writer for the evidence pack: text in Helvetica (one of the 14 fonts every PDF
 * reader has, so nothing is embedded and nothing depends on the server's fonts), JPEG photos
 * passed through as they are, and outlined boxes. Pages are US Letter, measured from the top left.
 * Server only.
 */

export const PAGE = { width: 612, height: 792, margin: 48 };

export interface PdfImage {
  /** JPEG bytes. */
  data: Buffer;
  width: number;
  height: number;
  /** 1 grey, 3 colour. */
  components: number;
}

type Op =
  | { kind: "text"; x: number; y: number; size: number; bold: boolean; text: string; gray: number }
  | { kind: "image"; image: number; x: number; y: number; w: number; h: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; rgb: [number, number, number]; width: number }
  | { kind: "line"; x1: number; y1: number; x2: number; y2: number; gray: number };

/** Helvetica's widths for WinAnsi 32-126, in 1/1000 em. Enough to wrap text at a measured width. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];

/** Keeps what Helvetica in WinAnsi can show: curly quotes and dashes become plain ones. */
export function plain(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7e]/g, " ");
}

export function textWidth(text: string, size: number, bold = false): number {
  const em = [...plain(text)].reduce((sum, ch) => sum + (WIDTHS[ch.charCodeAt(0) - 32] ?? 556), 0);
  return (em * size * (bold ? 1.06 : 1)) / 1000;
}

/** Breaks text into lines no wider than `width` points. */
export function wrap(text: string, size: number, width: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of plain(text).split(/\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && textWidth(next, size, bold) > width) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Width and height from a JPEG's frame header, or null if it isn't a JPEG. */
export function jpegSize(data: Buffer): { width: number; height: number; components: number } | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < data.length) {
    if (data[at] !== 0xff) return null;
    const marker = data[at + 1];
    const length = data.readUInt16BE(at + 2);
    // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC), carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: data.readUInt16BE(at + 5), width: data.readUInt16BE(at + 7), components: data[at + 9] };
    at += 2 + length;
  }
  return null;
}

const esc = (text: string) => plain(text).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const n = (v: number) => (Math.round(v * 100) / 100).toString();

export class PdfDoc {
  private pages: Op[][] = [[]];
  private images: PdfImage[] = [];
  /** Where the next block of text goes on the current page, from the top. */
  y: number = PAGE.margin;

  private get ops() {
    return this.pages[this.pages.length - 1];
  }

  newPage() {
    this.pages.push([]);
    this.y = PAGE.margin;
  }

  /** Starts a new page unless `height` points still fit on this one. */
  room(height: number) {
    if (this.y + height > PAGE.height - PAGE.margin) this.newPage();
  }

  text(x: number, y: number, text: string, opts: { size?: number; bold?: boolean; gray?: number } = {}) {
    this.ops.push({ kind: "text", x, y, size: opts.size ?? 10, bold: !!opts.bold, text, gray: opts.gray ?? 0 });
  }

  /** Wrapped text at the current position, moving it down. */
  para(text: string, opts: { size?: number; bold?: boolean; gray?: number; indent?: number; after?: number } = {}) {
    const size = opts.size ?? 10;
    const x = PAGE.margin + (opts.indent ?? 0);
    for (const line of wrap(text, size, PAGE.width - PAGE.margin - x, opts.bold)) {
      this.room(size * 1.35);
      this.text(x, this.y + size, line, opts);
      this.y += size * 1.35;
    }
    this.y += opts.after ?? 4;
  }

  rule() {
    this.room(10);
    this.ops.push({ kind: "line", x1: PAGE.margin, y1: this.y + 4, x2: PAGE.width - PAGE.margin, y2: this.y + 4, gray: 0.8 });
    this.y += 12;
  }

  image(image: PdfImage, x: number, y: number, w: number, h: number) {
    this.images.push(image);
    this.ops.push({ kind: "image", image: this.images.length - 1, x, y, w, h });
  }

  rect(x: number, y: number, w: number, h: number, rgb: [number, number, number] = [0.86, 0.15, 0.15], width = 2) {
    this.ops.push({ kind: "rect", x, y, w, h, rgb, width });
  }

  private stream(ops: Op[]): string {
    const H = PAGE.height;
    return ops
      .map((op) => {
        if (op.kind === "text") return `BT /${op.bold ? "F2" : "F1"} ${op.size} Tf ${op.gray} g ${n(op.x)} ${n(H - op.y)} Td (${esc(op.text)}) Tj ET`;
        if (op.kind === "image") return `q ${n(op.w)} 0 0 ${n(op.h)} ${n(op.x)} ${n(H - op.y - op.h)} cm /Im${op.image} Do Q`;
        if (op.kind === "rect") return `q ${op.rgb.join(" ")} RG ${op.width} w ${n(op.x)} ${n(H - op.y - op.h)} ${n(op.w)} ${n(op.h)} re S Q`;
        return `q ${op.gray} G 0.75 w ${n(op.x1)} ${n(H - op.y1)} m ${n(op.x2)} ${n(H - op.y2)} l S Q`;
      })
      .join("\n");
  }

  /** The finished file. Text streams are left uncompressed, so the file can be searched as-is. */
  toBuffer(info: { title: string }): Buffer {
    const objects: (string | Buffer)[] = [];
    /** Object numbers start at 1. */
    const add = (body: string | Buffer) => objects.push(body);
    const catalog = add("");
    const pagesObj = add("");
    const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const imageObjs = this.images.map((img) =>
      add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /${img.components === 1 ? "DeviceGray" : "DeviceRGB"} /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`, "latin1"), img.data, Buffer.from("\nendstream", "latin1")])),
    );
    const xobjects = imageObjs.map((obj, i) => `/Im${i} ${obj} 0 R`).join(" ");
    const pageObjs = this.pages.map((ops) => {
      const content = this.stream(ops);
      const contentObj = add(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
      return add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> /XObject << ${xobjects} >> >> >>`);
    });
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageObjs.map((p) => `${p} 0 R`).join(" ")}] /Count ${pageObjs.length} >>`;
    const infoObj = add(`<< /Title (${esc(info.title)}) /Producer (Deposit Referee) >>`);

    const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    let offset = chunks[0].length;
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      offsets.push(offset);
      const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), typeof body === "string" ? Buffer.from(body, "latin1") : body, Buffer.from("\nendobj\n", "latin1")]);
      chunks.push(chunk);
      offset += chunk.length;
    });
    const xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${infoObj} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, "latin1"));
    return Buffer.concat(chunks);
  }
}
