package com.advoid.app

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackUiCoordinatorTest {
    private val coordinator = PlaybackUiCoordinator()

    @Test
    fun `playing video hides header and keeps visible activity awake`() {
        coordinator.onActivityVisibilityChanged(true)

        assertEquals(
            PlaybackUiState(headerHidden = true, keepScreenOn = true),
            coordinator.onVideoPlaybackChanged(true),
        )
    }

    @Test
    fun `pausing video restores header and releases keep screen on`() {
        coordinator.onActivityVisibilityChanged(true)
        coordinator.onVideoPlaybackChanged(true)

        assertEquals(
            PlaybackUiState(headerHidden = false, keepScreenOn = false),
            coordinator.onVideoPlaybackChanged(false),
        )
    }

    @Test
    fun `background activity never keeps screen awake`() {
        coordinator.onActivityVisibilityChanged(true)
        coordinator.onVideoPlaybackChanged(true)

        assertEquals(
            PlaybackUiState(headerHidden = false, keepScreenOn = false),
            coordinator.onActivityVisibilityChanged(false),
        )
    }

    @Test
    fun `playback callbacks received in background cannot reacquire screen flag`() {
        coordinator.onActivityVisibilityChanged(false)

        assertEquals(
            PlaybackUiState(headerHidden = false, keepScreenOn = false),
            coordinator.onVideoPlaybackChanged(true),
        )
    }

    @Test
    fun `resuming restores state for a video that is still playing`() {
        coordinator.onActivityVisibilityChanged(true)
        coordinator.onVideoPlaybackChanged(true)
        coordinator.onActivityVisibilityChanged(false)

        assertEquals(
            PlaybackUiState(headerHidden = true, keepScreenOn = true),
            coordinator.onActivityVisibilityChanged(true),
        )
    }

    @Test
    fun `fullscreen hides header without keeping paused video awake`() {
        coordinator.onActivityVisibilityChanged(true)

        assertEquals(
            PlaybackUiState(headerHidden = true, keepScreenOn = false),
            coordinator.onFullscreenChanged(true),
        )
    }

    @Test
    fun `leaving fullscreen restores header when video is paused`() {
        coordinator.onActivityVisibilityChanged(true)
        coordinator.onFullscreenChanged(true)

        assertEquals(
            PlaybackUiState(headerHidden = false, keepScreenOn = false),
            coordinator.onFullscreenChanged(false),
        )
    }

    @Test
    fun `backgrounding fullscreen clears both visible UI effects`() {
        coordinator.onActivityVisibilityChanged(true)
        coordinator.onFullscreenChanged(true)
        coordinator.onVideoPlaybackChanged(true)

        assertEquals(
            PlaybackUiState(headerHidden = false, keepScreenOn = false),
            coordinator.onActivityVisibilityChanged(false),
        )
    }

    @Test
    fun `rotation fullscreen hides header even when playback flag is stale`() {
        // Landscape rotation enters fullscreen; the JS playback flag can lag a
        // fresh navigation, so fullscreen alone must hide the header regardless
        // of the cached videoPlaying state.
        coordinator.onActivityVisibilityChanged(true)

        assertEquals(
            PlaybackUiState(headerHidden = true, keepScreenOn = false),
            coordinator.onFullscreenChanged(true),
        )
    }

    @Test
    fun `leaving rotation fullscreen restores header when video is paused`() {
        coordinator.onActivityVisibilityChanged(true)
        coordinator.onFullscreenChanged(true)

        assertEquals(
            PlaybackUiState(headerHidden = false, keepScreenOn = false),
            coordinator.onFullscreenChanged(false),
        )
    }
}
