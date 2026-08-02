package com.advoid.app

import org.junit.Assert.assertEquals
import org.junit.Test

class PlaybackUiCoordinatorTest {
    private val coordinator = PlaybackUiCoordinator()

    @Test
    fun `playing video keeps a visible activity awake`() {
        coordinator.onActivityVisibilityChanged(true)

        assertEquals(
            PlaybackUiState(keepScreenOn = true),
            coordinator.onVideoPlaybackChanged(true),
        )
    }

    @Test
    fun `pausing video releases keep screen on`() {
        coordinator.onActivityVisibilityChanged(true)
        coordinator.onVideoPlaybackChanged(true)

        assertEquals(
            PlaybackUiState(keepScreenOn = false),
            coordinator.onVideoPlaybackChanged(false),
        )
    }

    @Test
    fun `backgrounding the activity never keeps the screen awake`() {
        coordinator.onActivityVisibilityChanged(true)
        coordinator.onVideoPlaybackChanged(true)

        assertEquals(
            PlaybackUiState(keepScreenOn = false),
            coordinator.onActivityVisibilityChanged(false),
        )
    }

    @Test
    fun `playback callbacks received in background cannot reacquire screen flag`() {
        coordinator.onActivityVisibilityChanged(false)

        assertEquals(
            PlaybackUiState(keepScreenOn = false),
            coordinator.onVideoPlaybackChanged(true),
        )
    }

    @Test
    fun `resuming restores keep screen on for a video that is still playing`() {
        coordinator.onActivityVisibilityChanged(true)
        coordinator.onVideoPlaybackChanged(true)
        coordinator.onActivityVisibilityChanged(false)

        assertEquals(
            PlaybackUiState(keepScreenOn = true),
            coordinator.onActivityVisibilityChanged(true),
        )
    }
}
