package com.advoid.app

import org.junit.Assert.assertTrue
import org.junit.Test

class AutoFullscreenScriptTest {
    @Test
    fun `rotation fullscreen targets player-container so controls stay reachable`() {
        val expr = MainActivity.FULLSCREEN_TARGET_EXPRESSION
        // YouTube's mobile-web expand button fullscreens .player-container, not
        // the bare .html5-video-player: the wrapper contains BOTH the
        // letterboxed player and the mobile controls (seek bar). Fullscreening
        // the bare player pushes the controls out of the fullscreen view (the
        // wrapper collapses to zero height in the top layer), leaving the user
        // unable to scrub the seek bar.
        assertTrue(
            "player-container must be the primary fullscreen target",
            expr.startsWith("video.closest('.player-container')"),
        )
        assertTrue(
            "player-container must precede the bare player fallback",
            expr.indexOf(".player-container") < expr.indexOf(".html5-video-player"),
        )
        // The bare video remains the last-resort fallback for pages without the
        // wrapper; it must never be preferred (it renders cropped).
        assertTrue(expr.endsWith("|| video"))
    }
}
