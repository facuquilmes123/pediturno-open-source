# R8 Rules for Pediturno Servicios
-keepattributes *Annotation*
-keepattributes Signature
-keepattributes InnerClasses
-keepattributes EnclosingMethod

# Keep data models serialized with kotlinx.serialization
-keepclassmembers class * {
    companion object;
}
-keepclasseswithmembers class * {
    kotlinx.serialization.KSerializer serializer(...);
}
