

'use server';

import { Storage } from '@google-cloud/storage';
import { gcloudPrivateKeyBase64, gcloudClientEmail } from '@/lib/firebase';

const projectId = process.env.FIREBASE_PROJECT_ID;
const bucketName = process.env.FIREBASE_STORAGE_BUCKET;

// Define the CORS configuration
const corsConfiguration = [
    {
        "origin": ["*"],
        "method": ["GET", "HEAD"],
        "responseHeader": [
            "Content-Type",
            "Access-Control-Allow-Origin",
            "x-goog-resumable"
        ],
        "maxAgeSeconds": 3600
    }
];

export async function configureCors(): Promise<{ success: boolean, message: string }> {
    if (!gcloudPrivateKeyBase64 || !gcloudClientEmail) {
        const errorMessage = "Google Cloud credentials (client email or Base64 private key) are not set in server environment variables.";
        console.error(errorMessage);
        return { success: false, message: errorMessage };
    }
    
    if (!projectId || !bucketName) {
        const errorMessage = "Firebase project ID or bucket name is not defined in server environment variables.";
         console.error(errorMessage);
        return { success: false, message: errorMessage };
    }

    try {
        const decodedPrivateKey = Buffer.from(gcloudPrivateKeyBase64, 'base64').toString('utf-8');

        const storage = new Storage({
            projectId,
            credentials: {
                client_email: gcloudClientEmail,
                private_key: decodedPrivateKey,
            },
        });

        await storage.bucket(bucketName).setCorsConfiguration(corsConfiguration);

        const successMessage = `CORS configuration updated for bucket ${bucketName}. Ahora deberías poder ver el logo en el QR.`;
        console.log(successMessage);
        return { success: true, message: successMessage };

    } catch (error) {
        console.error('ERROR SETTING CORS:', error);
        return { success: false, message: 'Failed to set CORS configuration. Check if the credentials have the correct permissions (Storage Admin role).' };
    }
}
