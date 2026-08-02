package com.advoid.app

data class PlaybackUiState(
    val keepScreenOn: Boolean,
)

class PlaybackUiCoordinator {
    private var activityVisible = false
    private var videoPlaying = false

    fun onActivityVisibilityChanged(visible: Boolean): PlaybackUiState {
        activityVisible = visible
        return currentState()
    }

    fun onVideoPlaybackChanged(playing: Boolean): PlaybackUiState {
        videoPlaying = playing
        return currentState()
    }

    fun currentState(): PlaybackUiState {
        return PlaybackUiState(
            keepScreenOn = activityVisible && videoPlaying,
        )
    }
}
