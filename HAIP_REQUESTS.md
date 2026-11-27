# Requests for the HAIP team

From the StayX POS / kitchen display team. Checked against HAIP `439956d`, 2026-11-27.
Details, evidence and proposed API shapes are in `INTEGRATION_DESIGN.md` (§5.2 for R1–R8, §7 for Q/N, §9 for alerts) and `AUDIT.md`.

**Today, without any of these:** staff confirm the guest against HAIP before ordering (read-only service principal), each charge is re-checked before it is posted by room, and anything unsafe is parked for a manager. That is safe for a pilot, but not production-ready.

## 1. Blocking

**R1 + R2: guest self-ordering**
- **Problem:** a guest ordering from their room's QR code can't be matched to their stay without POS reading every guest's phone number.
- **We need:** R1 `POST /folio-inbound/stays/verify` (room + phone → match / no match, never the phone itself), with R1b/c (a one-time code) later. Also R2 `GET /folio-inbound/stays/{reservationId}` (in house? room? open folio?).
- **Unblocks:** Phase 2 guest self-ordering, and dropping our broad read-only service principal.

**Q3: a duplicate `vendorTxnId` gives a 500**
- **Problem:** re-sending the same charge returns 500. Your docs say it returns the existing charge.
- **We need:** a duplicate `vendorTxnId` to return the existing charge (200/201 with its id), as documented.
- **Unblocks:** safe automatic retries. Today a lost reply turns into a "failed" charge that a manager must check by hand.

**R8 / N9: read routes don't check permissions**
- **Problem:** our service principal, linked with only `reservations.read` and `folios.read`, can still read `GET /guests/:id`, including phone numbers (confirmed live).
- **We need:** `@RequirePermissions` on the guest and reservation GET routes.
- **Unblocks:** a least-privilege POS principal, which our privacy review needs before go-live.

## 2. Needed before production

**N14: POS staff login in the shared realm**
- **Problem:** POS and kitchen login is built and checked only on our local copy of the `haip` realm.
- **We need:** approval of:
  - client `stayx-pos-api` with roles `pos_staff`, `pos_kitchen` and `pos_manager`;
  - public clients `stayx-pos-web` and `stayx-kms-web`;
  - a `property_ids` user attribute. Keycloak 24 drops it unless the user profile allows it, so either declare it or use unmanaged attributes "admin edit".

  Also, who creates and disables POS users.
- **Unblocks:** staff login in production.

**N16: the realm's 10-hour session limit**
- **Problem:** a client can't have a longer session than the realm's 10-hour maximum, so a kitchen tablet must sign in again every shift.
- **We need:** a longer realm maximum, or another way, e.g. offline tokens for `stayx-kms-web` only.
- **Unblocks:** kitchen tablets that stay signed in.

**Q6: which tax rule applies to restaurant charges**
- **Problem:** `getActiveTaxProfile` picks the first active profile in no fixed order, and no profile has a `food_beverage` rule.
- **We need:** the intended rule and profile per property, applied deterministically.
- **Unblocks:** correct tax on room-service charges.

**Q7: charges in another currency**
- **Problem:** HAIP accepts a charge whose currency differs from the folio's. POS now refuses that on its side.
- **We need:** HAIP to reject it too (part of R3).
- **Unblocks:** no mixed-currency folios, even from other vendors or bugs.

**Q8 / R7: checkout with charges not yet posted**
- **Problem:** a guest can check out while a POS charge is still waiting to post. It then parks as "stay ended" and the hotel loses it unless staff act.
- **We need:** a warning (or block) at checkout when POS has charges not yet posted.
- **Unblocks:** fewer lost charges, and less manual clean-up.

**Q10: `connect_credentials` on a fresh database**
- **Problem:** the table isn't in `push-schema.ts`, so a fresh install has no folio-inbound keys.
- **We need:** it added to schema setup.
- **Unblocks:** setting up new hotels without hand-made SQL.

## 3. Later

**Q4 / R4: reversing a charge POS posted**
- **Problem:** the only way today is a principal with `folios.manage` over every folio.
- **We need:** R4, reversal by `vendorTxnId` for charges the key posted.
- **Unblocks:** voids and refunds after delivery (our item 12).

**Q5 / R5 + R6: reconciliation**
- **Problem:** folio-inbound emits no `folio.charge_posted`, and charges can't be looked up by `vendorTxnId`.
- **We need:** R5 (look up a charge by vendor id) and R6 (`vendorTxnId` in the event).
- **Unblocks:** an exact nightly reconciliation (our item 14). Matching by description works for now.

**N18: manager alerts through HAIP's messaging**
- **Problem:** to tell hotel managers by WhatsApp or SMS that charges need attention, POS would call `POST /notifications/whatsapp` or `/sms`. Those need `communications.manage`, which allows any message to anyone.
- **We need:** a narrower permission or route (only to a hotel's staff contacts, with your consent handling), and who pays for the messages.
- **Unblocks:** WhatsApp alerts for managers away from the POS. Email we can do ourselves (`INTEGRATION_DESIGN.md` §9).

**N15: refresh token rotation**
- **Problem:** in Keycloak 24, rotation is realm-wide only, so it affects the HAIP dashboard too.
- **We need:** rotation on in production. Please test the dashboard with several tabs first: a renewal in one tab invalidates the other tabs' refresh token.
- **Unblocks:** stolen kitchen-tablet tokens stop working sooner.

**Housekeeping**
- **N11:** the Keycloak compose health check never passes. Send `Connection: close`, or check with curl.
- **N12:** the `property_ids` hardcoded-mapper example produces a string, not an array.
- **N13:** there's no `.dockerignore`, so the host's `node_modules` break the image build.
- **N17:** `haip-api-auth` on port 3001 isn't an allowed `haip-dashboard` redirect.
