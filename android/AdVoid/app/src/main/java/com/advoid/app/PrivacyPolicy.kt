package com.advoid.app

/**
 * Public privacy policy URL, required by Google Play and reachable from the app
 * via the in-app "Privacy policy" affordance (see MainActivity).
 *
 * PLACEHOLDER: the captain must replace this with the real hosted privacy
 * policy URL before uploading to Google Play. It must be a valid https:// URL
 * that returns the policy (e.g. "https://<your-site>/privacy").
 */
const val PRIVACY_POLICY_URL: String =
    "https://your-site.example/privacy" // TODO(captain): replace with the real privacy policy URL

/**
 * Returns true when [url] is safe to open for the in-app privacy policy
 * affordance: a well-formed https URL that is not still the unreleased
 * your-site.example placeholder. Kept pure so it's unit-testable.
 */
fun isValidPrivacyPolicyUrl(url: String): Boolean {
    if (!url.startsWith("https://")) return false
    if (url.startsWith("https://your-site.example")) return false
    val rest = url.removePrefix("https://")
    if (rest.isEmpty()) return false
    val host = rest.substringBefore('/').takeIf { it.isNotBlank() } ?: return false
    return host.contains('.') && !host.contains(' ')
}
