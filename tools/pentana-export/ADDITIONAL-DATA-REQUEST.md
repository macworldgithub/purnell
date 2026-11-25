# Additional Pentana and 3CX data request

Prepared 29 October 2026 for Purnell Motors. This request supplements the Pentana CSV snapshot dated 26 October 2026. It has been prepared locally and has not been sent to a third party.

Please provide the following through an approved read interface, report export, or appropriate read access for the existing extraction account. For each field, confirm its source, meaning and availability. Where a field is unsupported, identify that explicitly rather than returning a false value or an unexplained blank.

## 1. Parts orders and receipts — highest priority

The existing account was explicitly denied access to Parts Requests. Please grant the appropriate read/report access or provide an authorised export.

Requested tables:

- `parts_order_lines.csv`: dealership/branch ID, parts order ID, stable line ID, linked customer ID, RO number, vehicle serial/VIN or registration, part number and description, quantity ordered, quantity received, current line status and expected arrival date/time.
- `parts_receipts.csv`: stable receipt ID, parts order ID and line ID, quantity received, actual receipt date/time, and any reversal/correction indicator. Multiple partial receipts must remain separate.

Please identify cancelled/backordered/substituted lines, explain whether expected arrival values are estimates or confirmed, and identify the source rule for all required parts having arrived. Link receipts to the original lines so partial arrivals and repeat notifications can be handled correctly.

## 2. Vehicle completion and collection

`vehicle_collection_status.csv`: dealership/branch ID, RO number, vehicle identifier, explicit ready-for-collection flag/status, confirmed work completion date/time, confirmed collection appointment date/time where recorded, actual collection date/time where recorded, and confirming staff ID where available.

Please distinguish estimated completion, confirmed completion, ready for collection, and actual collection. Existing promised dates, invoicing and workshop statuses do not independently establish these facts.

## 3. Authorised contacts

`authorised_contacts.csv`: stable authorisation/contact ID, linked customer ID, contact name, relationship, permitted vehicle/RO scope where applicable, permission to receive vehicle information, permission to approve work, approval limits where applicable, effective/expiry dates and revoked status.

Please supply the authoritative permission meaning and any identity-verification requirements. Joint names and previous contact-history entries must not be treated as permission records.

## 4. Customer context and callbacks

- `customer_context.csv`: customer ID, VIP flag, open warranty flag, open complaint flag, callback flag, customer-since date, last purchase date/reference and assigned sales executive ID.
- `customer_callbacks.csv`: callback ID, linked customer/vehicle/RO IDs, current callback status, owner staff ID, promised callback date/time and completion date/time where available.
- Where flags relate to separate cases/jobs, include their stable references and definitions, or provide the corresponding linked records.

The previous run checked warning/contact-history screens for 243 customer contexts and returned no entries. That result does not establish the requested structured flags. Please distinguish false, unknown, unavailable and not applicable.

## 5. Staff routing and live availability

`staff_routing.csv`: staff ID, name, active status, role, department/franchise, queue ID/name, extension and customer/advisor assignment references where recorded.

For 3CX, please identify the approved interface and provide the mapping between Pentana staff IDs and 3CX users/extensions/queues. Live availability should include its source timestamp and documented meaning, including queue membership and logged-in state where supported. A static CSV can document routing but cannot guarantee current call availability.

The existing advisor export supplies 10 selector IDs/names, not a complete routing directory.

## 6. Booking availability — conditional on offering or creating bookings

`booking_slots.csv` or an approved availability response: stable slot/reference ID where available, date/time and duration, timezone, franchise/department, advisor, supported job type, available capacity and capacity unit, availability timestamp and any expiry/hold rules.

Please explain the relationship between job duration, diary capacity and a genuinely bookable time. The existing appointment report and aggregate capacity hours do not establish individual slots. Creating bookings also requires a separately defined write interface and a fresh availability check at booking time.

## Common delivery and refresh requirements

- Preserve customer IDs, RO numbers, order/line IDs, staff IDs and vehicle identifiers as text, including leading zeroes. Include dealership/branch IDs wherever identifiers are not globally unique.
- Supply a data dictionary, status-code definitions, timezone, units, relationship keys and null-value meanings.
- Include source update timestamps where available and an extraction timestamp for each export. Document whether each export is a full snapshot or a change feed, and its filters and coverage.
- For change feeds, provide a reliable cursor/watermark and deletion, cancellation and reversal handling. For snapshots, document how disappearance from a filtered view should be interpreted.
- Agree the required freshness and supported refresh method for repair status, parts receipts, appointments and routing. Use current source checks for current-status answers; retain timestamps so stale results can be identified.
- For parts-arrival SMS, provide stable receipt/change identifiers, permitted communication/consent fields and correction handling so the same arrival is not notified repeatedly. This request does not enable or send SMS.

The current export covers records linked to its open-RO, appointment and vehicle-history scope. Please confirm whether these supplementary exports use the same linked scope or a separately specified dealership-wide scope.

## Acceptance checks

Confirm access and supported fields before extraction. Reconcile exported totals with the source reports; verify stable keys, partial receipt quantities and joins to existing customers, vehicles and ROs. Record unmatched references for review. Report unavailable fields explicitly. Retain report filters, source timestamps and counts with each delivery.
