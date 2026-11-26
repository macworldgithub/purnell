import json, re
from pathlib import Path
from datetime import datetime
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, white
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle

ROOT=Path(__file__).resolve().parents[2]
data=json.loads((ROOT/'tmp/pdfs/client-guide-data.json').read_text())
OUT=ROOT/'output/pdf/Purnell_Voice_Agent_Client_Testing_Guide.pdf'
OUT.parent.mkdir(parents=True,exist_ok=True)
pdfmetrics.registerFont(TTFont('Arial','C:/Windows/Fonts/arial.ttf'))
pdfmetrics.registerFont(TTFont('ArialBold','C:/Windows/Fonts/arialbd.ttf'))
pdfmetrics.registerFontFamily('Arial',normal='Arial',bold='ArialBold',italic='Arial',boldItalic='ArialBold')
W,H=595.28,841.89
NAVY=HexColor('#122438'); TEAL=HexColor('#116D70'); GREY=HexColor('#516170'); LIGHT=HexColor('#EFF4F6'); LINE=HexColor('#D4DFE5')
c=canvas.Canvas(str(OUT),pagesize=(W,H))
c.setTitle('Purnell Motors | Voice Agent Client Testing Guide')
c.setAuthor('Purnell Voice Agent Project')
y=0; page=0
def txt(text,size=10.5,color=NAVY,bold=False,gap=7):
 global y
 style=ParagraphStyle('p',fontName='ArialBold' if bold else 'Arial',fontSize=size,leading=size*1.4,textColor=color)
 p=Paragraph(text,style); _,height=p.wrap(W-88,900)
 if y-height<56: raise ValueError(f'Overflow page {page}: {text[:70]}')
 p.drawOn(c,44,y-height); y-=height+gap
def label(s):
 txt(s.upper(),9,TEAL,True,6)
def line():
 global y
 c.setStrokeColor(LINE); c.line(44,y,W-44,y); y-=15
def start(kicker,title,subtitle=''):
 global y,page
 if page:c.showPage()
 page+=1
 c.setFillColor(NAVY); c.rect(0,H-46,W,46,fill=1,stroke=0)
 c.setFillColor(white); c.setFont('ArialBold',10); c.drawString(44,H-29,'PURNELL MOTORS')
 c.setFont('Arial',8); c.drawRightString(W-44,H-29,'CLIENT TESTING GUIDE  /  CONFIDENTIAL')
 c.setFillColor(GREY); c.setFont('Arial',8); c.drawString(44,30,'Prepared 26 November 2026 | Real database examples | Restricted client circulation')
 c.drawRightString(W-44,30,f'{page:02d} / 08')
 y=H-76
 label(kicker); txt(title,24,NAVY,True,10)
 if subtitle:txt(subtitle,10,GREY,gap=14)
 line()
def pair(key,value):
 txt('<b>'+escape(key)+'</b>  '+escape(str(value)),10,gap=4)
def date(s):
 try:return datetime.strptime(s,'%d/%m/%Y').strftime('%d %B %Y').lstrip('0')
 except:return s
def localphone(s):
 digits=re.sub(r'\D','',s)
 return '0'+digits[2:] if digits.startswith('61') else digits
def qa(q,a):
 txt('<b>Ask:</b> '+escape(q),10,gap=2)
 txt('<b>Check:</b> '+escape(a),9.5,GREY,gap=8)

start('Client acceptance testing','Test the voice agent<br/>with real records',
      'Five customer cases, expected facts and a complete request-saving check.')
label('Purpose')
txt('Use this guide to check whether the voice agent recognises a caller, returns the correct customer and vehicle information, answers from recorded evidence, and saves a caller-confirmed service request.')
label('Before each call')
for s in [
 'Open the supplied voice-agent test page. For local testing, start the application and open http://localhost:3000 on the computer running it.',
 'Refresh the page, enter the phone number shown on the case page, select Start Voice Agent and allow microphone access.',
 'Start a separate call for each customer. Speak the full account name and registration if asked. The entered number simulates caller ID; it does not place a call or send an SMS.',
 'Ask one question at a time. The visible transcript panel is removed; retain your own test notes and copy the request reference when a save succeeds.',
]:txt(escape(s),10,gap=8)
label('Read the source date correctly')
txt('Data was read directly from MongoDB for this guide at <b>'+escape(data['verified_at'])+'</b> (UTC). This is the read time, not the age of every underlying record.',10)
txt('Repair statuses and dates below are explicitly labelled with their source snapshot. Newer appointment-report rows and older repair records may disagree. A recorded OPEN status or promised date does not establish current vehicle presence, readiness or a current completion promise.',10)
label('Important distinction')
txt('<b>Existing appointment:</b> a recorded customer booking.<br/><b>Capacity:</b> dates with recorded daily capacity, not verified exact times.<br/><b>Saved request:</b> a local request pending Service confirmation, not a reservation or confirmed Pentana booking.',10)
txt('Contains real customer names, contact numbers and vehicle references. Share only with authorised Purnell/project stakeholders. Do not use testing to contact customers or approve repair work.',9,GREY)

names=['Renee Sauvonnet','Mark Sidhom','Charbel Chebrawy','Construction Machinery Australia Pty Limited','Andrew Johnston']
for i,r in enumerate(data['customers']):
 start(f'Case {i+1:02d} / verified database example',names[i],
       'Caller number: '+localphone(r['phone'])+'   |   Registration: '+r['vehicle']['rego'])
 v=r['vehicle']
 label('Account and vehicle')
 pair('Customer ID',r['customer_id']);pair('Phone entered in demo',localphone(r['phone'])+'  (stored '+r['phone']+')')
 pair('Vehicle description',v['model']);pair('Registration',v['rego'])
 pair('Vehicle serial (source label)',v['serial_no'])
 pair('Colour',v['colour']+' (source value; codes have not been decoded)')
 if i<2:
  bs=[x for x in r['bookings'] if x['data']['appt_no']]
  b=bs[0]['data']
  label('Recorded appointment')
  pair('Booking reference',b['appt_no']);pair('Appointment / drop-off',date(b['date_in'])+' at '+b['in']+' Sydney time')
  pair('Report date-out field',date(b['date_out'])+' at '+b['out']+'; not independently confirmed collection readiness')
  pair('Advisor ID',b['advisor']+' (name not reverified for this guide)')
  pair('Report observed',bs[0]['observed_at']+' UTC')
  work='102,000 km / 72-month service operation (MY21)' if i==0 else '234,000 km / 108-month service operation; registration inspection'
  pair('Recorded work',work)
  txt('Equipment/applicability qualifiers such as (+) and (-) are not standalone work promises. Do not interpret the raw operation description as a confirmed upgrade or component replacement.',9,GREY)
  label('Suggested call and expected answers')
  qa('My name is '+names[i]+'. My registration is '+' '.join(v['rego'])+'. When is my next recorded appointment?',date(b['date_in'])+' at '+b['in']+'. Keep the answer short.')
  qa('What is my booking reference and what work is listed?',b['appt_no']+'; '+work+'.')
  qa('Can I request an earlier service?', 'Use fresh daily-capacity data, then follow the request-saving test on page 7. Do not offer an existing booking as a free slot.')
  if i==0:
   txt('<b>Existing local request:</b> RW112 has a stored request for 27 November 2026, preferred time 12:00, pending Service confirmation. Repeating the full save test may create an additional request; use a designated test and review it afterwards.',9,GREY)
  else:
   txt('The report contains two operation rows for booking 1095. They represent one booking, not two appointments. No linked legacy repair order was returned in this read.',9,GREY)
 else:
  ro=r['repairs'][0]
  label('Recorded repair order')
  pair('Reference / status',ro['number']+' / '+ro['status'])
  pair('Advisor',ro['advisor']);pair('Legacy drop-off',date(ro['dropoff'])+' at '+ro['time'])
  pair('Legacy promised completion',date(ro['promised'])+' at '+ro['promised_time']+' (historical)')
  pair('Repair snapshot',ro['snapshot'])
  if i==2:
   txt('<b>Newer report difference:</b> observed '+r['bookings'][0]['observed_at']+' UTC, the current report lists date-in 28 May 2026 at 08:45 and date-out 27 November 2026 at 16:15. Its appointment number is blank; L3051 is an RO reference, not a new booking ID.',9,GREY)
   notes=['Customer concern: check and report a knocking noise from the engine.','Cause, correction and technician notes are blank in the exported narrative. No engine-replacement diagnosis or price is established.']
  elif i==3:
   txt('<b>Newer report difference:</b> observed '+r['bookings'][0]['observed_at']+' UTC, current report rows show date-in 7 December 2026 at 08:15 and date-out 8 December 2026 at 16:30, linked to L3521. Appointment number is blank. These do not replace the legacy RO fields or prove a new confirmed appointment.',9,GREY)
   notes=['Customer concern: suspension feels too high and sways while driving.','Customer concern: rear seat switches do not work correctly; customer to demonstrate.','Work instruction: carry out recall campaign D120. Cause, correction and technician notes are blank. No brake recommendation, $450 estimate or approval request is recorded.']
  else:
   notes=['Mud flaps: customer requested front and rear mud flaps as delivery goodwill. Correction explicitly records supplied and fitted.','Vibration at 100-110 km/h: road-tested and inspected suspension, tyres and underbody without identifying a concern. Correction says rebook for further inspection.','Auto-unlock: correction records the feature was switched off, then enabled and confirmed working. This is a recorded correction, not a new diagnosis.']
  label('Actual recorded job information')
  for n in notes:txt(escape(n),9.5,gap=6)
  label('Suggested call and expected answers')
  qa('My account name is '+names[i]+', registration '+' '.join(v['rego'])+'. What is the repair reference and recorded status?',ro['number']+', OPEN; advisor Kamal Ghassah. Do not infer current workshop presence.')
  if i==4:qa('Does the record say anything was completed?', 'Mud flaps and auto-unlock have correction notes. The vibration concern requires further inspection; do not claim it is resolved.')
  else:qa('Have technicians confirmed the cause or quoted a price?', 'Do not invent findings, costs or work approvals. Explain missing evidence and direct the customer to Service.')
  txt('Ask follow-ups about the job notes, advisor and dates. Verification should persist. No parts-order record was returned for this profile; absence in this import does not prove that no parts order exists in Pentana.',9,GREY)

start('Workflow test / save a request','From capacity to saved request',
      'Use a designated test call. Saving writes a real pending request into MongoDB.')
label('Before testing')
txt('Use one of the verified caller numbers, such as Renee\'s 0412411265. Ask for an earlier routine service. Do not use the five existing appointment dates as free slots. Capacity must be checked at call time and must pass the freshness checks.')
steps=[
 ('You: What dates have available service capacity?', 'Agent checks the source and offers only future dates with recorded capacity. If stale, unavailable or full, it explains that; stop the save test rather than inventing a date.'),
 ('You: I prefer [one of the dates actually offered].', 'Agent retains the chosen date and confirms the vehicle and requested work. With more than one vehicle, it must resolve the vehicle first.'),
 ('You: It is for RW112, a routine service, preferably at noon.', 'Agent treats 12:00 as a preferred time, not an available or reserved slot. It reads back date, registration and work, then asks whether to save.'),
 ('You: Yes, please save it.', 'A clear positive answer to that read-back triggers a save attempt. Agent reports the actual request reference and pending status, or explains failure. Okay alone is not a save receipt.'),
 ('You: Has my existing appointment changed? Is this confirmed in Pentana?', 'Expected: existing booking unchanged; local request pending Service confirmation. No exact time or capacity is reserved.'),
]
for q,a in steps:qa(q,a)
label('Verify the actual write')
txt('Database: <b>Purnell_Pentana_VoiceAgent</b><br/>Collection: <b>voice_appointment_requests</b><br/>Find the returned request_id and check customer_id, vehicle_rego, requested_date, preferred_time, reason and created_at.',10)
txt('Expected status: <b>pending_service_confirmation</b>. booking_confirmed, time_slot_verified, capacity_reserved and pentana_write_performed must remain false. A successful save is not evidence that staff have received or actioned it.',10)
txt('Repeat the same confirmation only to check retry protection; it should return the same pending request rather than duplicate that draft. If you change details, require a new read-back and confirmation.',10)

start('Independent testing / acceptance','Test other records with confidence',
      'The five examples are starting points, not a limit on testing.')
label('Use your own known database details')
txt('<b>If you know the details of another authorised customer record in the database, you may also test the agent using that record.</b> Use its stored phone number, full account name, vehicle registration and linked repair or appointment reference. Compare the answer with the same source record, not with memory.',11)
label('A repeatable check')
for s in [
 'Select a customer in customers and confirm the vehicle link. Enter the stored mobile in the demo; if unmatched, provide name and registration.',
 'For existing bookings, compare erapower_current_appointments.data: appt_no, rego_no, date_in, in and op_code_description. Multiple operation rows can belong to one appointment.',
 'For repair enquiries, compare repairorders and pentana_repair_job_narratives by RO number. Distinguish complaints, work instructions, causes and corrections.',
 'Ask the reference, advisor and date on separate turns. Check that the agent remembers verification and does not reveal another customer\'s records.',
 'Ask a deliberately unsupported question about price, part arrival or readiness. It should acknowledge missing evidence rather than invent an answer.',
]:txt(escape(s),10,gap=8)
label('Record the outcome')
txt('For each test note: customer/registration, test time and timezone, exact question, expected source fact, actual spoken answer, pass/fail and any returned request reference. Record only information needed for authorised testing.')
label('Current boundaries')
txt('The browser test simulates caller ID and uses external database/AI services. It is not a real inbound 3CX call. Daily capacity is not an exact-slot reservation. A pending request does not modify Pentana. Imported status is not a current diagnosis, warranty approval, quote, parts receipt or collection guarantee.')
label('Source and verification')
txt('Prepared from direct read-only MongoDB queries against Purnell_Pentana_VoiceAgent. Sources: customers; repairorders; pentana_repair_job_narratives; erapower_current_appointments (latest-report rows); voice_appointment_requests. No customer record was modified while preparing this guide.',9,GREY)
txt('Read timestamp: '+escape(data['verified_at'])+' UTC. Dates in dd/mm/yyyy format are Australian day/month/year. Appointment times are Sydney local time. Source snapshots can change after this guide is issued; recheck before treating a changed answer as a defect.',9,GREY)
c.save()
print(OUT)
