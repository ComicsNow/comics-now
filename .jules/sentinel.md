## 2026-10-25 - Validation of Gemini Daily Quota Cap Input
**Vulnerability:** `geminiCoverDailyCap` in `POST /api/v1/gemini/config` was parsed via `parseInt` without verifying integer bounds, allowing invalid, negative, or `NaN` values to be saved to SQLite `settings`.
**Learning:** Storing `NaN` as string `"null"` in settings caused downstream quota checks (`usage >= dailyCap`) to evaluate to `false`, effectively bypassing daily API quota limits. Negative values permanently locked AI requests.
**Prevention:** Validate integer inputs using `Number.isInteger()` and strict range checks (`1 <= cap <= 10000`) before persisting configuration parameters.
