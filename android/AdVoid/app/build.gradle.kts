import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing reads from keystore.properties (gitignored, never
// committed) so the keystore/passwords never touch source control. Missing
// in a fresh checkout or CI without the secret configured — release builds
// fall back to unsigned rather than failing the build outright.
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
val hasReleaseSigning = keystoreProps.getProperty("KEYSTORE_FILE")?.let {
    rootProject.file(it).exists()
} ?: false

android {
    namespace = "com.advoid.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.advoid.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
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

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation(platform("androidx.compose:compose-bom:2024.12.01"))
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
}
