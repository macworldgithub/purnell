import json
from pathlib import Path
from reportlab.lib import colors
from reportlab.lib.pagesizes import A3, landscape
from reportlab.platypus import SimpleDocTemplate, Paragraph, Table, TableStyle, Spacer
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from xml.sax.saxutils import escape
root=Path(__file__).resolve().parents[2]
data=json.loads((root/'tmp/pdfs/client-guide-data.json').read_text())
out=root/'output/pdf/Purnell_Voice_Agent_Client_Test_Cases_Table.pdf'
pdfmetrics.registerFont(TTFont('Arial','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialBold','C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Arial',normal='Arial',bold='ArialBold')
navy=colors.HexColor('#122438'); teal=colors.HexColor('#116D70')
style=ParagraphStyle('cell',fontName='Arial',fontSize=10,leading=14,textColor=navy)
header=ParagraphStyle('header',parent=style,fontName='ArialBold',textColor=colors.white)
def p(s,st=style):return Paragraph(s,st)
def esc(s):return escape(str(s))
rows=[[p(x,header) for x in ['Customer / caller number','Vehicle / registration','Repair record','Recorded appointment','Job details / what to check']]]
shorts=[
 '102,000 km / 72-month service operation (MY21).',
 '234,000 km / 108-month service operation plus registration inspection. Two operation lines belong to one booking.',
 'Reported engine knocking noise. Cause, correction and technician notes blank. No confirmed engine diagnosis or replacement price.',
 'Suspension too high / swaying; rear seat switches not working; campaign D120 listed. No recorded brake recommendation, $450 estimate or work approval.',
 'Corrections record mud flaps supplied and fitted, and auto-unlock enabled and working. Vibration investigation found no concern; rebooking for further inspection recorded.',
]
for i,r in enumerate(data['customers']):
 phone=r['phone'];phone='0'+phone[3:] if phone.startswith('+61') else phone
 v=r['vehicle'];rep=r['repairs'][0] if r['repairs'] else None
 repairs='No linked legacy repair order returned.'
 if rep:repairs='<b>'+esc(rep['number'])+' / '+esc(rep['status'])+'</b><br/>Advisor: '+esc(rep['advisor'])+'<br/>Legacy drop-off: '+esc(rep['dropoff'])+' '+esc(rep['time'])+'<br/>Historical promise: '+esc(rep['promised'])+' '+esc(rep['promised_time'])+'<br/>Snapshot: '+esc(rep['snapshot'])
 bs=[x for x in r['bookings'] if x['data'].get('appt_no')]
 if bs:
  b=bs[0]['data'];appt='<b>Booking '+esc(b['appt_no'])+'</b><br/>'+esc(b['date_in'])+' at '+esc(b['in'])+'<br/>Report date-out: '+esc(b['date_out'])+' '+esc(b['out'])
 elif r['bookings']:
  b=r['bookings'][0]['data'];appt='<b>RO-linked report row; booking ID blank.</b><br/>Date-in: '+esc(b['date_in'])+' '+esc(b['in'])+'<br/>Date-out: '+esc(b['date_out'])+' '+esc(b['out'])+'<br/>Newer report differs from legacy RO. Not proof of a new confirmed booking.'
 else:appt='No appointment returned from the latest-report collection. This does not prove none exists in Pentana.'
 rows.append([
  p('<b>'+esc(r['name'].title())+'</b><br/><br/><b>'+esc(phone)+'</b>'),
  p('<b>'+esc(v['rego'])+'</b><br/>'+esc(v['model'])+'<br/>Colour (source): '+esc(v['colour'])),
  p(repairs),p(appt),p(esc(shorts[i])+'<br/><br/><b>Ask:</b> '+('When is my next recorded appointment? What is the reference and listed work?' if i<2 else 'What is my repair reference, recorded status, advisor and actual job notes?'))])
title=ParagraphStyle('title',fontName='ArialBold',fontSize=24,leading=30,textColor=navy)
note=ParagraphStyle('note',parent=style,fontSize=10,leading=14)
story=[p('Purnell Motors | Voice Agent Test Cases',title),Spacer(1,7),
 p('CONFIDENTIAL CLIENT COPY  /  Prepared 26 November 2026  /  Five real MongoDB examples',ParagraphStyle('sub',parent=note,textColor=teal)),Spacer(1,14)]
t=Table(rows,colWidths=[175,190,205,230,310],hAlign='LEFT')
t.setStyle(TableStyle([
 ('BACKGROUND',(0,0),(-1,0),navy),('VALIGN',(0,0),(-1,-1),'TOP'),
 ('LEFTPADDING',(0,0),(-1,-1),10),('RIGHTPADDING',(0,0),(-1,-1),10),
 ('TOPPADDING',(0,0),(-1,-1),10),('BOTTOMPADDING',(0,0),(-1,-1),10),
 ('ROWBACKGROUNDS',(0,1),(-1,-1),[colors.HexColor('#F1F5F7'),colors.white]),
 ('LINEBELOW',(0,0),(-1,0),1,teal),('LINEBELOW',(0,1),(-1,-1),.4,colors.HexColor('#CEDAE0')),
]))
story+=[t,Spacer(1,13),
 p('<b>How to test:</b> Enter the caller number above, select Start Voice Agent, and ask one question at a time. Give the full account name and registration if asked. The browser number simulates caller ID; it does not call or text the client.',note),
 Spacer(1,7),
 p('<b>Test your own records too:</b> If you know the details of another authorised customer record in the database, you may test with that stored number, name and registration. Compare the answer with the linked source records.',note),
]
doc=SimpleDocTemplate(str(out),pagesize=landscape(A3),rightMargin=36,leftMargin=36,topMargin=30,bottomMargin=26)
doc.build(story)
print(out)
