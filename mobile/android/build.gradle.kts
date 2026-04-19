allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
// Compatibility shim for older Flutter plugins:
//   1. AGP 8+ requires android.namespace on every library. Some older plugins
//      (e.g. flutter_jailbreak_detection 1.10.0) still rely on the removed
//      <manifest package=""> attribute → "Namespace not specified" at config.
//   2. Some older plugins pin compileSdkVersion to an ancient API which the
//      Android SDK Manager can no longer always install cleanly. Force every
//      Android subproject to compile against the same SDK our app uses.
//   3. With compileSdk 36, AGP/Kotlin default Kotlin to JVM target 21, while
//      plugins whose Java compile task wasn't pinned still default to 1.8 →
//      "Inconsistent JVM-target compatibility". Force Java + Kotlin to 17
//      everywhere to match :app.
// Registered BEFORE the evaluationDependsOn block below so afterEvaluate runs
// while the project is still being evaluated.
subprojects {
    afterEvaluate {
        if (extensions.findByName("android") != null) {
            val androidExt = extensions.getByName("android")
            val methods = androidExt.javaClass.methods

            // (1) Patch missing namespace.
            val namespaceGetter = methods.firstOrNull { it.name == "getNamespace" }
            val currentNs = namespaceGetter?.invoke(androidExt) as? String
            if (currentNs.isNullOrBlank()) {
                val namespaceSetter = methods.firstOrNull { it.name == "setNamespace" }
                namespaceSetter?.invoke(androidExt, project.group.toString())
            }

            // (2) Force compileSdk = 36 on any subproject that pinned an older value.
            val compileSdkSetter = methods.firstOrNull {
                it.name == "setCompileSdkVersion" && it.parameterTypes.size == 1
                        && it.parameterTypes[0] == String::class.java
            }
            compileSdkSetter?.invoke(androidExt, "android-36")

            // (3) Unify Java + Kotlin JVM target at 17.
            //     Set android.compileOptions so AGP stops defaulting the Java
            //     task to 1.8. Setting the JavaCompile task directly is not
            //     enough because AGP re-applies compileOptions during task
            //     configuration.
            val getCompileOptions = methods.firstOrNull { it.name == "getCompileOptions" }
            val compileOptions = getCompileOptions?.invoke(androidExt)
            if (compileOptions != null) {
                val coMethods = compileOptions.javaClass.methods
                val setSource = coMethods.firstOrNull {
                    it.name == "setSourceCompatibility" && it.parameterTypes.size == 1
                            && it.parameterTypes[0] == JavaVersion::class.java
                }
                val setTarget = coMethods.firstOrNull {
                    it.name == "setTargetCompatibility" && it.parameterTypes.size == 1
                            && it.parameterTypes[0] == JavaVersion::class.java
                }
                setSource?.invoke(compileOptions, JavaVersion.VERSION_17)
                setTarget?.invoke(compileOptions, JavaVersion.VERSION_17)
            }
            tasks.withType(JavaCompile::class.java).configureEach {
                sourceCompatibility = JavaVersion.VERSION_17.toString()
                targetCompatibility = JavaVersion.VERSION_17.toString()
            }
            tasks.matching { it.javaClass.name.contains("KotlinCompile") }.configureEach {
                val getKotlinOptions = this.javaClass.methods.firstOrNull { it.name == "getKotlinOptions" }
                val kotlinOptions = getKotlinOptions?.invoke(this)
                val setJvmTarget = kotlinOptions?.javaClass?.methods?.firstOrNull {
                    it.name == "setJvmTarget" && it.parameterTypes.size == 1
                            && it.parameterTypes[0] == String::class.java
                }
                setJvmTarget?.invoke(kotlinOptions, "17")
            }
        }
    }
}

subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
