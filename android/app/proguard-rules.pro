# Default ProGuard/R8 rules. Minification is disabled in the release build type
# above, so nothing is stripped; these rules are here only so the build file's
# proguardFiles reference resolves and so the file is ready if you later enable
# isMinifyEnabled = true.

# Keep the JavaScript-injection assets referenced by name at runtime.
-keep class app.tube.** { *; }
