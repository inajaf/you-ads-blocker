package com.advoid.app

data class PlaybackUiState(
    val headerHidden: Boolean,
    val keepScreenOn: Boolean,
)

class PlaybackUiCoordinator {
    private var activityVisible = false
    private var videoPlaying = false
    private var fullscreen = false

    fun onActivityVisibilityChanged(visible: Boolean): PlaybackUiState {
        activityVisible = visible
        return currentState()
    }

    fun onVideoPlaybackChanged(playing: Boolean): PlaybackUiState {
        videoPlaying = playing
        return currentState()
    }

    fun onFullscreenChanged(active: Boolean): PlaybackUiState {
        fullscreen = active
        return currentState()
    }

    fun currentState(): PlaybackUiState {
        return PlaybackUiState(
            headerHidden = activityVisible && (videoPlaying || fullscreen),
            keepScreenOn = activityVisible && videoPlaying,
        )
    }
}
