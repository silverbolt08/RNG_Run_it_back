# Which free LLM to use

**Choice:** `gemini-3.5-flash-lite`, with `gemini-2.5-flash` as a backup when it is busy. Both are set in `src/server/config.ts`, and `LLM_MODEL` overrides them.

**How it was chosen:** `scripts/advisor-live-eval.ts` sends each of our own 31 scenarios to a real model, then lets our engine decide from what the model read. A pass means the engine reached the expected products and blocks. These are our own scenarios, not the judges' private ones, so a high score here doesn't predict theirs.

| Model | Passed | Median time | Note |
|---|---|---|---|
| `gemini-3.5-flash-lite` | 26 of 31, then 29 of 31 after tightening the prompt | About 1.6 s per reading | No quota errors |
| `gemini-2.5-flash` | 16 of 31 | About 3.6 s | Reached its free quota after about 20 calls, which caused 11 of its 15 failures |
| `gemini-3.1-flash-lite` | One call only | 7.7 s | Too slow to pursue |
| `gemma-4-31b-it` | One call only | 31 s | Too slow, and misread a city |
| `gemini-3.5-flash`, `gemini-flash-latest`, `gemini-3.8-flash` | One call only | | Returned 503 when tried |
| `gemini-2.5-flash-lite` | | | Listed by the API, but returned 404 |

**The two remaining misses on the last run**, both handled since by a prompt example or code, and not yet re-measured:

- S01: "achha internet for UPI" was read as wanting a billing counter, which would have added an extra line for the owner to remove.
- S23: "I want vehicle tracking and nothing else" still added broadband. Code now reads this as no connection.

**Full conversations:** `scripts/advisor-live-conversations.ts` then ran all 31 through the running app, with follow-up answers tapped, on 2026-11-05.

| Measure | Result |
|---|---|
| Conversations completed | 31 of 31 |
| Replies using the model's words, after the guard | 62 of 62 sampled (first and last in each chat) |
| Scenarios reaching the expected bundle | 24 of 25. S19's owner declined to give GST details, and was asked again. That is now fixed, and not yet re-run live |
| Off-script messages that changed a rule or price | 0 of 6 |

**Free quota:** a third full pass the same day stopped working after S09, with every model returning `429 RESOURCE_EXHAUSTED`. Google's free daily quota had run out after several hundred calls across that day's testing. All 31 conversations still finished without an error, on templates and tappable answers, which is the fallback working as designed. It does mean these fixes haven't been re-run live: the repeated GST question (S19), the leased line asked for alongside "ignore your rules" (X02), and the prompt changes for S01. A tapped answer leading to the next question now spends no LLM call in English or Hindi, to make the quota last.

That was one run on one day. Quotas and model names on the free tier change without notice, and an earlier run hit a moment when both models were unavailable, so run this again before the demo. The replies are in `analytics/output/advisor-live-replies.json`, and read well in English and Hinglish. The Hindi needs a native speaker's review.

**Local backup:** a local model through Ollama was proposed as a backup, but isn't installed or built. It would need its own adapter behind `LlmProvider` and about 5 GB. If the LLM is unavailable, the journey already continues on tappable answers and the short form.

**Terms to remember:** on Gemini's unpaid tier, [Google may use content to improve its products and human reviewers may read it](https://ai.google.dev/gemini-api/terms). That's why identifiers are removed first and the notice tells owners not to share names. It needs revisiting before any real customer data is used.
