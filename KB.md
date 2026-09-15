# Purnell Motors Knowledge Base

## 1. Who We Are

Purnell Motors Pty Ltd — family-owned prestige dealership, Blakehurst, southern Sydney. Founded 1951. Continuous family ownership since 1974. Longest-standing family-owned Jaguar and Land Rover dealership in Australia. National Dealer of the Year (2018, 2018/19 — first to win back-to-back). 2020–21 National Retailer of the Year.

**Positioning line:** *"Purnell Jaguar Land Rover INEOS Blakehurst — It just gets Better."*

### Websites
- **Main:** [purnellmotors.com.au](https://purnellmotors.com.au)
- **Stock locator:** [stock.purnellmotors.com.au](https://stock.purnellmotors.com.au)
- **Land Rover retailer:** [retailers.landrover.com.au/purnell](https://retailers.landrover.com.au/purnell)
- **Jaguar retailer:** [retailers.jaguar.com.au/purnell](https://retailers.jaguar.com.au/purnell)
- **Omoda Jaecoo:** [www.omodajaecoopurnell.com.au](https://www.omodajaecoopurnell.com.au)
- **Service booking:** [purnellmotors.com.au/book-a-service](https://purnellmotors.com.au/book-a-service)
- **Test drive booking:** [purnellmotors.com.au/book-test-drive](https://purnellmotors.com.au/book-test-drive)

---

## 2. Franchises

| Brand | Notes |
| --- | --- |
| **Jaguar** | Authorised retailer and authorised repairer. Performance and design. |
| **Land Rover** | Range Rover, Range Rover Sport, Defender, Discovery and related models. Authorised retailer and repairer. |
| **INEOS Grenadier** | Sydney home base. Branded Purnell Adventure. Station Wagon + Quartermaster (ute/cab-chassis). Towing: 3.5 t. Loadspace: 2,000 L. Winching: 5.5 t. Built at Hambach, France. |
| **Omoda and Jaecoo** | Adjacent franchise. 996 King Georges Road. Separate price ladder, separate service book. Do not apply JLR service intervals or booking diary to Omoda. |
| **Prestige Pre-Owned** | Jaguar, Land Rover, INEOS and other prestige/luxury marques. Range Rover APO: full service history + 165-point inspection. |
| **Classic restoration** | Factory-trained technicians on Jaguar and Land Rover from 1948. Specialists in Defender and classic Range Rover. Authentic restoration or sympathetic modernising. |

---

## 3. Locations and Hours

### Campus Addresses

| Campus | Address |
| --- | --- |
| **JLR / INEOS showroom & service** | 990 King Georges Road, Blakehurst NSW 2221 |
| **Purnell Adventure / INEOS** | 996 King Georges Road, Blakehurst NSW 2221 |
| **Omoda Jaecoo Purnell** | 996 King Georges Road, Blakehurst NSW 2221 |

*Note: Treat 990 and 996 as one Blakehurst campus. If a JLR service client is on site but at the wrong door, invite them to reception at 990.*

### Published Hours
*(Engineering: bind to live config at runtime — not this document)*

| Department | Mon–Fri | Saturday | Sunday |
| --- | --- | --- | --- |
| **JLR / INEOS sales & service** | 7:30 am – 5:30 pm | Closed | Closed |
| **Omoda Jaecoo sales** | 8:30 am – 5:30 pm | 9:00 am – 4:30 pm | Closed |
| **Omoda Jaecoo service** | 7:30 am – 5:30 pm | Closed | Closed |

**Rules:**
- **Last test drive:** 4:00 pm (all brands).
- **Sunday collection:** Not available.
- **After hours:** Take message, confirm best number, set expectation of morning call from correct department.

---

## 4. Phone and Email Directory

| Function | Phone | Email |
| --- | --- | --- |
| **Main switchboard / JLR sales** | (02) 8558 7000 | landrover@purnellmotors.com.au |
| **Sales enquiries** | (02) 8558 7070 | sales@purnellmotors.com.au |
| **Service (JLR / general)** | (02) 8558 7000 | service@purnellmotors.com.au |
| **INEOS / Purnell Adventure** | (02) 8558 7070 | sales@purnelladventure.au · service@purnelladventure.au |
| **Omoda Jaecoo sales & service** | (02) 8558 7090 | sales@purnellomodajaecoo.com.au · service@purnellomodajaecoo.com.au |
| **Jaguar Roadside Assistance** | 1800 819 181 | 24/7 manufacturer RSA — not the dealership workshop |
| **Land Rover Roadside Assistance** | 1800 808 180 | 24/7 manufacturer RSA. In-car SOS / breakdown button also available. |

*Never give out personal mobile numbers. Transfer or take a message against the switchboard only.*

---

## 5. People Directory (Public-Facing — Warm Transfer Only)

| Name | Role | Contact |
| --- | --- | --- |
| **Rodney Dale** | Dealer Principal | Via switchboard |
| **Aaron Gabriel** | General Manager | Via switchboard |
| **Jenson Milne** | Sales Manager | jensonm@purnellmotors.com.au |
| **Nate Miles** | Sales Manager | Via switchboard |
| **Paul Fahd** | Pre-Owned Manager | Via switchboard |
| **Colin Whybro** | Premium Client Manager | Via switchboard |
| **Grant Coles** | Business Manager (Finance) | Via switchboard |
| **Francesca Paset** | Reception / Concierge (human counterpart) | Via switchboard |
| **Alex Collo** | Brand Manager, INEOS | (02) 8558 7070 |
| **Anja Ruzic** | Sales Executive | anjar@purnellmotors.com.au |
| **Alan Tran** | Sales Executive | Via switchboard |
| **Nunzio Burrelli** | Parts Manager | nunziob@purnellmotors.com.au |
| **Kamal Ghassah** | Assistant Service Manager | Via switchboard |
| **Robert Suto** | Service Advisor | Via switchboard |
| **Jamie Drummond** | Service Advisor | Via switchboard |
| **Matthew Thompson** | Warranty Manager | Via switchboard |
| **Sherwyn Munsamy** | Workshop Manager | sherwynm@purnellmotors.com.au |
| **George Godfrey** | Workshop Controller | georgeg@purnellmotors.com.au |

---

## 6. Mock Data Schema (Pentana Replacement — Bind to Real DB at Go-Live)

These are the objects your backend must populate and inject into the context window. Until Pentana access is live, seed from the mock DB using the same field names so no prompt changes are required at cutover.

### 6.1 Customer Record
```json
{
  "customer_id": "CUS-00123",
  "customer_name": "James Chen",
  "preferred_name": "James",
  "customer_since": "2018-03-14",
  "mobile": "+61412345678",
  "landline": null,
  "email": "james.chen@example.com",
  "consent_sms": true,
  "consent_marketing": false,
  "vip": false,
  "complaint_open": false,
  "awaiting_callback": false,
  "vehicles": [
    {
      "rego": "ABC123",
      "vin": "SALGA2EF3PA123456",
      "year": 2022,
      "make": "Land Rover",
      "model": "Defender 110",
      "colour": "Carpathian Grey",
      "assigned_advisor": "Kamal Ghassah",
      "assigned_sales": "Anja Ruzic"
    }
  ]
}
```

### 6.2 Repair Order (RO)
```json
{
  "ro_number": "RO-45821",
  "customer_id": "CUS-00123",
  "vehicle_rego": "ABC123",
  "status": "awaiting_parts",
  "drop_off_date": "2026-09-10",
  "eta": null,
  "advisor": "Kamal Ghassah",
  "awaiting_approval": false,
  "awaiting_parts": true,
  "ready_for_collection": false,
  "loan_vehicle": {
    "active": true,
    "rego": "LV-LOAN-07",
    "make": "Land Rover",
    "model": "Discovery Sport"
  },
  "job_lines": [
    {
      "description": "Front sensor replacement",
      "status": "parts_ordered",
      "parts_eta": "2026-09-16"
    }
  ],
  "workshop_notes": "Sensor backordered — ETA confirmed with Nunzio 15 Sep."
}
```

**Valid status values:** `booked_not_arrived` | `checked_in` | `awaiting_approval` | `awaiting_parts` | `quality_check` | `ready_for_collection` | `loan_vehicle_out` | `completed` | `no_open_activity`

### 6.3 Service Booking
```json
{
  "booking_id": "BK-9901",
  "customer_id": "CUS-00123",
  "vehicle_rego": "ABC123",
  "date": "2026-09-22",
  "time": "08:00",
  "advisor": "Robert Suto",
  "job_type": "Annual service",
  "loan_car_requested": true,
  "loan_car_confirmed": false,
  "collection_suburb": null,
  "collect_and_return": false,
  "status": "confirmed"
}
```

### 6.4 Parts Order
```json
{
  "parts_order_id": "PO-7711",
  "ro_number": "RO-45821",
  "customer_id": "CUS-00123",
  "vehicle_rego": "ABC123",
  "lines": [
    {
      "part_number": "LR123456",
      "description": "Front parking sensor",
      "status": "ordered",
      "arrived": false,
      "arrival_date": null,
      "fitment_booked": false
    }
  ],
  "notify_on": "first_arrival",
  "sms_sent": false,
  "suppress_until": null
}
```

**Parts status values:** `ordered` | `in_transit` | `arrived` | `ready_for_fitment` | `fitted` | `back_ordered`

### 6.5 SMS Notification Record
```json
{
  "notification_id": "SMS-3301",
  "customer_id": "CUS-00123",
  "parts_order_id": "PO-7711",
  "sent_at": null,
  "status": "pending",
  "message_template": "parts_arrived_v1",
  "booking_created": false,
  "booking_id": null,
  "opted_out": false
}
```

### 6.6 System Availability Flag
```json
{
  "dms_available": true,
  "crm_available": true,
  "booking_api_available": true,
  "parts_api_available": true,
  "last_sync": "2026-09-15T08:45:00+10:00"
}
```

*If `dms_available: false` → use the "System unavailable" vocabulary. Never invent data. Offer warm transfer to Service.*

---

## 7. Intent Taxonomy (17 Intents — All Must Appear in Logging/Reporting From Day One)

| # | Intent Label | Risk / Category |
| --- | --- | --- |
| 1 | `book_service` | High volume |
| 2 | `book_recall` | High volume |
| 3 | `parts_arrival_query` | High volume |
| 4 | `parts_quote` | High volume |
| 5 | `collection_query` | High volume |
| 6 | `transfer_to_person` | High volume |
| 7 | `stock_availability` | Mandatory pre-go-live |
| 8 | `test_drive_confirm_arrival` | Mandatory pre-go-live |
| 9 | `hours_location` | High volume |
| 10 | `driving_safety` | Mandatory / Safety critical |
| 11 | `post_service_complaint` | High risk |
| 12 | `deposit_request` | Mandatory / Commercial risk |
| 13 | `finance_rates` | High risk |
| 14 | `loan_car` | Controlled promise |
| 15 | `keys_paperwork_invoice` | Security & financial |
| 16 | `trade_in_early_drop` | Deal ownership |
| 17 | `preowned_sales` | Routing |

---

## 8. Service Knowledge

### What to Capture for Every Service Request
- Name, mobile, email
- Registration and/or VIN, odometer if known
- Make / model / year
- Concern in the client's words, plus warning lights
- Preferred date window and drop-off time
- Loan vehicle: yes/no, and licence held
- Collect-and-return: suburb, home or work
- Warranty / packaged service plan / extended cover status
- Existing Purnell client (if identity pass failed)

### Booking Rules
- **Weekday:** Collect details, offer real slots from booking API, confirm date/time/site.
- **Saturday / after-hours:** Collect details, advise Service will call Monday. Do not invent a slot.
- **Omoda Jaecoo:** Bookings required at least 3 days in advance. Do not apply this rule to JLR.
- **Online booking path:** [purnellmotors.com.au/book-a-service](https://purnellmotors.com.au/book-a-service) or JLR retailer booking tool.

### Loan Cars
- Subject to availability and current licence.
- Never guarantee a like-for-like vehicle (e.g. Range Rover Autobiography as loan).
- Say: *"a suitable courtesy vehicle, confirmed by Service."*
- Record loan car request against the service booking and repeat only what the system has confirmed.

### Recall / Campaign Bookings
- Follow the standard service booking process. Verify eligibility via OEM campaign tool if integrated; otherwise book an inspection.
- Do not promise recall work can be completed without eligibility and workshop confirmation.
- **Two vehicles on one drop-off:** Supported where booking system permits.

### Parts
- **Default recommendation:** Genuine parts only.
- **Genuine Land Rover parts fitted by authorised retailer:** 12 months / unlimited km against manufacturing defects (confirm current wording at runtime).
- Route all parts queries to **Nunzio Burrelli**. Capture VIN before quoting body-coloured or VIN-specific part.
- Do not quote a price, substitute a part, advise technical suitability, or read an unverified figure from memory.

### Warranty
- Route to **Matthew Thompson** (Warranty Manager).
- May take description + mileage and open a job for assessment.
- Never tell a client *"that will / will not be covered"* before the claim is assessed.

### Classic Restoration
- Jaguar and Land Rover from 1948. Defender and classic Range Rover specialists.
- **Path:** (02) 8558 7000 / `service@purnellmotors.com.au`
- **Capture:** Year, model, chassis if known, concours-correct vs usable restomod intent.

---

## 9. Sales Knowledge

### New Vehicle Families

| Model | Key Notes |
| --- | --- |
| **Range Rover** | Flagship luxury SUV. *"Hasn't been reimagined, it's simply been made better."* |
| **Range Rover Sport** | Performance-luxury SUV. |
| **Defender** | 90 / 110 / 130. Capability icon. Purnell has long Defender heritage incl. classic restoration. |
| **Discovery** | Family / travel SUV, capability with comfort. |
| **Jaguar** | Performance and design. Read current retail range from live JLR catalogue at runtime. Do not recite discontinued model years. |
| **INEOS Grenadier** | *"A serious off-roader, built from the ground up."* Station Wagon + Quartermaster. Towing: 3.5 t. Loadspace: 2,000 L. Winching: 5.5 t. |
| **Omoda / Jaecoo** | Separate franchise next door. Different price ladder, different service book. |

### Test Drives
- **Required info:** Full name, mobile, email, preferred model, new or pre-owned, preferred day/time, current licence.
- Do not promise a specific demonstrator until Sales confirms it is on the floor and not in use.
- **INEOS drives:** Purnell Adventure booking on (02) 8558 7070.
- **Last test drive:** 4:00 pm.
- Book via [purnellmotors.com.au/book-test-drive](https://purnellmotors.com.au/book-test-drive) or a sales executive.

### Pre-Owned
- **Site language:** *"Our Pre-Owned Promise: As alive as when first created."*
- **Range Rover APO:** Full service history + 165-point inspection.
- Direct clients to [stock.purnellmotors.com.au](https://stock.purnellmotors.com.au) — do not list vehicles from memory.
- **Appraisals:** Paul Fahd. Collect: owner name, contact, year/make/model, km, service history, finance payout if any, when they want to change.

### Finance
- **Products:** Consumer loan, novated lease, balloon, Land Rover Guaranteed Future Value (GFV).
- May explain categories in plain language. Never state an interest rate, comparison rate, or repayment figure.
- Refer to published Target Market Determination rather than interpreting suitability.
- **Business Manager:** Grant Coles.

### Connected Services
- Jaguar InControl / Land Rover equivalents.
- **For live emergency SOS/breakdown button:** Give RSA numbers immediately.
- **For app pairing issues:** Book a Service or Sales walkthrough. Do not attempt remote diagnostics.

---

## 10. What the Agent May Answer Directly (FAQs)

| Question | Answer |
| --- | --- |
| **Where are you?** | 990 King Georges Road, Blakehurst NSW 2221. Omoda Jaecoo and Purnell Adventure at 996 on the same strip. |
| **How do I get there?** | King Georges Road, southern Sydney. Offer to send a maps pin. Do not invent parking instructions not in config. |
| **What brands?** | Jaguar, Land Rover, INEOS Grenadier, Omoda Jaecoo, and a curated prestige pre-owned selection. |
| **Can you service a Jaguar I bought elsewhere?** | Yes — authorised repairer. Bring the vehicle and the history. |
| **Do you service other makes?** | Prestige pre-owned of other marques is sold. Workshop capability should be confirmed with Service. Omoda Jaecoo Purnell services all makes — do not extend that claim to the JLR workshop. |
| **Do you have loan cars?** | Yes, subject to availability. |
| **Can you pick the car up?** | Yes, concierge collect-and-return can be arranged — Service confirms. |
| **Is Saturday open?** | Use live hours. Published JLR site: Saturday closed. Omoda sales: Saturday 9:00–4:30. |
| **How do I book a service online?** | [purnellmotors.com.au/book-a-service](https://purnellmotors.com.au/book-a-service), the JLR retailer booking tool, or this assistant can take the request. |
| **Roadside?** | Jaguar 1800 819 181. Land Rover 1800 808 180. In-car SOS / spanner button also available. |
| **I want to sell my car.** | Pre-owned desk, Paul Fahd. We are buying prestige stock. |
| **Who owns the business?** | Family-owned since 1974. Dealer Principal Rodney Dale. |

---

## 11. What the Agent Must Never Invent

- A price, drive-away figure, or *"we'll beat that quote"*
- A finance rate, balloon, or *"you'll get approved"*
- A workshop ready-time not on the RO
- That a job is covered by warranty
- That a part is in stock
- That a particular demonstrator is available this afternoon
- Staff rosters, salaries, or who is *"in a meeting"* — beyond: *"They are with a client — I can take a message or try them."*
- Legal positions on accidents, police reports, or insurance liability
- Medical or safety advice beyond: *"Please stay with the vehicle if it is safe, and call RSA / 000 if anyone is hurt."*

---

## 12. Conversation Patterns

### Inbound Voice (After Identity Pass)
1. Greet with house name.
2. If identified, speak the context.
3. One clarifying question.
4. Either resolve, book, or transfer with a spoken summary.
5. Confirm the next step and the name of the human if transferring.

### Web Chat / SMS
- Same logic, shorter lines.
- Offer tap-targets: `"Update on my car"` · `"Book a service"` · `"New vehicle"` · `"Parts"` · `"Speak to someone"`
- **SMS:** Obey ACMA. Identified sender, opt-out path, no marketing on a service thread unless consented.

### After Hours
- Identify → structured message → confirm number → set expectation of morning call from correct department.
- **Breakdown:** RSA numbers.
- **Vehicle on site after close:** Message for George Godfrey (Workshop Controller). Do not guess gate codes.

### Transfer Briefing Format (Spoken to Human, Then Connect)
> *"[Name], I have [customer] on the line. [Vehicle: make/model, rego]. [RO number]. [One-sentence reason]. [Key context]. I have not promised [time / price / availability]."*

---

## 13. Evaluation Criteria (Best-in-Class Bar)

The system is not best-in-class unless all of the following are true in production:
- On a call from a known mobile, the agent greets by name and mentions the open RO before the caller explains themselves — in >80% of identifiable cases.
- The agent never states a ready-time not supplied by the DMS.
- Transfers include a full briefing. The client does not repeat their story.
- JLR, INEOS and Omoda Jaecoo are never mixed in the same booking diary.
- After-hours breakdown callers receive RSA numbers within the first 20 seconds.
- Mystery-shop transcripts read like Blakehurst reception, not a generic OEM bot.

---

## 14. SMS Notification Templates (Module 4.2)

### `parts_arrived_v1`
```text
Hi [FirstName], great news — the parts for your [Year] [Make] [Model] ([Rego]) have arrived at Purnell Motors Blakehurst.
Reply BOOK to schedule fitment, or call us on (02) 8558 7000.
Reply STOP to opt out.
Purnell Motors, 990 King Georges Rd, Blakehurst.
```

### `booking_confirmed_v1`
```text
Hi [FirstName], your fitment booking is confirmed for [Date] at [Time] at Purnell Motors Blakehurst (990 King Georges Rd).
Questions? Call (02) 8558 7000. Reply STOP to opt out.
```

### `callback_taken_v1`
```text
Hi [FirstName], [DepartmentName] at Purnell Motors will call you back on this number by [CallbackTime].
Reference: [IntentLabel]. Call (02) 8558 7000 if urgent.
```

---

## 15. Source Notes and Refresh Cadence

| Data Type | Refresh Frequency |
| --- | --- |
| **Staff roster and hours** | Monthly |
| **Vehicle offers / pricing** | Weekly |
| **This playbook** | After any franchise change, DMS cutover, or mystery-shop failure |
| **Hours, stock, RO status, staff availability** | Live systems — never this document |

*Engineering must bind hours, stock, RO status and staff rosters to live systems. This document is the knowledge layer only — not the source of truth for runtime data.*