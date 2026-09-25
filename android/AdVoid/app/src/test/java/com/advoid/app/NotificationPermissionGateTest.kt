package com.advoid.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPermissionGateTest {
    @Test
    fun `asks on the first playback of a fresh install`() {
        assertTrue(
            NotificationPermissionGate.shouldRequest(
                apiLevel = 34,
                granted = false,
                askedThisSession = false,
                askedBefore = false,
            ),
        )
    }

    @Test
    fun `never asks below the notification permission API level`() {
        assertFalse(
            NotificationPermissionGate.shouldRequest(
                apiLevel = 32,
                granted = false,
                askedThisSession = false,
                askedBefore = false,
            ),
        )
    }

    @Test
    fun `does not ask once granted`() {
        assertFalse(
            NotificationPermissionGate.shouldRequest(
                apiLevel = 34,
                granted = true,
                askedThisSession = false,
                askedBefore = false,
            ),
        )
    }

    @Test
    fun `asks at most once per session`() {
        assertFalse(
            NotificationPermissionGate.shouldRequest(
                apiLevel = 34,
                granted = false,
                askedThisSession = true,
                askedBefore = false,
            ),
        )
    }

    @Test
    fun `never asks again after a previous install-scoped ask`() {
        // A repeated prompt after a denial would cover the app and break PiP.
        assertFalse(
            NotificationPermissionGate.shouldRequest(
                apiLevel = 34,
                granted = false,
                askedThisSession = false,
                askedBefore = true,
            ),
        )
    }
}
