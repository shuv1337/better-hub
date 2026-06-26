import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

const ENCRYPTED_PREFIX = "enc:v1:";

function getSettingsSecretKey(): string | null {
	return process.env.BETTER_AUTH_SECRET ?? null;
}

export async function encryptSettingSecret(value: string | null): Promise<string | null> {
	if (value === null) return null;

	const key = getSettingsSecretKey();
	if (!key) {
		throw new Error("BETTER_AUTH_SECRET is not configured");
	}

	const encrypted = await symmetricEncrypt({ key, data: value });
	return `${ENCRYPTED_PREFIX}${encrypted}`;
}

export async function decryptSettingSecret(
	value: string | null,
	fieldName?: string,
): Promise<string | null> {
	if (value === null) return null;
	if (!value.startsWith(ENCRYPTED_PREFIX)) return value;

	const key = getSettingsSecretKey();
	if (!key) return null;

	try {
		return await symmetricDecrypt({
			key,
			data: value.slice(ENCRYPTED_PREFIX.length),
		});
	} catch {
		if (fieldName) {
			console.error(`Failed to decrypt user setting field: ${fieldName}`);
		}
		return null;
	}
}
