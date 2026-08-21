import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { paginatePostingProtocol } from "./posting-protocol.js";

const MM = 72 / 25.4;
const A4 = [210*MM, 297*MM];

function safe(value) { return String(value ?? ""); }
function fit(text, font, size, width) {
  let value = safe(text);
  if (font.widthOfTextAtSize(value,size) <= width) return value;
  while (value.length > 1 && font.widthOfTextAtSize(value + "...",size) > width) value = value.slice(0,-1);
  return value + "...";
}

export async function createPostingProtocolPdf(model, options = {}) {
  if (!model?.valid) throw new Error("Modelo de protocolo invalido");
  const pagesModel = paginatePostingProtocol(model, { rowsPerColumn: options.rowsPerColumn || 88 });
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [w,h] = A4;
  const margin = 12*MM;
  const gutter = 5*MM;
  const colW = (w - 2*margin - gutter)/2;
  const rowH = 2.55*MM;

  for (const pageModel of pagesModel) {
    const page = pdf.addPage(A4);
    page.drawText("PROTOCOLO DE POSTAGEM A VISTA", { x:margin, y:h-13*MM, size:13, font:bold });
    page.drawText(`${safe(model.senderName)}${model.cnpj ? ` - CNPJ ${safe(model.cnpj)}` : ""}`, { x:margin, y:h-18*MM, size:7.5, font:regular });
    page.drawText(`Data: ${safe(model.protocolDate)}   Total: ${model.total}   Pagina ${pageModel.pageNumber}/${pageModel.pageCount}`, { x:w-margin-65*MM, y:h-13*MM, size:6.8, font:regular });

    const drawColumn = (column, x) => {
      let y = h-27*MM;
      page.drawRectangle({ x, y:y-5*MM, width:colW, height:5*MM, color:rgb(.88,.88,.88) });
      const widths = [9*MM,31*MM,22*MM,colW-62*MM];
      const xs = [x, x+widths[0], x+widths[0]+widths[1], x+widths[0]+widths[1]+widths[2]];
      ["N","OBJETO","CEP","DESTINATARIO"].forEach((head,i)=>page.drawText(head,{x:xs[i]+1*MM,y:y-3.5*MM,size:5.4,font:bold}));
      y -= 5*MM;
      for (const segment of column.segments) {
        page.drawRectangle({ x, y:y-5*MM, width:colW, height:5*MM, color:rgb(0,0,0) });
        const listTitle = `LISTA ${segment.listNumber}${segment.continuation ? " (cont.)" : ""}  ${segment.serviceCode} ${segment.service}`;
        page.drawText(fit(listTitle,bold,5.5,colW-2*MM),{x:x+1*MM,y:y-3.5*MM,size:5.5,font:bold,color:rgb(1,1,1)});
        y -= 5*MM;
        for (const row of segment.rows) {
          if ((row.itemNumber || 0) % 2 === 0) page.drawRectangle({x,y:y-rowH,width:colW,height:rowH,color:rgb(.96,.96,.96)});
          const vals=[row.itemNumber,row.trackingCode,row.zip,row.recipient];
          vals.forEach((val,i)=>page.drawText(fit(val,regular,5.2,widths[i]-2*MM),{x:xs[i]+1*MM,y:y-1.8*MM,size:5.2,font:regular}));
          y -= rowH;
        }
      }
    };
    drawColumn(pageModel.left, margin);
    drawColumn(pageModel.right, margin+colW+gutter);
  }
  pdf.setTitle("Protocolo de Postagem a Vista");
  return pdf.save();
}
