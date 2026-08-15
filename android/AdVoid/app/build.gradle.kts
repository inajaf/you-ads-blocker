import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ---------------------------------------------------------------------------
// Managed versioning. The single source of truth is android/AdVoid/version.properties
// (tracked). versionCode MUST increase monotonically for every Play upload —
// see the header comment in that file. Never hardcode versions here.
// ---------------------------------------------------------------------------
val versionProps = Properties().apply {
    val f = rootProject.file("version.properties")
    require(f.exists()) { "Missing $f — declare VERSION_CODE / VERSION_NAME before building." }
    f.inputStream().use { load(it) }
}
val releaseVersionCode: Int = versionProps.getProperty("VERSION_CODE")?.toIntOrNull()
    ?: throw GradleException("VERSION_CODE missing or not an integer in version.properties")
val releaseVersionName: String = versionProps.getProperty("VERSION_NAME")
    ?: throw GradleException("VERSION_NAME missing in version.properties")

// ---------------------------------------------------------------------------
// Release signing. Reads from keystore.properties (gitignored, never committed)
// so the keystore/passwords never touch source control. A Play release must
// NEVER ship unsigned: if the keystore file or any property is absent, the
// release signing config fails the build loudly instead of silently producing
// an unsigned artifact. The debug build is unaffected and needs no keystore.
// ---------------------------------------------------------------------------
val keystorePropsFile = rootProject.file("keystore.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) keystorePropsFile.inputStream().use { load(it) }
}
val hasReleaseSigning = keystorePropsFile.exists() &&
    !keystoreProps.getProperty("KEYSTORE_FILE").isNullOrBlank() &&
    !keystoreProps.getProperty("KEYSTORE_PASSWORD").isNullOrBlank() &&
    !keystoreProps.getProperty("KEY_ALIAS").isNullOrBlank() &&
    !keystoreProps.getProperty("KEY_PASSWORD").isNullOrBlank()

android {
    namespace = "com.advoid.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.advoid.app"
        minSdk = 26
        targetSdk = 36
        versionCode = releaseVersionCode
        versionName = releaseVersionName
    }

    signingConfigs {
        if (hasReleaseSigning) {
            create("release") {
                storeFile = rootProject.file(keystoreProps.getProperty("KEYSTORE_FILE"))
                storePassword = keystoreProps.getProperty("KEYSTORE_PASSWORD")
                keyAlias = keystoreProps.getProperty("KEY_ALIAS")
                keyPassword = keystoreProps.getProperty("KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        debug {
            // Keep local QA builds installable beside the signed production app
            // so emulator verification never requires deleting login/session data.
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
        }
        release {
            isMinifyEnabled = false
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    // lintVitalAnalyzeRelease (which assembleRelease runs by default) fails
    // under newer JDKs than AGP 8.7.3's lint tooling supports; this is a
    // release-packaging build, not a lint gate — skip it here.
    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }
}

// Fail closed on release signing. A Play release must NEVER ship unsigned, so
// if the keystore is missing we fail the build rather than silently producing
// an unsigned artifact. This runs only when a release-packaging task is
// actually in the task graph (preReleaseBuild precedes assembleRelease /
// bundleRelease), so debug and unit-test builds never require a keystore.
gradle.taskGraph.whenReady {
    val buildingRelease = allTasks.any {
        it.name.startsWith("assembleRelease") ||
            it.name.startsWith("bundleRelease") ||
            it.name == "preReleaseBuild"
    }
    if (buildingRelease && !hasReleaseSigning) {
        throw GradleException(
            "Refusing to build an unsigned release. android/AdVoid/keystore.properties " +
                "(gitignored) is missing or incomplete — it must define " +
                "KEYSTORE_FILE, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD pointing at a real " +
                "keystore. See docs/decisions.md."
        )
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    testImplementation("junit:junit:4.13.2")
}
