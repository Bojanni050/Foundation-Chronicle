// Shared "does this look like a password" redaction heuristic — a single
// all-caps/mixed-case/digit/symbol token with no spaces. Originally lived
// only in uia_capture.rs; pulled out so clipboard_capture.rs (and any future
// text-capturing source) applies the exact same rule instead of drifting
// copies of it.
fn looks_like_password(token: &str) -> bool {
    if token.len() < 8 || token.contains(char::is_whitespace) {
        return false;
    }
    let has_upper = token.chars().any(|c| c.is_ascii_uppercase());
    let has_lower = token.chars().any(|c| c.is_ascii_lowercase());
    let has_digit = token.chars().any(|c| c.is_ascii_digit());
    let has_symbol = token.chars().any(|c| !c.is_alphanumeric());
    [has_upper, has_lower, has_digit, has_symbol]
        .iter()
        .filter(|&&b| b)
        .count()
        >= 3
}

pub fn redact(text: &str) -> String {
    text.split_whitespace()
        .map(|tok| if looks_like_password(tok) { "[redacted]" } else { tok })
        .collect::<Vec<_>>()
        .join(" ")
}
