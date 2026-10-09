"""Check every PDF page and render overview images for visual QA."""
from pathlib import Path
import fitz
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
out = root / 'output/pdf'
for unit in ('thousand', 'crore'):
    pdf = fitz.open(out / f'MBRLR_SMH_{unit}.pdf')
    for i, page in enumerate(pdf):
        for block in page.get_text('dict')['blocks']:
            for line in block.get('lines', []):
                for span in line['spans']:
                    assert span['size'] >= 9.99, (unit, i, span)
                    x0,y0,x1,y1 = span['bbox']
                    assert x0 >= 30 and y0 >= 15 and x1 <= page.rect.width-30 and y1 <= page.rect.height-10, (unit,i,span)
        assert 'Source revision:' in page.get_text(), (unit,i,'missing footer')
    for i in (0,len(pdf)-1):
        pdf[i].get_pixmap(matrix=fitz.Matrix(1,1)).save(out / f'qa-{unit}-{i+1}.png')
    sheet = Image.new('RGB', (1200, ((len(pdf)+1)//2)*445), 'white')
    for i, page in enumerate(pdf):
        pix = page.get_pixmap(matrix=fitz.Matrix(0.5,0.5))
        im = Image.frombytes('RGB', (pix.width,pix.height), pix.samples)
        sheet.paste(im, ((i%2)*600,(i//2)*445))
    sheet.save(out / f'qa-{unit}-all.png')
    print(unit, len(pdf), 'pages: fonts and bounds passed')
