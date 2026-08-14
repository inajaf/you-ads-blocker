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
    fun `placeholder url is clearly marked and rejected until replaced`() {
        // The captain must replace PRIVACY_POLICY_URL with a real policy before
        // the Play upload. While it is still the placeholder, the affordance
        // refuses to open it (isValidPrivacyPolicyUrl rejects it), so no user is
        // ever sent to a fake policy. This asserts the constant is recognizably
        // a placeholder so it can't be mistaken for the shipped URL.
        assertTrue(PRIVACY_POLICY_URL.startsWith("https://your-site.example"))
        assertFalse(isValidPrivacyPolicyUrl(PRIVACY_POLICY_URL))
    }
}
