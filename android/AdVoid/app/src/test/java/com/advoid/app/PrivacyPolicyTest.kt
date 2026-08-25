package com.advoid.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PrivacyPolicyTest {
    @Test
    fun `placeholder url is rejected`() {
        assertFalse(isValidPrivacyPolicyUrl("https://your-site.example/privacy"))
        assertFalse(isValidPrivacyPolicyUrl("https://your-site.example"))
    }

    @Test
    fun `non-https url is rejected`() {
        assertFalse(isValidPrivacyPolicyUrl("http://example.com/privacy"))
        assertFalse(isValidPrivacyPolicyUrl("javascript:alert(1)"))
        assertFalse(isValidPrivacyPolicyUrl(""))
    }

    @Test
    fun `malformed host is rejected`() {
        assertFalse(isValidPrivacyPolicyUrl("https://"))
        assertFalse(isValidPrivacyPolicyUrl("https:///path"))
        assertFalse(isValidPrivacyPolicyUrl("https://local host"))
        assertFalse(isValidPrivacyPolicyUrl("https://nodots"))
    }

    @Test
    fun `real https url is accepted`() {
        assertTrue(isValidPrivacyPolicyUrl("https://advoid.app/privacy"))
        assertTrue(isValidPrivacyPolicyUrl("https://advoid.app"))
        assertTrue(isValidPrivacyPolicyUrl("https://advoid.app/privacy#policy"))
    }

    @Test
    fun `shipped privacy policy url is public and accepted`() {
        assertTrue(PRIVACY_POLICY_URL.startsWith("https://inajaf.github.io/"))
        assertTrue(PRIVACY_POLICY_URL.endsWith("/privacy.html"))
        assertTrue(isValidPrivacyPolicyUrl(PRIVACY_POLICY_URL))
    }
}
