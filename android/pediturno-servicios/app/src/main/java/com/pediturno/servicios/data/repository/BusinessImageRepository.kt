package com.pediturno.servicios.data.repository

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import android.net.Uri
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.storage.FirebaseStorage
import com.google.firebase.storage.StorageMetadata
import com.pediturno.servicios.BuildConfig
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.IOException

/** Photo Picker files are constrained before uploading to the current owner's Storage path. */
class BusinessImageRepository(
    private val context: Context,
    useFirebaseEmulator: Boolean = false,
    firebaseEmulatorHost: String = BuildConfig.FIREBASE_EMULATOR_HOST,
    private val authorizeUpload: suspend (String, ImageCategory, Int) -> ImageUploadPermit = { _, _, _ -> error("No se configuró la autorización de imágenes.") }
) {
    private companion object {
        const val MAX_BYTES = 2 * 1024 * 1024
    }
    private val validatedEmulatorHost = validatedFirebaseEmulatorHost(useFirebaseEmulator, firebaseEmulatorHost)
    private val auth = FirebaseAuth.getInstance()
    private val storage = FirebaseStorage.getInstance().also { storage ->
        if (useFirebaseEmulator) {
            val host = requireNotNull(validatedEmulatorHost) {
                "Firebase emulator host is not allowed for this debug build."
            }
            storage.useEmulator(host, 9199)
        }
    }
    suspend fun upload(uri: Uri, category: ImageCategory): Result<String> = try {
        require(context.contentResolver.getType(uri)?.startsWith("image/") == true) { "Seleccioná una imagen válida." }
        val uid = auth.currentUser?.uid ?: error("Tu sesión venció. Volvé a ingresar.")
        val bytes = withContext(Dispatchers.IO) { compress(uri) }
        require(auth.currentUser?.uid == uid) { "Tu sesión cambió. Volvé a seleccionar la imagen." }
        val permit = authorizeUpload(uid, category, bytes.size)
        val reference = storage.reference.child(permit.storagePath)
        require(auth.currentUser?.uid == uid) { "Tu sesión cambió. Volvé a seleccionar la imagen." }
        val metadata = StorageMetadata.Builder().setContentType("image/jpeg").setCustomMetadata("imagePermitId", permit.permitId).build()
        reference.putBytes(bytes, metadata).await()
        val url = reference.downloadUrl.await().toString()
        require(auth.currentUser?.uid == uid) { "Tu sesión cambió. Volvé a seleccionar la imagen." }
        Result.success(url)
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (error: Throwable) {
        Result.failure(error)
    }

    private fun compress(uri: Uri): ByteArray {
        val resolver = context.contentResolver
        val orientation = try {
            resolver.openInputStream(uri)?.use { input ->
                ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
            } ?: ExifInterface.ORIENTATION_NORMAL
        } catch (_: IOException) {
            // Picker images without readable EXIF can still be valid bitmaps.
            ExifInterface.ORIENTATION_NORMAL
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
        require(bounds.outWidth > 0 && bounds.outHeight > 0) { "No se pudo leer la imagen." }
        var sample = 1
        while (bounds.outWidth / sample > 1600 || bounds.outHeight / sample > 1600) sample *= 2
        val options = BitmapFactory.Options().apply { inSampleSize = sample; inPreferredConfig = Bitmap.Config.ARGB_8888 }
        val bitmap = resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, options) }
            ?: error("No se pudo leer la imagen.")
        var oriented = bitmap
        var resized = bitmap
        try {
            oriented = applyExifOrientation(bitmap, orientation)
            val scale = minOf(1f, 1600f / maxOf(oriented.width, oriented.height))
            resized = if (scale < 1f) {
                Bitmap.createScaledBitmap(oriented, (oriented.width * scale).toInt(), (oriented.height * scale).toInt(), true)
            } else {
                oriented
            }
            var quality = 88
            var bytes: ByteArray
            do {
                bytes = ByteArrayOutputStream().use { output ->
                    resized.compress(Bitmap.CompressFormat.JPEG, quality, output)
                    output.toByteArray()
                }
                quality -= 8
            } while (bytes.size > MAX_BYTES && quality >= 40)
            require(bytes.size <= MAX_BYTES) { "La imagen no se pudo reducir por debajo de 2 MB." }
            return bytes
        } finally {
            if (resized !== oriented && resized !== bitmap && !resized.isRecycled) resized.recycle()
            if (oriented !== bitmap && !oriented.isRecycled) oriented.recycle()
            if (!bitmap.isRecycled) bitmap.recycle()
        }
    }

    private fun applyExifOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix().apply {
            when (orientation) {
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> postScale(-1f, 1f)
                ExifInterface.ORIENTATION_ROTATE_180 -> postRotate(180f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> postScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> { postRotate(90f); postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_90 -> postRotate(90f)
                ExifInterface.ORIENTATION_TRANSVERSE -> { postRotate(-90f); postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_270 -> postRotate(-90f)
            }
        }
        return if (matrix.isIdentity) bitmap else Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
}

enum class ImageCategory(val directory: String) { LOGO("logos"), SERVICE("services"), AVATAR("avatars") }
