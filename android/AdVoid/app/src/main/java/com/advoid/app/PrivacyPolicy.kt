package com.advoid.app

/**
 * Public privacy policy URL, required by Google Play and reachable from the app
 * via the in-app "Privacy policy" affordance (see MainActivity).
 *
 * The policy is published with the landing bundle on GitHub Pages so the URL
 * remains available independently of an app installation.
 */
const val PRIVACY_POLICY_URL: String =
    "https://inajaf.github.io/you-ads-blocker/privacy.html"

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
