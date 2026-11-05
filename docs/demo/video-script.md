# Demo video script

3 minutes at most. Record at phone width in a browser's device mode, or on a real phone. The timings follow the blueprint's shot list.

**Before recording:**

1. Run `npm run dev`, and check the advisor answers a typed message. If Gemini is busy, wait a minute.
2. Open a private window, so you start with a new session.
3. Have `K03_*.png` and `K01_*.png` from the data pack ready to upload, and the contact names from `tests/fixtures/kyc/specimens.json`.
4. Open `/backoffice` in another tab, with `ADMIN_TOKEN` from `.env.local`.

| Time | Show | Say |
|---|---|---|
| 0:00 to 0:15 | The home screen | "7 of 100 small business leads activate today, at ₹15,053 each and 17.6 days. Most drop out at the quote. Here's an owner buying alone, on a phone." |
| 0:15 to 1:00 | Switch to हिन्दी. Tick both agreements, then type: "Meri kirana shop hai Nagpur mein, 3 log kaam karte hain. GST nahi hai. WhatsApp pe catalogue chahiye" | "It reads Hinglish, and asks only what it still needs. WhatsApp needs a GST registration, so the code blocks it, and the advisor explains why and offers the closest option. The model never decides a rule or types a price." |
| 1:00 to 1:25 | See the quote. Toggle Secure Wi-Fi on, then turn the fibre off | "One final price including GST, updated by code on every toggle. Remove the connection, and what depended on it goes too, with a warning." |
| 1:25 to 2:10 | Accept, use the test code, tick consent, upload K03: verified. Then show K01 in a second window: Cancelled GSTIN, changed quote | "Consent comes first, and the server enforces it. Documents are read on our own server and never reach the AI. A clean applicant passes in seconds. A cancelled registration changes the quote, and the owner chooses to go on." |
| 2:10 to 2:30 | Place the order, then the tracker with a test payment | "What happens next and when, with a date on every stage. This replaces the three chase calls per customer." |
| 2:30 to 2:50 | Back office: handoffs and the ranking. Then the short form, or an outage from the demo controls | "What the advisor can't close goes to a person with the context, so the field team adds to the journey. And if the AI or a registry is down, the owner still finishes." |
| 2:50 to 3:00 | My data | "Withdrawal is one tap. Our model expects activation to roughly double, to about 15%. That's a model with stated assumptions, not a measured result." |

**Check before submitting:** it runs under 3:00, it says plainly what is mocked, and "15%" isn't presented as measured.
